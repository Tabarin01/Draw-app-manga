#!/usr/bin/env node
/**
 * Costruisce i livelli anatomici del corpo a partire dall'atlante BodyParts3D 4.0:
 *   public/anatomy/skeleton.glb  — ossa mobili e centri articolari (la base)
 *   public/anatomy/organs.glb    — organi interni
 *   public/anatomy/vessels.glb   — vasi sanguigni (arterie rosse, vene blu)
 *
 * BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International
 * https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
 *
 * Uso:
 *   1. scarica da https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
 *        partof_BP3D_4.0_obj_99.zip (scompattato), partof_element_parts.txt
 *        e partof_inclusion_relation_list.txt
 *   2. node tools/build-anatomy.mjs <cartella-bp3d> [cartella-output]
 *      (la cartella deve contenere i due .txt e obj/partof_BP3D_4.0_obj_99/*.obj)
 *
 * Cosa fa:
 *   - raggruppa le parti anatomiche (per nome FMA) nelle ossa mobili del nostro scheletro
 *   - converte le coordinate: mm, Z in alto, fronte −Y  →  metri, Y in alto, fronte +Z
 *   - alleggerisce le mesh troppo dense (clustering dei vertici)
 *   - calcola i centri articolari dalla geometria reale:
 *       contatto  = baricentro delle superfici affacciate di due ossa
 *       sfera     = sfera che approssima la testa articolare (anca, spalla)
 *   - lega organi e vasi alle ossa più vicine (pesi di skinning), così seguono la posa
 */
import fs from 'node:fs';
import path from 'node:path';

const [srcDir, outDir = 'public/anatomy'] = process.argv.slice(2);
if (!srcDir) {
  console.error('Uso: node tools/build-anatomy.mjs <cartella-bp3d> [cartella-output]');
  process.exit(1);
}
const objDir = path.join(srcDir, 'obj', 'partof_BP3D_4.0_obj_99');

// ---------------------------------------------------------------------------
// Nomi FMA → file OBJ
// ---------------------------------------------------------------------------
const filesByName = new Map();
for (const line of fs.readFileSync(path.join(srcDir, 'partof_element_parts.txt'), 'utf8').split(/\r?\n/).slice(1)) {
  const [, name, fj] = line.split('\t');
  if (!name || !fj) continue;
  if (!filesByName.has(name)) filesByName.set(name, []);
  filesByName.get(name).push(fj);
}

// ---------------------------------------------------------------------------
// Ossa del nostro scheletro → parti anatomiche
// ---------------------------------------------------------------------------
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const FINGERS = { 2: 'index finger', 3: 'middle finger', 4: 'ring finger', 5: 'little finger' };
const TOES = ['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe'];

