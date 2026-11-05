import * as THREE from 'three';

/**
 * Vocabolario delle articolazioni.
 *
 * Convenzioni (valide in tutto il motore del corpo):
 *   - unità: metri; Y in alto; il corpo guarda verso +Z; +X è il lato SINISTRO del corpo
 *   - posa di riferimento = posizione anatomica: in piedi, braccia lungo i fianchi,
 *     palmi in avanti. In questa posa TUTTI gli angoli valgono 0.
 *   - a riposo ogni osso ha gli assi allineati al mondo: gli assi dei movimenti sono
 *     quindi gli assi anatomici (X medio-laterale, Y longitudinale, Z antero-posteriore)
 *   - i gradi di libertà sono definiti per il lato SINISTRO; il destro è lo specchio
 *     (vedi mirrorQuaternion).
 */

export type JointType = 'ball' | 'hinge' | 'pivot' | 'saddle' | 'condyloid' | 'spine' | 'free';

export const JOINT_TYPE_LABEL: Record<JointType, string> = {
  ball: 'Enartrosi (sferica) — 3 gradi di libertà',
  hinge: 'Ginglimo (a cerniera) — 1 grado di libertà',
  pivot: 'Trocoide (a perno) — rotazione attorno a un asse',
  saddle: 'A sella — 2 gradi di libertà + opposizione',
  condyloid: 'Condiloidea (ellissoidale) — 2 gradi di libertà',
  spine: 'Tratto di colonna — il movimento si distribuisce sulle vertebre',
  free: 'Orientamento dell\'intero corpo',
};

/** Colore del marcatore nel viewport, per tipo di articolazione. */
export const JOINT_TYPE_COLOR: Record<JointType, number> = {
  ball: 0xe8505b,
  hinge: 0x3d8bfd,
  pivot: 0x2fb36d,
  saddle: 0xf59f2a,
  condyloid: 0xa463f2,
  spine: 0x17b5c4,
  free: 0x888888,
};

export interface DofDef {
  key: string;
  /** Nome del movimento, es. "Flessione / Estensione". */
  label: string;
  /** Nome del verso positivo (es. "Flessione") e negativo (es. "Estensione"). */
  pos: string;
  neg?: string;
  /** Come chiamare lo zero, se ha un nome (es. "di lato"). */
  zero?: string;
  /** Limiti reali del movimento. */
  min: number;
  max: number;
  unit: '°' | '%';
  /**
   * Asse di rotazione (lato sinistro, nello spazio a riposo dell'osso) e verso.
   * null = grado di libertà "speciale", interpretato dal sistema nervoso
   * (es. piano di elevazione della spalla, chiusura della mano).
   */
  axis: THREE.Vector3 | null;
  sign: 1 | -1;
}

export const AXIS_X = new THREE.Vector3(1, 0, 0);
export const AXIS_Y = new THREE.Vector3(0, 1, 0);
export const AXIS_Z = new THREE.Vector3(0, 0, 1);

export function dof(
  key: string,
  label: string,
  range: [number, number],
  axis: THREE.Vector3 | null,
  sign: 1 | -1,
  names: { pos: string; neg?: string; zero?: string },
  unit: '°' | '%' = '°',
): DofDef {
  return { key, label, min: range[0], max: range[1], axis, sign, unit, ...names };
}

/** Testo leggibile per un valore: "Flessione 45°", "Estensione 10°", "di lato". */
export function describeDof(d: DofDef, value: number): string {
  const v = Math.round(value);
  if (v === 0) return d.zero ?? `0${d.unit}`;
  if (v < 0 && d.neg) return `${d.neg} ${-v}${d.unit}`;
  return `${d.pos} ${v}${d.unit}`;
}

/**
 * Specchia una rotazione dal lato sinistro al destro (riflessione sul piano X = 0):
 * una rotazione di θ attorno ad a diventa una rotazione di −θ attorno ad a riflesso.
 */
export function mirrorQuaternion(q: THREE.Quaternion): THREE.Quaternion {
  return q.set(q.x, -q.y, -q.z, q.w);
}
