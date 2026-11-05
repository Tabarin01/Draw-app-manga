#!/usr/bin/env node
/**
 * Costruisce public/anatomy/skeleton.glb a partire dall'atlante BodyParts3D 4.0.
 *
 * BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International
 * https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
 *
 * Uso:
 *   1. scarica da https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
 *        partof_BP3D_4.0_obj_99.zip  (scompattato)  e  partof_element_parts.txt
 *   2. node tools/build-anatomy.mjs <cartella-bp3d> [public/anatomy/skeleton.glb]
 *      (la cartella deve contenere partof_element_parts.txt e obj/partof_BP3D_4.0_obj_99/*.obj)
 *
 * Cosa fa:
 *   - raggruppa le parti anatomiche (per nome FMA) nelle ossa mobili del nostro scheletro
 *   - converte le coordinate: mm, Z in alto, fronte −Y  →  metri, Y in alto, fronte +Z
 *   - alleggerisce le mesh troppo dense (clustering dei vertici)
 *   - calcola i centri articolari dalla geometria reale:
 *       contatto  = baricentro delle superfici affacciate di due ossa
 *       sfera     = sfera che approssima la testa articolare (anca, spalla)
 *   - scrive un GLB con un nodo per osso e i punti di repere negli "extras" della scena
 */
import fs from 'node:fs';
import path from 'node:path';

const [srcDir, outFile = 'public/anatomy/skeleton.glb'] = process.argv.slice(2);
if (!srcDir) {
  console.error('Uso: node tools/build-anatomy.mjs <cartella-bp3d> [output.glb]');
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

// ---------------------------------------------------------------------------
// Mesh finali (alleggerite) e scrittura GLB
// ---------------------------------------------------------------------------
console.log('Alleggerimento e scrittura…');
const meshes = [];
let totalV = 0, totalT = 0;
for (const [id, b] of Object.entries(bones)) {
  const vCount = b.pos.length / 3;
  const cell = vCount > 40000 ? 0.0022 : vCount > 8000 ? 0.0016 : 0;
  const m = cell ? decimate(b, cell) : { pos: b.pos, idx: b.idx };
  for (let i = 0; i < m.pos.length; i += 3) { m.pos[i] += shift[0]; m.pos[i + 1] += shift[1]; m.pos[i + 2] += shift[2]; }
  meshes.push({ id, ...m });
  totalV += m.pos.length / 3;
  totalT += m.idx.length / 3;
}

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
  for (const m of meshes) {
    const pos = new Float32Array(m.pos);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { min[i % 3] = Math.min(min[i % 3], pos[i]); max[i % 3] = Math.max(max[i % 3], pos[i]); }
    const idx = pos.length / 3 < 65536 ? new Uint16Array(m.idx) : new Uint32Array(m.idx);
    accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: push(idx, 34963), componentType: idx instanceof Uint16Array ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
    gltfMeshes.push({ name: m.id, primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1 }] });
    nodes.push({ name: m.id, mesh: gltfMeshes.length - 1 });
  }
  const binBuf = Buffer.concat(bin);
  const json = {
    asset: { version: '2.0', generator: 'draw-app-manga/tools/build-anatomy.mjs', copyright: extras.attribution },
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
}

writeGlb(meshes, {
  attribution: 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International',
  modelHeight: +(maxY - minY).toFixed(4),
  heads,
  centers,
  extra,
}, outFile);

console.log(`Fatto: ${outFile}`);
console.log(`  ossa: ${meshes.length}, vertici: ${totalV}, triangoli: ${totalT}, altezza modello: ${(maxY - minY).toFixed(3)} m`);
console.log(`  dimensione: ${(fs.statSync(outFile).size / 1e6).toFixed(2)} MB`);