const BONES = {
  pelvis: ['left hip bone', 'right hip bone', 'sacrum'],
  skull: ['skull'],
  sternum: ['sternum', ...[1, 2, 3, 4, 5, 6, 7].flatMap((i) => [`left ${ORD[i - 1]} costal cartilage`, `right ${ORD[i - 1]} costal cartilage`])],
  C1: ['atlas'],
  C2: ['axis'],
};
for (let i = 3; i <= 7; i++) BONES[`C${i}`] = [`${ORD[i - 1]} cervical vertebra`];
for (let i = 1; i <= 12; i++) BONES[`T${i}`] = [`${ORD[i - 1]} thoracic vertebra`];
for (let i = 1; i <= 5; i++) BONES[`L${i}`] = [`${ORD[i - 1]} lumbar vertebra`];
for (const [S, side] of [['L', 'left'], ['R', 'right']]) {
  for (let i = 1; i <= 12; i++) BONES[`rib${i}_${S}`] = [`${side} ${ORD[i - 1]} rib`];
  Object.assign(BONES, {
    [`clavicle_${S}`]: [`${side} clavicle`],
    [`scapula_${S}`]: [`${side} scapula`],
    [`humerus_${S}`]: [`${side} humerus`],
    [`ulna_${S}`]: [`${side} ulna`],
    [`radius_${S}`]: [`${side} radius`],
    [`carpus_${S}`]: [
      ...['scaphoid', 'lunate', 'triquetral', 'pisiform', 'trapezium', 'trapezoid', 'capitate', 'hamate'].map((b) => `${side} ${b}`),
      ...[2, 3, 4, 5].map((n) => `${side} ${ORD[n - 1]} metacarpal bone`),
    ],
    [`thumbMC_${S}`]: [`${side} first metacarpal bone`],
    [`thumbP_${S}`]: [`proximal phalanx of ${side} thumb`],
    [`thumbD_${S}`]: [`distal phalanx of ${side} thumb`],
    [`femur_${S}`]: [`${side} femur`],
    [`patella_${S}`]: [`${side} patella`],
    [`tibia_${S}`]: [`${side} tibia`, `${side} fibula`],
    [`foot_${S}`]: [
      `${side} talus`, `${side} calcaneus`, `navicular bone of ${side} foot`, `${side} cuboid bone`,
      `${side} medial cuneiform bone`, `${side} intermediate cuneiform bone`, `${side} lateral cuneiform bone`,
      ...[1, 2, 3, 4, 5].map((n) => `${side} ${ORD[n - 1]} metatarsal bone`),
    ],
    // prima le 5 falangi prossimali (servono per il centro delle metatarso-falangee);
    // l'alluce non ha la falange media
    [`toes_${S}`]: [
      ...TOES.map((t) => `proximal phalanx of ${side} ${t}`),
      ...TOES.slice(1).map((t) => `middle phalanx of ${side} ${t}`),
      ...TOES.map((t) => `distal phalanx of ${side} ${t}`),
    ],
  });
  for (const [n, f] of Object.entries(FINGERS)) {
    BONES[`f${n}p_${S}`] = [`proximal phalanx of ${side} ${f}`];
    BONES[`f${n}m_${S}`] = [`middle phalanx of ${side} ${f}`];
    BONES[`f${n}d_${S}`] = [`distal phalanx of ${side} ${f}`];
  }
}

// ---------------------------------------------------------------------------
// Lettura OBJ (coordinate già convertite: metri, Y su, fronte +Z)
// ---------------------------------------------------------------------------
function readObj(fj) {
  const file = path.join(objDir, `${fj}.obj`);
  if (!fs.existsSync(file)) return null;
  const pos = [];
  const idx = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
      pos.push(x / 1000, z / 1000, -y / 1000);
    } else if (line.startsWith('f ')) {
      const f = line.slice(2).trim().split(/\s+/).map((t) => parseInt(t, 10) - 1);
      for (let i = 1; i + 1 < f.length; i++) idx.push(f[0], f[i], f[i + 1]);
    }
  }
  return { pos, idx };
}

/** Parti (per nome) → { pos, idx, partOf: indice parte per vertice } */
const partCache = new Map();
function loadParts(names) {
  const pos = [];
  const idx = [];
  const partOf = [];
  names.forEach((name, p) => {
    const fjs = filesByName.get(name);
    if (!fjs) throw new Error(`Parte non trovata nell'atlante: "${name}"`);
    for (const fj of fjs) {
      let m = partCache.get(fj);
      if (m === undefined) partCache.set(fj, (m = readObj(fj)));
      if (!m) continue;
      const base = pos.length / 3;
      pos.push(...m.pos);
      for (const i of m.idx) idx.push(i + base);
      for (let i = 0; i < m.pos.length / 3; i++) partOf.push(p);
    }
  });
  return { pos, idx, partOf, names };
}

// ---------------------------------------------------------------------------
// Alleggerimento: clustering dei vertici su griglia
// ---------------------------------------------------------------------------
function decimate(mesh, cell) {
  const map = new Map();
  const sums = [];
  const remap = new Int32Array(mesh.pos.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = mesh.pos[3 * i], y = mesh.pos[3 * i + 1], z = mesh.pos[3 * i + 2];
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    let c = map.get(key);
    if (c === undefined) {
      c = sums.length / 4;
      map.set(key, c);
      sums.push(0, 0, 0, 0);
    }
    sums[4 * c] += x; sums[4 * c + 1] += y; sums[4 * c + 2] += z; sums[4 * c + 3] += 1;
    remap[i] = c;
  }
  const pos = [];
  for (let c = 0; c < sums.length / 4; c++) pos.push(sums[4 * c] / sums[4 * c + 3], sums[4 * c + 1] / sums[4 * c + 3], sums[4 * c + 2] / sums[4 * c + 3]);
  const idx = [];
  const seen = new Set();
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const a = remap[mesh.idx[t]], b = remap[mesh.idx[t + 1]], c = remap[mesh.idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((p, q) => p - q).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    idx.push(a, b, c);
  }
  return { pos, idx };
}

