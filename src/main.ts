import './style.css';
import * as THREE from 'three';
import { Viewport, type DisplayMode } from './engine/Viewport';
import { defaultMangaParams } from './engine/manga/params';
import { buildBodyDefinition, type BodyDefinition, type ControlDef } from './engine/body/bodyDefinition';
import { Skeleton, MARKER_LAYER, LAYER_LABEL, type LayerId } from './engine/body/Skeleton';
import { loadAnatomy, type AnatomyData } from './engine/body/anatomyAsset';
import { GLENOHUMERAL_MAX, neutralPose, solvePose, type Pose, type ShoulderInfo } from './engine/body/nervousSystem';
import { JOINT_TYPE_COLOR, JOINT_TYPE_LABEL, describeDof, type JointType } from './engine/body/joints';
import { exportPanel, downloadBlob } from './engine/export/exportPanel';
import { section, slider, select, checkbox, button, buttonRow } from './ui/controls';

// Stato iniziale impostabile dall'URL (utile per test e confronti):
//   ?h=175&select=elbow_L&mode=manga&cam=side&demo=1
const query = new URLSearchParams(location.search);

const viewportEl = document.getElementById('viewport')!;
const panelEl = document.getElementById('panel')!;
const statusEl = document.getElementById('status')!;

const viewport = new Viewport(viewportEl, defaultMangaParams());
viewport.mode = (query.get('mode') as DisplayMode) ?? '3d';

const state = {
  height: Number(query.get('h') ?? 170) / 100,
  coordination: query.get('coord') !== '0',
  markers: query.get('markers') !== '0',
  // ?layers=skeleton,vessels — livelli anatomici visibili (predefinito: tutti)
  layers: new Set<LayerId>(
    (query.get('layers')?.split(',') as LayerId[] | undefined) ?? (Object.keys(LAYER_LABEL) as LayerId[]),
  ),
  selected: query.get('select') ?? 'shoulder_L',
};

const ANATOMY_URL = `${import.meta.env.BASE_URL}anatomy/`;

function applyLayerVisibility(): void {
  for (const layer of skeleton.layers) skeleton.setLayerVisible(layer, state.layers.has(layer));
}

// Inizializzati in main(), dopo il caricamento dell'atlante anatomico.
let anatomy: AnatomyData;
let body: BodyDefinition;
let skeleton: Skeleton;
let controlsById = new Map<string, ControlDef>();
let pose: Pose = {};

// ---------------------------------------------------------------------------
// Aggiornamento: intenzioni (pose) → sistema nervoso → rotazioni delle ossa
// ---------------------------------------------------------------------------
let lastShoulders: Partial<Record<'L' | 'R', ShoulderInfo>> = {};

function update(): void {
  const out = solvePose(body, pose, { coordination: state.coordination });
  skeleton.applyRotations(out.rotations);
  lastShoulders = out.shoulders;
  renderInfo();
}

function rebuildBody(height: number): void {
  skeleton.dispose();
  body = buildBodyDefinition(anatomy, height);
  controlsById = new Map(body.controls.map((c) => [c.id, c]));
  skeleton = new Skeleton(body, anatomy);
  skeleton.setMarkersVisible(state.markers);
  applyLayerVisibility();
  skeleton.setSelected(state.selected);
  viewport.scene.add(skeleton.root);
  update();
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const CAMERAS = {
  front: { label: 'Fronte', dir: new THREE.Vector3(0, 0.08, 1) },
  side: { label: 'Lato', dir: new THREE.Vector3(1, 0.08, 0) },
  threeQuarter: { label: '3/4', dir: new THREE.Vector3(0.7, 0.15, 0.75) },
} as const;
type CameraName = keyof typeof CAMERAS;

function frameBody(name: CameraName): void {
  viewport.frameFrom(new THREE.Vector3(0, state.height * 0.5, 0), state.height * 1.12, CAMERAS[name].dir);
}

// ---------------------------------------------------------------------------
// Selezione delle articolazioni con il mouse
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
raycaster.layers.set(MARKER_LAYER);
const pointer = new THREE.Vector2();
let downAt: { x: number; y: number } | null = null;

viewport.renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
viewport.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return; // era un trascinamento
  downAt = null;
  if (!state.markers || viewport.mode !== '3d') return;
  const rect = viewport.renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, viewport.camera);
  const hit = raycaster.intersectObjects(skeleton.markers, false)[0];
  if (hit) selectControl(hit.object.userData.controlId as string);
});

