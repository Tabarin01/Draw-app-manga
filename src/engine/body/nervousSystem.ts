import * as THREE from 'three';
import type { BodyDefinition, ControlDef } from './bodyDefinition';
import { mirrorQuaternion } from './joints';

/**
 * Sistema nervoso — strato di coordinamento.
 *
 * L'utente esprime un'intenzione ("alza il braccio di 150°", "chiudi la mano",
 * "gira il collo"); il sistema nervoso la traduce nelle rotazioni delle singole ossa,
 * come fa il corpo reale:
 *
 *  - distribuzione spinale: un movimento del collo o del tronco si ripartisce sulle
 *    vertebre secondo quanto ciascun segmento può muoversi davvero
 *  - ritmo scapolo-omerale: oltre i primi 30° di elevazione del braccio, la scapola
 *    ruota di 1° ogni 2° dell'omero (rapporto 2:1, Inman 1944)
 *  - sinergia di chiusura della mano: un solo comando flette tutte le dita
 *  - limiti dipendenti dalla direzione: il braccio si alza di 180° in avanti o di lato,
 *    ma solo di ~60° all'indietro
 */

/** Valori dei gradi di libertà per ogni controllo, in gradi (o % per le sinergie). */
export type Pose = Record<string, number[]>;

export interface NervousOptions {
  /** Coordinamento automatico (ritmo scapolo-omerale). Spento: ogni giunto lavora da solo. */
  coordination: boolean;
}

export interface ShoulderInfo {
  total: number;
  glenohumeral: number;
  scapular: number;
  /** Elevazione massima consentita nella direzione scelta. */
  limit: number;
}

export interface NervousOutput {
  rotations: Map<string, THREE.Quaternion>;
  shoulders: Partial<Record<'L' | 'R', ShoulderInfo>>;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function neutralPose(body: BodyDefinition): Pose {
  const pose: Pose = {};
  for (const c of body.controls) pose[c.id] = c.dofs.map((d) => clamp(0, d.min, d.max));
  return pose;
}

/**
 * Sinergia di chiusura: quanto si flette ogni giunto (in gradi) con la mano chiusa al 100%.
 * [controllo, indice del grado di libertà, gradi]
 */
const GRIP_SYNERGY: [string, number, number][] = [
  ...[2, 3, 4, 5].flatMap((n): [string, number, number][] => [
    [`mcp${n}`, 0, 85],
    [`pip${n}`, 0, 100],
    [`dip${n}`, 0, 65],
  ]),
  ['cmc1', 0, 30],
  ['cmc1', 1, 20],
  ['cmc1', 2, 25],
  ['mcp1', 0, 40],
  ['ip1', 0, 45],
];

/** Escursione massima della sola articolazione gleno-omerale (senza contributo della scapola). */
export const GLENOHUMERAL_MAX = 120;

/** Elevazione massima del braccio in funzione della direzione (0 = di lato, 90 = avanti, −90 = indietro). */
function shoulderElevationLimit(plane: number): number {
  return plane >= 0 ? 180 : 180 - 120 * Math.min(1, -plane / 90);
}

function dofsToQuaternion(c: ControlDef, values: number[], weights?: number[]): THREE.Quaternion {
  const q = new THREE.Quaternion();
  const step = new THREE.Quaternion();
  c.dofs.forEach((d, i) => {
    if (!d.axis) return;
    const w = weights ? weights[i] : 1;
    step.setFromAxisAngle(d.axis, THREE.MathUtils.degToRad(values[i] * d.sign * w));
    q.multiply(step);
  });
  return q;
}

export function solvePose(body: BodyDefinition, pose: Pose, opts: NervousOptions): NervousOutput {
  const byId = new Map(body.controls.map((c) => [c.id, c]));

  // Copia di lavoro dei valori, a cui si sommano le sinergie.
  const values = new Map<string, number[]>();
  for (const c of body.controls) values.set(c.id, (pose[c.id] ?? c.dofs.map(() => 0)).slice());

  // 1) Sinergia di chiusura della mano (comando nel polso, 3° grado di libertà).
  for (const side of ['L', 'R'] as const) {
    const grip = (values.get(`wrist_${side}`)?.[2] ?? 0) / 100;
    if (grip <= 0) continue;
    for (const [base, i, deg] of GRIP_SYNERGY) {
      const id = `${base}_${side}`;
      const v = values.get(id);
      const c = byId.get(id);
      if (!v || !c) continue;
      v[i] = clamp(v[i] + grip * deg, c.dofs[i].min, c.dofs[i].max);
    }
  }

  // 2) Dalle intenzioni alle rotazioni delle ossa.
  const rotations = new Map<string, THREE.Quaternion>();
  const apply = (boneId: string, q: THREE.Quaternion) => {
    const current = rotations.get(boneId);
    if (current) current.multiply(q);
    else rotations.set(boneId, q.clone());
  };
  const shoulders: NervousOutput['shoulders'] = {};

  for (const c of body.controls) {
    const v = values.get(c.id)!;
    const t = c.target;

    if (t.kind === 'joint') {
      const q = dofsToQuaternion(c, v);
      if (c.side === 'R') mirrorQuaternion(q);
      apply(t.bone, q);
    } else if (t.kind === 'region') {
      for (const { bone, weights } of t.bones) apply(bone, dofsToQuaternion(c, v, weights));
    } else {
      // Spalla: elevazione in un piano + rotazione assiale
      const [elevRaw, plane, rot] = v;
      const limit = shoulderElevationLimit(plane);
      const elev = Math.min(elevRaw, limit);
      // Senza la scapola, l'articolazione gleno-omerale da sola arriva a circa 120°.
      const glenohumeral = opts.coordination ? (elev <= 30 ? elev : 30 + ((elev - 30) * 2) / 3) : Math.min(elev, GLENOHUMERAL_MAX);
      const scapular = opts.coordination ? Math.max(0, elev - 30) / 3 : 0;

      // Asse di elevazione (lato sinistro): perpendicolare alla verticale e alla direzione scelta.
      const p = THREE.MathUtils.degToRad(plane);
      const axis = new THREE.Vector3(-Math.sin(p), 0, Math.cos(p));
      const rotDof = c.dofs[2];

      const qHumerus = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(glenohumeral));
      qHumerus.multiply(new THREE.Quaternion().setFromAxisAngle(rotDof.axis!, THREE.MathUtils.degToRad(rot * rotDof.sign)));
      const qScapula = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(scapular));
      if (c.side === 'R') {
        mirrorQuaternion(qHumerus);
        mirrorQuaternion(qScapula);
      }
      apply(t.humerus, qHumerus);
      apply(t.scapula, qScapula);
      if (c.side !== 'C') shoulders[c.side] = { total: glenohumeral + scapular, glenohumeral, scapular, limit };
    }
  }

  return { rotations, shoulders };
}