// ---------------------------------------------------------------------------
// Geometria dei contatti
// ---------------------------------------------------------------------------
function points(mesh, filter) {
  const out = [];
  for (let i = 0; i < mesh.pos.length / 3; i++) {
    const p = [mesh.pos[3 * i], mesh.pos[3 * i + 1], mesh.pos[3 * i + 2]];
    if (!filter || filter(p, mesh.partOf?.[i])) out.push(p);
  }
  return out;
}

function grid(pts, cell) {
  const g = new Map();
  for (const p of pts) {
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(p);
  }
  return g;
}

function nearestDist(g, cell, p) {
  const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const list = g.get(`${cx + dx},${cy + dy},${cz + dz}`);
    if (!list) continue;
    for (const q of list) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Vertici di A affacciati a B (entro una soglia che cresce finché non ne trova abbastanza). */
function facing(a, b, minCount = 25) {
  const cell = 0.03;
  const gb = grid(b, cell);
  const d = a.map((p) => nearestDist(gb, cell, p));
  for (let tau = 0.003; tau <= 0.03; tau += 0.002) {
    const sel = a.filter((_, i) => d[i] <= tau);
    if (sel.length >= minCount) return sel;
  }
  return a.filter((_, i) => d[i] <= 0.03);
}

const centroid = (pts) => {
  const c = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return c.map((v) => v / Math.max(1, pts.length));
};

/** Centro di un giunto = baricentro delle due superfici affacciate. */
function contactCenter(a, b) {
  const fa = facing(a, b);
  const fb = facing(b, a);
  if (fa.length + fb.length === 0) throw new Error('Nessun contatto trovato');
  return centroid([...fa, ...fb]);
}

/** Sfera ai minimi quadrati: x²+y²+z² = 2ax + 2by + 2cz + d. */
function fitSphere(pts) {
  const A = Array.from({ length: 4 }, () => new Array(5).fill(0));
  for (const [x, y, z] of pts) {
    const row = [2 * x, 2 * y, 2 * z, 1];
    const rhs = x * x + y * y + z * z;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
      A[i][4] += row[i] * rhs;
    }
  }
  for (let i = 0; i < 4; i++) {
    let piv = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    for (let r = 0; r < 4; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c < 5; c++) A[r][c] -= f * A[i][c];
    }
  }
  const s = A.map((row, i) => row[4] / row[i]);
  return [s[0], s[1], s[2]];
}

