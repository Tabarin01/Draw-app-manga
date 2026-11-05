import * as THREE from 'three';
import type { AnatomyData } from './anatomyAsset';
import { AXIS_X, AXIS_Y, AXIS_Z, dof, type DofDef, type JointType } from './joints';

/**
 * Definizione del corpo: gerarchia delle ossa, articolazioni e loro limiti.
 *
 * Le posizioni NON sono inventate: vengono dall'atlante anatomico BodyParts3D
 * (scansione di un corpo reale). I centri articolari sono calcolati dalla geometria
 * delle ossa (vedi tools/build-anatomy.mjs). Qui si aggiungono la semantica:
 * tipo di articolazione, movimenti con i nomi anatomici, escursioni reali.
 *
 * Il corpo viene scalato uniformemente all'altezza richiesta.
 */

export type Side = 'L' | 'R' | 'C';
type V3 = THREE.Vector3;

export interface BoneDef {
  id: string;
  /** Nome anatomico, già con il lato (es. "Omero sinistro"). */
  label: string;
  parent: string | null;
  side: Side;
  /** Centro del giunto con il genitore (mondo, posizione anatomica, già scalato). */
  head: V3;
}

export type ControlTarget =
  | { kind: 'joint'; bone: string }
  /** Il movimento si distribuisce su più ossa (vertebre) secondo dei pesi per grado di libertà. */
  | { kind: 'region'; bones: { bone: string; weights: number[] }[] }
  /** Spalla: complesso gleno-omerale + scapola, coordinato dal sistema nervoso. */
  | { kind: 'shoulder'; humerus: string; scapula: string };

/** Un'articolazione (o un tratto di colonna) che l'utente può muovere. */
export interface ControlDef {
  id: string;
  label: string;
  group: string;
  side: Side;
  type: JointType;
  dofs: DofDef[];
  target: ControlTarget;
  marker: { bone: string; at: V3; size: number };
}

export interface BodyDefinition {
  height: number;
  /** Fattore di scala rispetto al soggetto dell'atlante. */
  scale: number;
  bones: BoneDef[];
  controls: ControlDef[];
}

// Dimensioni dei marcatori (frazioni dell'altezza)
const MARK_L = 0.016;
const MARK_M = 0.011;
const MARK_S = 0.0055;

const ORDINALS_IT = ['', 'prima', 'seconda', 'terza', 'quarta', 'quinta', 'sesta', 'settima', 'ottava', 'nona', 'decima', 'undicesima', 'dodicesima'];