// ---------------------------------------------------------------------------
// Pannello
// ---------------------------------------------------------------------------
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
let jointBox: HTMLElement;
let jointSelect: HTMLSelectElement;
let infoEl: HTMLElement;

function selectControl(id: string): void {
  if (!controlsById.has(id)) return;
  state.selected = id;
  skeleton.setSelected(id);
  jointSelect.value = id;
  renderJoint();
}

function renderJoint(): void {
  jointBox.replaceChildren();
  const c = controlsById.get(state.selected);
  if (!c) return;

  const title = document.createElement('div');
  title.className = 'joint-title';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = hex(JOINT_TYPE_COLOR[c.type]);
  title.append(dot, c.label);
  const type = document.createElement('div');
  type.className = 'joint-type';
  type.textContent = JOINT_TYPE_LABEL[c.type];
  jointBox.append(title, type);

  c.dofs.forEach((d, i) => {
    slider(jointBox, d.label, { min: d.min, max: d.max, step: 1, value: pose[c.id][i], format: (v) => describeDof(d, v) }, (v) => {
      pose[c.id][i] = v;
      update();
    });
  });

  infoEl = document.createElement('div');
  infoEl.className = 'joint-info';
  jointBox.appendChild(infoEl);
  renderInfo();

  button(buttonRow(jointBox), 'Azzera articolazione', () => {
    pose[c.id] = c.dofs.map((d) => Math.min(d.max, Math.max(d.min, 0)));
    update();
    renderJoint();
  });
}

/** Spiega cosa sta facendo il sistema nervoso sull'articolazione selezionata. */
function renderInfo(): void {
  if (!infoEl) return;
  const c = controlsById.get(state.selected);
  const lines: string[] = [];
  if (c?.target.kind === 'shoulder' && c.side !== 'C') {
    const s = lastShoulders[c.side];
    if (s) {
      if (pose[c.id][0] > s.limit) lines.push(`In questa direzione il braccio si alza al massimo di ${Math.round(s.limit)}°.`);
      if (!state.coordination && pose[c.id][0] > GLENOHUMERAL_MAX) {
        lines.push(`Senza la scapola la spalla si ferma a ${GLENOHUMERAL_MAX}°: accendi il coordinamento per andare oltre.`);
      }
      if (state.coordination && s.total > 0) {
        lines.push(`Ritmo scapolo-omerale: ${Math.round(s.total)}° = omero ${Math.round(s.glenohumeral)}° + scapola ${Math.round(s.scapular)}°`);
      }
    }
  }
  if (c?.target.kind === 'region') {
    lines.push(`Il movimento si distribuisce su ${c.target.bones.length} vertebre.`);
  }
  if (c?.id.startsWith('wrist_') && pose[c.id][2] > 0) {
    lines.push('Sinergia: la chiusura flette insieme tutte le dita e il pollice.');
  }
  infoEl.textContent = lines.join('\n');
  infoEl.hidden = lines.length === 0;
}