/** Centro di una testa articolare sferica: sfera sui vertici della testa affacciati alla cavità. */
function ballCenter(head, socket) {
  const near = facing(head, socket, 60);
  // allarga la calotta: tutti i vertici della testa entro 2.5 cm dal baricentro del contatto
  const c = centroid(near);
  const cap = head.filter((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < 0.025);
  return fitSphere(cap.length > near.length ? cap : near);
}

// ---------------------------------------------------------------------------
// Carica tutte le ossa
// ---------------------------------------------------------------------------
console.log('Lettura dell\'atlante…');
const bones = {};
for (const [id, names] of Object.entries(BONES)) bones[id] = loadParts(names);

const P = (id, filter) => points(bones[id], filter);
const partIs = (id, name) => (_p, part) => bones[id].names[part] === name;
const midY = (id) => {
  const ys = P(id).map((p) => p[1]);
  return (Math.min(...ys) + Math.max(...ys)) / 2;
};
const upper = (id) => { const m = midY(id); return (p) => p[1] > m; };
const lower = (id) => { const m = midY(id); return (p) => p[1] < m; };

// ---------------------------------------------------------------------------
// Centri articolari (posizione della "testa" di ogni osso = giunto con il genitore)
// ---------------------------------------------------------------------------
console.log('Calcolo dei centri articolari…');
const heads = {};
const extra = {};

const spine = ['L5', 'L4', 'L3', 'L2', 'L1', ...Array.from({ length: 12 }, (_, i) => `T${12 - i}`), ...Array.from({ length: 7 }, (_, i) => `C${7 - i}`)];
heads.L5 = contactCenter(P('L5', lower('L5')), P('pelvis', partIs('pelvis', 'sacrum')));
for (let i = 1; i < spine.length; i++) heads[spine[i]] = contactCenter(P(spine[i], lower(spine[i])), P(spine[i - 1], upper(spine[i - 1])));
heads.skull = contactCenter(P('skull', (p) => p[1] < midY('C1') + 0.04), P('C1'));
heads.sternum = (() => { const pts = P('sternum', partIs('sternum', 'sternum')); const top = Math.max(...pts.map((p) => p[1])); return centroid(pts.filter((p) => p[1] > top - 0.01)); })();

for (const S of ['L', 'R']) {
  for (let i = 1; i <= 12; i++) heads[`rib${i}_${S}`] = contactCenter(P(`rib${i}_${S}`), P(`T${i}`));
  heads[`clavicle_${S}`] = contactCenter(P(`clavicle_${S}`), P('sternum', partIs('sternum', 'sternum')));
  heads[`scapula_${S}`] = contactCenter(P(`scapula_${S}`), P(`clavicle_${S}`));
  heads[`humerus_${S}`] = ballCenter(P(`humerus_${S}`, upper(`humerus_${S}`)), P(`scapula_${S}`));
  heads[`ulna_${S}`] = contactCenter(P(`ulna_${S}`, upper(`ulna_${S}`)), P(`humerus_${S}`, lower(`humerus_${S}`)));
  // il radio ruota attorno all'asse che va dall'articolazione radio-ulnare prossimale a quella distale
  const pruj = contactCenter(P(`radius_${S}`, upper(`radius_${S}`)), P(`ulna_${S}`, upper(`ulna_${S}`)));
  const druj = contactCenter(P(`radius_${S}`, lower(`radius_${S}`)), P(`ulna_${S}`, lower(`ulna_${S}`)));
  heads[`radius_${S}`] = pruj;
  extra[`druj_${S}`] = druj;
  heads[`carpus_${S}`] = contactCenter(P(`carpus_${S}`, (_p, part) => part < 8), P(`radius_${S}`, lower(`radius_${S}`)));
  heads[`thumbMC_${S}`] = contactCenter(P(`thumbMC_${S}`), P(`carpus_${S}`, partIs(`carpus_${S}`, `${S === 'L' ? 'left' : 'right'} trapezium`)));
  heads[`thumbP_${S}`] = contactCenter(P(`thumbP_${S}`), P(`thumbMC_${S}`));
  heads[`thumbD_${S}`] = contactCenter(P(`thumbD_${S}`), P(`thumbP_${S}`));
  for (const n of [2, 3, 4, 5]) {
    const mc = `${S === 'L' ? 'left' : 'right'} ${ORD[n - 1]} metacarpal bone`;
    heads[`f${n}p_${S}`] = contactCenter(P(`f${n}p_${S}`), P(`carpus_${S}`, partIs(`carpus_${S}`, mc)));
    heads[`f${n}m_${S}`] = contactCenter(P(`f${n}m_${S}`), P(`f${n}p_${S}`));
    heads[`f${n}d_${S}`] = contactCenter(P(`f${n}d_${S}`), P(`f${n}m_${S}`));
  }
  heads[`femur_${S}`] = ballCenter(P(`femur_${S}`, upper(`femur_${S}`)), P('pelvis', partIs('pelvis', `${S === 'L' ? 'left' : 'right'} hip bone`)));
  heads[`tibia_${S}`] = contactCenter(P(`tibia_${S}`, upper(`tibia_${S}`)), P(`femur_${S}`, lower(`femur_${S}`)));
  heads[`patella_${S}`] = centroid(P(`patella_${S}`));
  heads[`foot_${S}`] = contactCenter(P(`foot_${S}`, partIs(`foot_${S}`, `${S === 'L' ? 'left' : 'right'} talus`)), P(`tibia_${S}`, lower(`tibia_${S}`)));
  heads[`toes_${S}`] = contactCenter(P(`toes_${S}`, (_p, part) => part < 5), P(`foot_${S}`));
}
heads.pelvis = heads.femur_L.map((v, i) => (v + heads.femur_R[i]) / 2);

// ---------------------------------------------------------------------------
// Riferimento: piedi a terra (y = 0), anche centrate in x e z
// ---------------------------------------------------------------------------
let minY = Infinity, maxY = -Infinity;
for (const b of Object.values(bones)) for (let i = 1; i < b.pos.length; i += 3) { minY = Math.min(minY, b.pos[i]); maxY = Math.max(maxY, b.pos[i]); }
const shift = [-heads.pelvis[0], -minY, -heads.pelvis[2]];
const move = (p) => p.map((v, i) => +(v + shift[i]).toFixed(5));
for (const k of Object.keys(heads)) heads[k] = move(heads[k]);
for (const k of Object.keys(extra)) extra[k] = move(extra[k]);
const centers = {};
for (const [id, b] of Object.entries(bones)) centers[id] = move(centroid(points(b)));


const ATTRIBUTION = 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International';
const applyShift = (pos) => { for (let i = 0; i < pos.length; i += 3) { pos[i] += shift[0]; pos[i + 1] += shift[1]; pos[i + 2] += shift[2]; } };

// ---------------------------------------------------------------------------
// Livello 1 — Scheletro
// ---------------------------------------------------------------------------
console.log('Scheletro: alleggerimento…');
const boneMeshes = [];
for (const [id, b] of Object.entries(bones)) {
  const vCount = b.pos.length / 3;
  const cell = vCount > 40000 ? 0.0022 : vCount > 8000 ? 0.0016 : 0;
  const m = cell ? decimate(b, cell) : { pos: b.pos.slice(), idx: b.idx };
  applyShift(m.pos);
  boneMeshes.push({ id, pos: m.pos, idx: m.idx });
}
const jointNames = boneMeshes.map((m) => m.id);

// ---------------------------------------------------------------------------
// Skinning: ogni vertice dei tessuti molli segue le ossa più vicine
// ---------------------------------------------------------------------------
/** Nuvola di punti delle ossa (sottocampionata) indicizzata su griglia. */
const SKIN_CELL = 0.02;
const boneGrid = new Map();
boneMeshes.forEach((m, b) => {
  const sparse = decimate({ pos: m.pos, idx: [] }, 0.006).pos;
  for (let i = 0; i < sparse.length; i += 3) {
    const p = [sparse[i], sparse[i + 1], sparse[i + 2]];
    const k = `${Math.floor(p[0] / SKIN_CELL)},${Math.floor(p[1] / SKIN_CELL)},${Math.floor(p[2] / SKIN_CELL)}`;
    if (!boneGrid.has(k)) boneGrid.set(k, []);
    boneGrid.get(k).push([p[0], p[1], p[2], b]);
  }
});

/**
 * Pesi di skinning per un punto: contribuiscono le ossa entro 1.5 cm dalla più vicina,
 * con peso inversamente proporzionale al quadrato della distanza (al massimo 4 ossa).
 * Vicino a un'articolazione il tessuto si divide tra le due ossa e si piega in modo continuo.
 */
function skinWeights(p) {
  const cx = Math.floor(p[0] / SKIN_CELL), cy = Math.floor(p[1] / SKIN_CELL), cz = Math.floor(p[2] / SKIN_CELL);
  const best = new Map();
  let d1 = Infinity;
  for (let ring = 0; ring <= 15; ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue; // solo il guscio nuovo
      const list = boneGrid.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!list) continue;
      for (const q of list) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (d < (best.get(q[3]) ?? Infinity)) best.set(q[3], d);
        if (d < d1) d1 = d;
      }
    }
    if (d1 + 0.015 <= ring * SKIN_CELL) break; // i gusci successivi non possono contenere candidati migliori
  }
  const cand = [...best.entries()].filter(([, d]) => d <= d1 + 0.015).sort((a, b) => a[1] - b[1]).slice(0, 4);
  const w = cand.map(([, d]) => 1 / (d + 0.003) ** 2);
  const sum = w.reduce((a, b) => a + b, 0);
  return cand.map(([bone], i) => [bone, w[i] / sum]);
}