function normalize(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

export function buildBodyDefinition(anatomy: AnatomyData, height: number): BodyDefinition {
  const scale = height / anatomy.modelHeight;
  const v = (t: [number, number, number]) => new THREE.Vector3(t[0], t[1], t[2]).multiplyScalar(scale);
  const head = (id: string) => {
    const t = anatomy.heads[id];
    if (!t) throw new Error(`Centro articolare mancante nell'atlante: ${id}`);
    return v(t);
  };
  const center = (id: string) => v(anatomy.centers[id]);
  /** Direzione tra due punti dell'atlante, sempre dal lato sinistro (convenzione degli assi). */
  const dirL = (a: V3, b: V3) => b.clone().sub(a).normalize();
  const r = (f: number) => f * height;

  const bones: BoneDef[] = [];
  const controls: ControlDef[] = [];
  const bone = (id: string, label: string, parent: string | null, side: Side = 'C') =>
    bones.push({ id, label, parent, side, head: head(id) });
  const control = (c: ControlDef) => controls.push(c);

  // --- Bacino e colonna --------------------------------------------------------
  bone('pelvis', 'Bacino (ossa dell\'anca e sacro)', null);
  control({
    id: 'body', label: 'Corpo intero (bacino)', group: 'Tronco e testa', side: 'C', type: 'free',
    dofs: [
      dof('tilt', 'Inclinazione avanti / indietro', [-90, 90], AXIS_X, 1, { pos: 'Avanti', neg: 'Indietro' }),
      dof('lean', 'Inclinazione laterale', [-90, 90], AXIS_Z, -1, { pos: 'A sinistra', neg: 'A destra' }),
      dof('turn', 'Rotazione', [-180, 180], AXIS_Y, 1, { pos: 'A sinistra', neg: 'A destra' }),
    ],
    target: { kind: 'joint', bone: 'pelvis' },
    marker: { bone: 'pelvis', at: head('pelvis'), size: r(MARK_L) },
  });

  const lumbar = [5, 4, 3, 2, 1].map((n) => ({ id: `L${n}`, n, label: `Vertebra lombare L${n}` }));
  const thoracic = Array.from({ length: 12 }, (_, i) => 12 - i).map((n) => ({ id: `T${n}`, n, label: `Vertebra toracica T${n}` }));
  const cervical = [7, 6, 5, 4, 3, 2, 1].map((n) => ({
    id: `C${n}`, n, label: n === 1 ? 'Atlante (C1)' : n === 2 ? 'Epistrofeo (C2)' : `Vertebra cervicale C${n}`,
  }));
  let parent = 'pelvis';
  for (const vt of [...lumbar, ...thoracic, ...cervical]) {
    bone(vt.id, vt.label, parent);
    parent = vt.id;
  }

  // Pesi di distribuzione per tratto: [flessione, inclinazione laterale, rotazione].
  type Vt = { id: string; n: number };
  const region = (list: Vt[], weightsFor: (vt: Vt) => number[]) => {
    const raw = list.map(weightsFor);
    const norm = [0, 1, 2].map((k) => normalize(raw.map((w) => w[k])));
    return list.map((vt, i) => ({ bone: vt.id, weights: [norm[0][i], norm[1][i], norm[2][i]] }));
  };
  const spineDofs = (flex: [number, number], lat: number, rot: number) => [
    dof('flex', 'Flessione / Estensione', flex, AXIS_X, 1, { pos: 'Flessione (avanti)', neg: 'Estensione (indietro)' }),
    dof('lat', 'Inclinazione laterale', [-lat, lat], AXIS_Z, -1, { pos: 'A sinistra', neg: 'A destra' }),
    dof('rot', 'Rotazione', [-rot, rot], AXIS_Y, 1, { pos: 'A sinistra', neg: 'A destra' }),
  ];
  const lumbarFlex: Record<number, number> = { 1: 0.15, 2: 0.17, 3: 0.2, 4: 0.23, 5: 0.25 };

  control({
    id: 'lumbar', label: 'Colonna lombare (L1–L5)', group: 'Tronco e testa', side: 'C', type: 'spine',
    dofs: spineDofs([-25, 55], 25, 8),
    target: { kind: 'region', bones: region(lumbar, (vt) => [lumbarFlex[vt.n], 1, 1]) },
    marker: { bone: 'L3', at: center('L3'), size: r(MARK_M) },
  });
  control({
    id: 'thoracic', label: 'Colonna toracica (T1–T12)', group: 'Tronco e testa', side: 'C', type: 'spine',
    dofs: spineDofs([-25, 40], 30, 35),
    // la flessione toracica cresce verso il basso
    target: { kind: 'region', bones: region(thoracic, (vt) => [0.6 + (0.8 * (vt.n - 1)) / 11, 1, 1]) },
    marker: { bone: 'T7', at: center('T7'), size: r(MARK_M) },
  });
  control({
    id: 'neck', label: 'Collo (C1–C7)', group: 'Tronco e testa', side: 'C', type: 'spine',
    dofs: spineDofs([-55, 40], 40, 75),
    // metà della rotazione del capo avviene tra atlante ed epistrofeo
    target: { kind: 'region', bones: region(cervical, (vt) => (vt.n === 1 ? [0.67, 0.3, 6] : [1, 1, 1])) },
    marker: { bone: 'C4', at: center('C4'), size: r(MARK_M) },
  });

  bone('skull', 'Cranio e mandibola', 'C1');
  control({
    id: 'head', label: 'Testa (atlanto-occipitale)', group: 'Tronco e testa', side: 'C', type: 'condyloid',
    dofs: [
      dof('flex', 'Flessione / Estensione', [-20, 15], AXIS_X, 1, { pos: 'Flessione (annuire)', neg: 'Estensione' }),
      dof('lat', 'Inclinazione laterale', [-8, 8], AXIS_Z, -1, { pos: 'A sinistra', neg: 'A destra' }),
    ],
    target: { kind: 'joint', bone: 'skull' },
    marker: { bone: 'skull', at: head('skull'), size: r(MARK_M) },
  });

  // --- Gabbia toracica -------------------------------------------------------
  for (let i = 1; i <= 12; i++) {
    bone(`rib${i}_L`, `${ORDINALS_IT[i]} costa sinistra`.replace(/^./, (c) => c.toUpperCase()), `T${i}`, 'L');
    bone(`rib${i}_R`, `${ORDINALS_IT[i]} costa destra`.replace(/^./, (c) => c.toUpperCase()), `T${i}`, 'R');
  }
  bone('sternum', 'Sterno e cartilagini costali', 'T4');

  // --- Arti ------------------------------------------------------------------
  for (const side of ['L', 'R'] as const) {
    const m = side === 'L' ? 'sinistro' : 'destro';
    const f = side === 'L' ? 'sinistra' : 'destra';
    const sx = `_${side}`;
    const L = (id: string) => head(`${id}_L`);

    // ===== Cingolo scapolare e braccio =====
    const arm = `Braccio ${m}`;
    bone(`clavicle${sx}`, `Clavicola ${f}`, 'sternum', side);
    control({
      id: `sc${sx}`, label: `Sterno-clavicolare ${f}`, group: arm, side, type: 'saddle',
      dofs: [
        dof('elev', 'Elevazione / Depressione', [-10, 40], AXIS_Z, 1, { pos: 'Elevazione (spalla su)', neg: 'Depressione' }),
        dof('prot', 'Protrazione / Retrazione', [-15, 15], AXIS_Y, -1, { pos: 'Protrazione (avanti)', neg: 'Retrazione (indietro)' }),
      ],
      target: { kind: 'joint', bone: `clavicle${sx}` },
      marker: { bone: `clavicle${sx}`, at: head(`clavicle${sx}`), size: r(MARK_S * 1.4) },
    });
    bone(`scapula${sx}`, `Scapola ${f}`, `clavicle${sx}`, side);
    bone(`humerus${sx}`, `Omero ${m}`, `scapula${sx}`, side);
    control({
      id: `shoulder${sx}`, label: `Spalla ${f} (gleno-omerale)`, group: arm, side, type: 'ball',
      dofs: [
        dof('elev', 'Elevazione del braccio', [0, 180], null, 1, { pos: 'Elevazione', zero: 'Braccio lungo il fianco' }),
        dof('plane', 'Direzione dell\'elevazione', [-90, 135], null, 1, { pos: 'In avanti', neg: 'Indietro', zero: 'Di lato' }),
        dof('rot', 'Rotazione', [-90, 70], dirL(L('humerus'), L('ulna')), 1, { pos: 'Interna', neg: 'Esterna' }),
      ],
      target: { kind: 'shoulder', humerus: `humerus${sx}`, scapula: `scapula${sx}` },
      marker: { bone: `humerus${sx}`, at: head(`humerus${sx}`), size: r(MARK_L) },
    });

    bone(`ulna${sx}`, `Ulna ${f}`, `humerus${sx}`, side);
    control({
      id: `elbow${sx}`, label: `Gomito ${m}`, group: arm, side, type: 'hinge',
      dofs: [dof('flex', 'Flessione / Estensione', [-5, 145], AXIS_X, -1, { pos: 'Flessione', neg: 'Iperestensione' })],
      target: { kind: 'joint', bone: `ulna${sx}` },
      marker: { bone: `ulna${sx}`, at: head(`ulna${sx}`), size: r(MARK_M) },
    });

    bone(`radius${sx}`, `Radio ${m}`, `ulna${sx}`, side);
    const druj = v(anatomy.extra[`druj${sx}`]);
    control({
      id: `forearm${sx}`, label: `Avambraccio ${m} (radio-ulnare)`, group: arm, side, type: 'pivot',
      // il radio ruota attorno all'asse radio-ulnare prossimale → distale
      dofs: [dof('pron', 'Prono-supinazione', [0, 165], dirL(L('radius'), v(anatomy.extra.druj_L)), 1,
        { pos: 'Pronazione (palmo indietro)', zero: 'Supinazione (palmo in avanti)' })],
      target: { kind: 'joint', bone: `radius${sx}` },
      marker: { bone: `radius${sx}`, at: head(`radius${sx}`).lerp(druj, 0.5), size: r(MARK_M * 0.8) },
    });

    // ===== Mano =====
    const hand = `Mano ${f}`;
    bone(`carpus${sx}`, `Carpo e metacarpi (${f})`, `radius${sx}`, side);
    control({
      id: `wrist${sx}`, label: `Polso ${m} (radio-carpico)`, group: hand, side, type: 'condyloid',
      dofs: [
        dof('flex', 'Flessione / Estensione', [-70, 80], AXIS_X, -1, { pos: 'Flessione (verso il palmo)', neg: 'Estensione' }),
        dof('dev', 'Deviazione', [-30, 20], AXIS_Z, 1, { pos: 'Radiale (verso il pollice)', neg: 'Ulnare (verso il mignolo)' }),
        dof('grip', 'Chiusura della mano (sinergia)', [0, 100], null, 1, { pos: 'Chiusa', zero: 'Aperta' }, '%'),
      ],
      target: { kind: 'joint', bone: `carpus${sx}` },
      marker: { bone: `carpus${sx}`, at: head(`carpus${sx}`), size: r(MARK_M) },
    });

    const fingers = [
      { n: 2, name: 'Indice', abd: 1 as const },
      { n: 3, name: 'Medio', abd: 1 as const },
      { n: 4, name: 'Anulare', abd: -1 as const },
      { n: 5, name: 'Mignolo', abd: -1 as const },
    ];
    for (const fi of fingers) {
      const fid = `f${fi.n}`;
      bone(`${fid}p${sx}`, `${fi.name} ${m}: falange prossimale`, `carpus${sx}`, side);
      bone(`${fid}m${sx}`, `${fi.name} ${m}: falange media`, `${fid}p${sx}`, side);
      bone(`${fid}d${sx}`, `${fi.name} ${m}: falange distale`, `${fid}m${sx}`, side);
      control({
        id: `mcp${fi.n}${sx}`, label: `${fi.name} ${m}: metacarpo-falangea`, group: hand, side, type: 'condyloid',
        dofs: [
          dof('flex', 'Flessione / Estensione', [-30, 90], AXIS_X, -1, { pos: 'Flessione', neg: 'Estensione' }),
          dof('abd', 'Divaricazione', [-15, 20], AXIS_Z, fi.abd, { pos: 'Divaricazione', neg: 'Avvicinamento' }),
        ],
        target: { kind: 'joint', bone: `${fid}p${sx}` },
        marker: { bone: `${fid}p${sx}`, at: head(`${fid}p${sx}`), size: r(MARK_S) },
      });
      control({
        id: `pip${fi.n}${sx}`, label: `${fi.name} ${m}: interfalangea prossimale`, group: hand, side, type: 'hinge',
        dofs: [dof('flex', 'Flessione', [0, 110], AXIS_X, -1, { pos: 'Flessione' })],
        target: { kind: 'joint', bone: `${fid}m${sx}` },
        marker: { bone: `${fid}m${sx}`, at: head(`${fid}m${sx}`), size: r(MARK_S * 0.85) },
      });
      control({
        id: `dip${fi.n}${sx}`, label: `${fi.name} ${m}: interfalangea distale`, group: hand, side, type: 'hinge',
        dofs: [dof('flex', 'Flessione', [-5, 80], AXIS_X, -1, { pos: 'Flessione', neg: 'Iperestensione' })],
        target: { kind: 'joint', bone: `${fid}d${sx}` },
        marker: { bone: `${fid}d${sx}`, at: head(`${fid}d${sx}`), size: r(MARK_S * 0.75) },
      });
    }

    bone(`thumbMC${sx}`, `Pollice ${m}: metacarpo`, `carpus${sx}`, side);
    bone(`thumbP${sx}`, `Pollice ${m}: falange prossimale`, `thumbMC${sx}`, side);
    bone(`thumbD${sx}`, `Pollice ${m}: falange distale`, `thumbP${sx}`, side);
    control({
      id: `cmc1${sx}`, label: `Pollice ${m}: trapezio-metacarpale`, group: hand, side, type: 'saddle',
      dofs: [
        dof('flex', 'Flessione / Estensione', [-15, 45], AXIS_Z, -1, { pos: 'Flessione (verso il palmo)', neg: 'Estensione' }),
        dof('abd', 'Abduzione palmare', [0, 70], AXIS_X, -1, { pos: 'Abduzione (in avanti)' }),
        dof('opp', 'Opposizione', [0, 45], dirL(L('thumbMC'), L('thumbP')), 1, { pos: 'Opposizione' }),
      ],
      target: { kind: 'joint', bone: `thumbMC${sx}` },
      marker: { bone: `thumbMC${sx}`, at: head(`thumbMC${sx}`), size: r(MARK_S * 1.1) },
    });
    control({
      id: `mcp1${sx}`, label: `Pollice ${m}: metacarpo-falangea`, group: hand, side, type: 'hinge',
      dofs: [dof('flex', 'Flessione', [-10, 60], AXIS_Z, -1, { pos: 'Flessione', neg: 'Iperestensione' })],
      target: { kind: 'joint', bone: `thumbP${sx}` },
      marker: { bone: `thumbP${sx}`, at: head(`thumbP${sx}`), size: r(MARK_S) },
    });
    control({
      id: `ip1${sx}`, label: `Pollice ${m}: interfalangea`, group: hand, side, type: 'hinge',
      dofs: [dof('flex', 'Flessione', [-10, 80], AXIS_Z, -1, { pos: 'Flessione', neg: 'Iperestensione' })],
      target: { kind: 'joint', bone: `thumbD${sx}` },
      marker: { bone: `thumbD${sx}`, at: head(`thumbD${sx}`), size: r(MARK_S * 0.85) },
    });

    // ===== Arto inferiore =====
    const leg = `Gamba ${f}`;
    bone(`femur${sx}`, `Femore ${m}`, 'pelvis', side);
    control({
      id: `hip${sx}`, label: `Anca ${f} (coxo-femorale)`, group: leg, side, type: 'ball',
      dofs: [
        dof('flex', 'Flessione / Estensione', [-30, 120], AXIS_X, -1, { pos: 'Flessione (avanti)', neg: 'Estensione (indietro)' }),
        dof('abd', 'Abduzione / Adduzione', [-30, 45], AXIS_Z, 1, { pos: 'Abduzione (in fuori)', neg: 'Adduzione (in dentro)' }),
        dof('rot', 'Rotazione', [-45, 40], dirL(L('femur'), L('tibia')), 1, { pos: 'Interna', neg: 'Esterna' }),
      ],
      target: { kind: 'joint', bone: `femur${sx}` },
      marker: { bone: `femur${sx}`, at: head(`femur${sx}`), size: r(MARK_L) },
    });

    bone(`tibia${sx}`, `Tibia e perone (${f})`, `femur${sx}`, side);
    control({
      id: `knee${sx}`, label: `Ginocchio ${m}`, group: leg, side, type: 'hinge',
      dofs: [dof('flex', 'Flessione / Estensione', [-5, 140], AXIS_X, 1, { pos: 'Flessione', neg: 'Iperestensione' })],
      target: { kind: 'joint', bone: `tibia${sx}` },
      marker: { bone: `tibia${sx}`, at: head(`tibia${sx}`), size: r(MARK_L * 0.85) },
    });
    bone(`patella${sx}`, `Rotula ${f}`, `tibia${sx}`, side);

    bone(`foot${sx}`, `Piede ${m} (tarso e metatarso)`, `tibia${sx}`, side);
    control({
      id: `ankle${sx}`, label: `Caviglia ${f} (tibio-tarsica + sottoastragalica)`, group: leg, side, type: 'condyloid',
      dofs: [
        dof('flex', 'Flessione dorsale / plantare', [-50, 20], AXIS_X, -1, { pos: 'Dorsale (punta su)', neg: 'Plantare (punta giù)' }),
        dof('inv', 'Inversione / Eversione', [-15, 35], AXIS_Z, -1, { pos: 'Inversione (pianta in dentro)', neg: 'Eversione (pianta in fuori)' }),
      ],
      target: { kind: 'joint', bone: `foot${sx}` },
      marker: { bone: `foot${sx}`, at: head(`foot${sx}`), size: r(MARK_M) },
    });
    bone(`toes${sx}`, `Dita del piede ${m}`, `foot${sx}`, side);
    control({
      id: `toes${sx}`, label: `Dita del piede ${m} (metatarso-falangee)`, group: leg, side, type: 'hinge',
      dofs: [dof('flex', 'Flessione / Estensione', [-60, 40], AXIS_X, 1, { pos: 'Flessione (dita giù)', neg: 'Estensione (dita su)' })],
      target: { kind: 'joint', bone: `toes${sx}` },
      marker: { bone: `toes${sx}`, at: head(`toes${sx}`), size: r(MARK_S * 1.2) },
    });
  }

  return { height, scale, bones, controls };
}