function buildPanel(): void {
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Clicca un pallino colorato sullo scheletro per scegliere un\'articolazione. Trascina per girare la camera, rotella per lo zoom.';
  panelEl.appendChild(hint);

  // --- Articolazione ---
  const joint = section(panelEl, 'Articolazione');
  jointSelect = document.createElement('select');
  jointSelect.className = 'joint-select';
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const c of body.controls) {
    let g = groups.get(c.group);
    if (!g) {
      g = document.createElement('optgroup');
      g.label = c.group;
      groups.set(c.group, g);
      jointSelect.appendChild(g);
    }
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.label;
    g.appendChild(opt);
  }
  jointSelect.addEventListener('change', () => selectControl(jointSelect.value));
  joint.appendChild(jointSelect);
  jointBox = document.createElement('div');
  joint.appendChild(jointBox);

  // --- Sistema nervoso ---
  // --- Livelli anatomici ---
  const livelli = section(panelEl, 'Livelli');
  for (const layer of skeleton.layers) {
    checkbox(livelli, LAYER_LABEL[layer], state.layers.has(layer), (v) => {
      if (v) state.layers.add(layer);
      else state.layers.delete(layer);
      applyLayerVisibility();
    });
  }

  const nervous = section(panelEl, 'Sistema nervoso');
  checkbox(nervous, 'Coordinamento automatico', state.coordination, (v) => {
    state.coordination = v;
    update();
  });
  const expl = document.createElement('p');
  expl.className = 'hint';
  expl.textContent =
    'Acceso: oltre i 30° di elevazione la scapola accompagna il braccio (1° ogni 2°), come nel corpo reale. ' +
    'Spento: lavora solo l\'articolazione della spalla e il braccio si ferma prima.';
  nervous.appendChild(expl);

  // --- Corpo ---
  const corpo = section(panelEl, 'Corpo');
  slider(corpo, 'Altezza', { min: 140, max: 210, step: 1, value: Math.round(state.height * 100), unit: ' cm' }, (v) => {
    state.height = v / 100;
    rebuildBody(state.height);
  });
  button(buttonRow(corpo), 'Azzera tutta la posa', () => {
    pose = neutralPose(body);
    update();
    renderJoint();
  });

  // --- Vista ---
  const vista = section(panelEl, 'Vista');
  select(vista, 'Modalità', { '3d': 'Manichino 3D', manga: 'Vignetta manga' } as Record<DisplayMode, string>, viewport.mode, (v) => {
    viewport.mode = v;
  });
  const cams = buttonRow(vista);
  for (const [k, cam] of Object.entries(CAMERAS) as [CameraName, (typeof CAMERAS)[CameraName]][]) {
    button(cams, cam.label, () => frameBody(k));
  }
  checkbox(vista, 'Mostra articolazioni', state.markers, (v) => {
    state.markers = v;
    skeleton.setMarkersVisible(v);
  });
  const legend = document.createElement('ul');
  legend.className = 'legend';
  for (const t of ['ball', 'hinge', 'pivot', 'saddle', 'condyloid', 'spine'] as JointType[]) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = hex(JOINT_TYPE_COLOR[t]);
    li.append(dot, JOINT_TYPE_LABEL[t].split(' — ')[0]);
    legend.appendChild(li);
  }
  vista.appendChild(legend);

  const credits = document.createElement('p');
  credits.className = 'hint credits';
  credits.innerHTML =
    'Anatomia: <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" target="_blank" rel="noopener">BodyParts3D</a>, ' +
    '© The Database Center for Life Science, ' +
    '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.';
  panelEl.appendChild(credits);

  const esporta = section(panelEl, 'Esporta');
  const exportBtn = button(esporta, 'Scatta vignetta (PNG)', async () => {
    exportBtn.disabled = true;
    setStatus('Esportazione in corso…');
    try {
      const blob = await exportPanel(viewport, 3);
      downloadBlob(blob, `vignetta-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus(`Errore nell'esportazione: ${(err as Error).message}`);
    } finally {
      exportBtn.disabled = false;
    }
  }, true);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
  statusEl.hidden = text === '';
}

/** Posa di prova per i test visivi (?demo=1): non è una "posa fissa" dell'app. */
function applyDemoPose(): void {
  const set = (id: string, values: number[]) => {
    if (pose[id]) values.forEach((v, i) => (pose[id][i] = v));
  };
  set('shoulder_L', [150, 30, 0]);
  set('elbow_L', [70]);
  set('forearm_L', [90]);
  set('shoulder_R', [35, -40, 0]);
  set('wrist_R', [0, 0, 100]);
  set('hip_R', [55, 5, 0]);
  set('knee_R', [85]);
  set('ankle_R', [-20, 0]);
  set('neck', [10, 0, 35]);
  set('thoracic', [0, 0, 15]);
}

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  setStatus('Caricamento dello scheletro anatomico… 0%');
  try {
    anatomy = await loadAnatomy(ANATOMY_URL, (f) => setStatus(`Caricamento del corpo anatomico… ${Math.round(f * 100)}%`));
  } catch (err) {
    console.error(err);
    setStatus(`Impossibile caricare lo scheletro: ${(err as Error).message}`);
    return;
  }
  setStatus('');

  body = buildBodyDefinition(anatomy, state.height);
  controlsById = new Map(body.controls.map((c) => [c.id, c]));
  skeleton = new Skeleton(body, anatomy);
  pose = neutralPose(body);
  viewport.scene.add(skeleton.root);
  viewport.onUpdate(() => skeleton.updateMarkerScale(viewport.camera));
  if (query.has('demo')) applyDemoPose();

  buildPanel();
  skeleton.setMarkersVisible(state.markers);
  applyLayerVisibility();
  selectControl(state.selected);
  update();
  frameBody((query.get('cam') as CameraName) ?? 'threeQuarter');
  if (query.has('focus')) {
    // ?focus=carpus_R&size=0.3 — inquadra da vicino un osso (per controlli di dettaglio)
    const p = skeleton.boneWorldPosition(query.get('focus')!);
    const dir = viewport.camera.position.clone().sub(viewport.controls.target);
    if (p) viewport.frameFrom(p, Number(query.get('size') ?? 0.3), dir);
  }
  document.body.dataset.ready = 'true';
}

main();