/**
 * Articolazioni attraversate dai tessuti lunghi (vasi, in futuro muscoli e pelle).
 * [ossa a monte, osso a valle, ampiezza della fascia di transizione, raggio d'azione]
 * Vicino al giunto il peso passa con continuità dall'osso a monte a quello a valle
 * lungo l'asse dell'osso a valle: il tessuto si piega come un tubo invece di strapparsi.
 */
const boneIndex = new Map(jointNames.map((id, i) => [id, i]));
const JOINT_BLENDS = ['L', 'R'].flatMap((S) => [
  [['pelvis'], `femur_${S}`, 0.06, 0.14],
  [[`femur_${S}`], `tibia_${S}`, 0.04, 0.1],
  [[`tibia_${S}`], `foot_${S}`, 0.03, 0.07],
  [[`scapula_${S}`, `clavicle_${S}`], `humerus_${S}`, 0.05, 0.12],
  [[`humerus_${S}`], `ulna_${S}`, 0.04, 0.09],
  [[`humerus_${S}`], `radius_${S}`, 0.04, 0.09],
  [[`radius_${S}`, `ulna_${S}`], `carpus_${S}`, 0.025, 0.06],
].map(([parents, child, band, radius]) => {
  const h = heads[child];
  const c = centers[child];
  const axis = [c[0] - h[0], c[1] - h[1], c[2] - h[2]];
  const len = Math.hypot(...axis);
  return { parents: parents.map((p) => boneIndex.get(p)), child: boneIndex.get(child), head: h, axis: axis.map((v) => v / len), band, radius };
}));

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function jointAwareWeights(p, list) {
  const dominant = list[0]?.[0];
  for (const j of JOINT_BLENDS) {
    if (dominant !== j.child && !j.parents.includes(dominant)) continue;
    const d = [p[0] - j.head[0], p[1] - j.head[1], p[2] - j.head[2]];
    if (Math.hypot(...d) > j.radius) continue;
    const t = d[0] * j.axis[0] + d[1] * j.axis[1] + d[2] * j.axis[2];
    const wChild = smoothstep(-j.band, j.band, t);
    const parent = list.find(([b]) => j.parents.includes(b))?.[0] ?? j.parents[0];
    return [[j.child, wChild], [parent, 1 - wChild]].filter(([, w]) => w > 0.001).sort((a, b) => b[1] - a[1]);
  }
  return list;
}

/**
 * Torsione dell'avambraccio: nella prono-supinazione il radio ruota attorno all'ulna e i
 * tessuti si torcono gradualmente (fermi al gomito, solidali al radio verso il polso).
 * Il peso destinato all'avambraccio si divide tra ulna e radio in base alla distanza dal gomito.
 */
const FOREARMS = ['L', 'R'].map((S) => {
  const e = heads[`ulna_${S}`];
  const w = heads[`carpus_${S}`];
  const axis = [w[0] - e[0], w[1] - e[1], w[2] - e[2]];
  const len = Math.hypot(...axis);
  return { ulna: boneIndex.get(`ulna_${S}`), radius: boneIndex.get(`radius_${S}`), elbow: e, axis: axis.map((v) => v / len), len };
});

function forearmTwist(p, list) {
  for (const f of FOREARMS) {
    const share = list.filter(([b]) => b === f.ulna || b === f.radius).reduce((a, [, w]) => a + w, 0);
    if (share === 0) continue;
    const d = [p[0] - f.elbow[0], p[1] - f.elbow[1], p[2] - f.elbow[2]];
    const t = Math.min(1, Math.max(0, (d[0] * f.axis[0] + d[1] * f.axis[1] + d[2] * f.axis[2]) / f.len));
    const rest = list.filter(([b]) => b !== f.ulna && b !== f.radius);
    return [...rest, [f.ulna, share * (1 - t)], [f.radius, share * t]].filter(([, w]) => w > 0.001).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }
  return list;
}

/** Pesi quantizzati su 8 bit, con somma esattamente 255. */
function packWeights(list) {
  const joints = [0, 0, 0, 0];
  const weights = [0, 0, 0, 0];
  list.forEach(([b, w], i) => { joints[i] = b; weights[i] = Math.round(w * 255); });
  weights[0] += 255 - weights.reduce((a, b) => a + b, 0);
  return { joints, weights };
}

// ---------------------------------------------------------------------------
// Livelli dei tessuti molli: organi e vasi sanguigni
// ---------------------------------------------------------------------------
const kids = new Map();
for (const line of fs.readFileSync(path.join(srcDir, 'partof_inclusion_relation_list.txt'), 'utf8').split(/\r?\n/).slice(1)) {
  const [, parentName, , childName] = line.split('\t');
  if (!childName) continue;
  if (!kids.has(parentName)) kids.set(parentName, []);
  kids.get(parentName).push(childName);
}
/** Tutti i file OBJ di un concetto e dei suoi discendenti. */
function filesOf(name, seen = new Set()) {
  const out = new Set(filesByName.get(name) ?? []);
  for (const c of kids.get(name) ?? []) if (!seen.has(c)) { seen.add(c); for (const f of filesOf(c, seen)) out.add(f); }
  return out;
}
const namesOfFile = new Map();
for (const [name, fjs] of filesByName) for (const fj of fjs) {
  if (!namesOfFile.has(fj)) namesOfFile.set(fj, []);
  namesOfFile.get(fj).push(name);
}

const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

const ORGANS = [
  ['heart', 'Cuore', 0x9e2a2b],
  ['left lung', 'Polmone sinistro', 0xe7a1a8], ['right lung', 'Polmone destro', 0xe7a1a8],
  ['trachea', 'Trachea', 0xdcc8b4],
  ['esophagus', 'Esofago', 0xd9907e], ['stomach', 'Stomaco', 0xd9907e],
  ['duodenum', 'Duodeno', 0xe3a58f], ['small intestine', 'Intestino tenue', 0xe3a58f],
  ['large intestine', 'Intestino crasso', 0xc98a6c], ['rectum', 'Retto', 0xc98a6c],
  ['liver', 'Fegato', 0x8b3a2b], ['gallbladder', 'Cistifellea', 0x6b8f3a], ['pancreas', 'Pancreas', 0xe5c07b],
  ['left kidney', 'Rene sinistro', 0x9b3b3b], ['right kidney', 'Rene destro', 0x9b3b3b],
  ['left ureter', 'Uretere sinistro', 0xd8b2a0], ['right ureter', 'Uretere destro', 0xd8b2a0],
  ['urinary bladder', 'Vescica', 0xd8aaa0],
  ['left adrenal gland', 'Surrene sinistro', 0xd9a441], ['right adrenal gland', 'Surrene destro', 0xd9a441],
  ['thymus', 'Timo', 0xd8bba8],
];
const ARTERY = 0xc0282d;
const VEIN = 0x2f5fb3;

/**
 * Colore anatomico convenzionale di un vaso: arterie rosse, vene blu; nel circolo
 * polmonare è il contrario (le arterie polmonari portano sangue povero di ossigeno).
 */
function vesselColor(fj) {
  const names = (namesOfFile.get(fj) ?? []).join(' | ').toLowerCase();
  if (/pulmonary vein/.test(names)) return ARTERY;
  if (/pulmonary (artery|arterial|trunk)/.test(names)) return VEIN;
  if (/vein|vena|venous|sinus/.test(names)) return VEIN;
  return ARTERY;
}

/**
 * Costruisce un livello: unisce i pezzi (alleggeriti uno per uno, così pezzi vicini
 * non si fondono), assegna colori per vertice e pesi di skinning.
 */
function buildLayer(pieces, cellFor, { crossesJoints = false } = {}) {
  const pos = [], idx = [], col = [], joints = [], weights = [];
  for (const { fj, color } of pieces) {
    const raw = partCache.get(fj) ?? readObj(fj);
    if (!raw) continue;
    const cell = cellFor(raw.pos.length / 3);
    const m = cell ? decimate({ pos: raw.pos, idx: raw.idx }, cell) : { pos: raw.pos.slice(), idx: raw.idx };
    applyShift(m.pos);
    const base = pos.length / 3;
    for (const v of m.pos) pos.push(v);
    for (const i of m.idx) idx.push(i + base);
    const rgb = hex(color);
    for (let i = 0; i < m.pos.length; i += 3) {
      col.push(rgb[0], rgb[1], rgb[2]);
      const p = [m.pos[i], m.pos[i + 1], m.pos[i + 2]];
      const near = skinWeights(p);
      const pw = packWeights(crossesJoints ? forearmTwist(p, jointAwareWeights(p, near)) : near);
      joints.push(...pw.joints);
      weights.push(...pw.weights);
    }
  }
  return { pos, idx, col, joints, weights };
}

console.log('Organi…');
const usedByOrgans = new Set();
const organPieces = [];
const organList = [];
for (const [name, label, color] of ORGANS) {
  const all = [...filesOf(name)];
  if (all.length === 0) { console.warn(`  (non presente nell'atlante: ${name})`); continue; }
  const fjs = all.filter((fj) => !usedByOrgans.has(fj)); // es. il retto è già dentro l'intestino crasso
  for (const fj of fjs) { usedByOrgans.add(fj); organPieces.push({ fj, color }); }
  organList.push({ name, label });
}
const organs = buildLayer(organPieces, (n) => (n > 5000 ? 0.0025 : n > 1500 ? 0.0015 : 0));

console.log('Vasi sanguigni…');
const vesselPieces = [...filesOf('cardiovascular system')]
  .filter((fj) => !usedByOrgans.has(fj))
  .map((fj) => ({ fj, color: vesselColor(fj) }));
const vessels = buildLayer(vesselPieces, (n) => (n > 3000 ? 0.0015 : n > 600 ? 0.001 : 0), { crossesJoints: true });

// ---------------------------------------------------------------------------
// Scrittura GLB
// ---------------------------------------------------------------------------
function writeGlb(meshes, extras, file) {
  const bin = [];
  let offset = 0;
  const bufferViews = [], accessors = [], gltfMeshes = [], nodes = [];
  const push = (buf, target) => {
    const pad = (4 - (buf.byteLength % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.byteLength, target });
    bin.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), Buffer.alloc(pad));
    offset += buf.byteLength + pad;
    return bufferViews.length - 1;
  };
  const attribute = (data, componentType, type, count, extra = {}) => {
    accessors.push({ bufferView: push(data, 34962), componentType, count, type, ...extra });
    return accessors.length - 1;
  };
  for (const m of meshes) {
    const pos = new Float32Array(m.pos);
    const count = pos.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { min[i % 3] = Math.min(min[i % 3], pos[i]); max[i % 3] = Math.max(max[i % 3], pos[i]); }
    const attributes = { POSITION: attribute(pos, 5126, 'VEC3', count, { min, max }) };
    if (m.col) attributes.COLOR_0 = attribute(new Uint8Array(m.col), 5121, 'VEC3', count, { normalized: true });
    if (m.joints) attributes.JOINTS_0 = attribute(new Uint8Array(m.joints), 5121, 'VEC4', count);
    if (m.weights) attributes.WEIGHTS_0 = attribute(new Uint8Array(m.weights), 5121, 'VEC4', count, { normalized: true });
    const idx = count < 65536 ? new Uint16Array(m.idx) : new Uint32Array(m.idx);
    accessors.push({ bufferView: push(idx, 34963), componentType: idx instanceof Uint16Array ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
    gltfMeshes.push({ name: m.id, primitives: [{ attributes, indices: accessors.length - 1 }] });
    nodes.push({ name: m.id, mesh: gltfMeshes.length - 1 });
  }
  const binBuf = Buffer.concat(bin);
  const json = {
    asset: { version: '2.0', generator: 'draw-app-manga/tools/build-anatomy.mjs', copyright: ATTRIBUTION },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i), extras }],
    nodes, meshes: gltfMeshes, accessors, bufferViews,
    buffers: [{ byteLength: binBuf.byteLength }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.byteLength % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.byteLength + 8 + binBuf.byteLength, 8);
  const chunk = (buf, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(buf.byteLength, 0); h.writeUInt32LE(type, 4); return [h, buf]; };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, ...chunk(jsonBuf, 0x4e4f534a), ...chunk(binBuf, 0x004e4942)]));
  return fs.statSync(file).size;
}

const report = (label, file, size, meshes) => {
  const v = meshes.reduce((a, m) => a + m.pos.length / 3, 0);
  const t = meshes.reduce((a, m) => a + m.idx.length / 3, 0);
  console.log(`  ${label.padEnd(16)} ${file.padEnd(14)} ${(size / 1e6).toFixed(2)} MB  vertici ${v}  triangoli ${t}`);
};

const modelHeight = +(maxY - minY).toFixed(4);
console.log(`Fatto (altezza modello ${modelHeight} m):`);
report('scheletro', 'skeleton.glb', writeGlb(boneMeshes, { attribution: ATTRIBUTION, modelHeight, heads, centers, extra }, path.join(outDir, 'skeleton.glb')), boneMeshes);
report('organi', 'organs.glb', writeGlb([{ id: 'organs', ...organs }], { attribution: ATTRIBUTION, jointNames, organs: organList }, path.join(outDir, 'organs.glb')), [organs]);
report('vasi sanguigni', 'vessels.glb', writeGlb([{ id: 'vessels', ...vessels }], { attribution: ATTRIBUTION, jointNames }, path.join(outDir, 'vessels.glb')), [vessels]);
