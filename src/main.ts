import './style.css';
import * as THREE from 'three';
import { Viewport, type DisplayMode } from './engine/Viewport';
import { defaultMangaParams, type MangaView, type ShadowStyle } from './engine/manga/params';
import { loadVRM, settlePhysics, updatePose, type VRM } from './engine/character/loadVRM';
import {
  POSES, EXPRESSIONS, applyPose, applyExpression, type PoseName, type ExpressionName,
} from './engine/character/poses';
import { exportPanel, downloadBlob } from './engine/export/exportPanel';
import { section, slider, select, checkbox, button, buttonRow } from './ui/controls';

const MODEL_URL = `${import.meta.env.BASE_URL}models/AvatarSample_E.vrm`;

// Lo stato iniziale si può impostare dall'URL, utile per confronti e test:
//   ?mode=3d&view=lines&pose=wave&expr=happy&shot=close
const query = new URLSearchParams(location.search);

const params = defaultMangaParams();
params.view = (query.get('view') as MangaView) ?? params.view;

const viewportEl = document.getElementById('viewport')!;
const panelEl = document.getElementById('panel')!;
const statusEl = document.getElementById('status')!;

const viewport = new Viewport(viewportEl, params);
viewport.mode = (query.get('mode') as DisplayMode) ?? 'manga';

const state = {
  pose: (query.get('pose') as PoseName) ?? 'relaxed',
  expression: (query.get('expr') as ExpressionName) ?? 'neutral',
  focal: Number(query.get('focal') ?? 50),
};
viewport.setFocalLength(state.focal);

let vrm: VRM | null = null;

// ---------------------------------------------------------------------------
// Inquadrature tipiche, calcolate dalla posizione reale della testa.
// ---------------------------------------------------------------------------
const SHOTS = {
  full: 'Figura intera',
  medium: 'Mezzo busto',
  close: 'Primo piano',
} as const;
type ShotName = keyof typeof SHOTS;

function frameShot(shot: ShotName): void {
  if (!vrm) return;
  vrm.scene.updateMatrixWorld(true);
  const head = new THREE.Vector3();
  vrm.humanoid.getNormalizedBoneNode('head')?.getWorldPosition(head);
  // Altezza dell'inquadratura da coprire (metri), poi distanza dalla focale.
  const fovRad = THREE.MathUtils.degToRad(viewport.camera.fov);
  const fit = (height: number) => height / 2 / Math.tan(fovRad / 2);
  switch (shot) {
    case 'full':
      viewport.frame3D(new THREE.Vector3(0, (head.y + 0.15) / 2, 0), fit(head.y + 0.4));
      break;
    case 'medium':
      viewport.frame3D(new THREE.Vector3(0, head.y - 0.2, 0), fit(0.8));
      break;
    case 'close':
      viewport.frame3D(head.clone().add(new THREE.Vector3(0, 0.03, 0)), fit(0.35));
      break;
  }
}

// ---------------------------------------------------------------------------
// Pannello di controllo
// ---------------------------------------------------------------------------
function buildPanel(): void {
  const vista = section(panelEl, 'Vista');
  select(vista, 'Modalità', { manga: 'Manga', '3d': '3D (originale)' } as Record<DisplayMode, string>,
    viewport.mode, (v) => (viewport.mode = v));
  select(vista, 'Mostra', {
    manga: 'Tavola finita', lines: 'Solo linee', shading: 'Luce (debug)',
    normals: 'Normali (debug)', depth: 'Profondità (debug)', ids: 'ID oggetti (debug)',
    albedo: 'Luminosità colore (debug)',
  } as Record<MangaView, string>, params.view, (v) => (params.view = v));

  const scena = section(panelEl, 'Scena');
  select(scena, 'Posa', Object.fromEntries(Object.entries(POSES).map(([k, p]) => [k, p.label])) as Record<PoseName, string>,
    state.pose, (v) => {
      state.pose = v;
      if (!vrm) return;
      applyPose(vrm, POSES[v].bones);
      settlePhysics(vrm);
    });
  select(scena, 'Espressione', EXPRESSIONS, state.expression,
    (v) => { state.expression = v; if (vrm) applyExpression(vrm, v); });
  slider(scena, 'Focale', { min: 18, max: 135, step: 1, value: state.focal, unit: ' mm' },
    (v) => { state.focal = v; viewport.setFocalLength(v); });
  const shots = buttonRow(scena);
  for (const [k, label] of Object.entries(SHOTS) as [ShotName, string][]) button(shots, label, () => frameShot(k));

  const linee = section(panelEl, 'Linee');
  slider(linee, 'Contorno', { min: 0.5, max: 8, step: 0.1, value: params.outerLineWidth, unit: ' px' },
    (v) => (params.outerLineWidth = v));
  slider(linee, 'Linee interne', { min: 0.5, max: 5, step: 0.1, value: params.innerLineWidth, unit: ' px' },
    (v) => (params.innerLineWidth = v));
  slider(linee, 'Sensibilità profondità', { min: 0.005, max: 0.2, step: 0.005, value: params.depthThreshold },
    (v) => (params.depthThreshold = v));
  slider(linee, 'Sensibilità pieghe', { min: 0.05, max: 1, step: 0.01, value: params.normalThreshold },
    (v) => (params.normalThreshold = v));
  checkbox(linee, 'Linee tra materiali / ciocche', params.idLines, (v) => (params.idLines = v));

  const luce = section(panelEl, 'Luce e ombre');
  slider(luce, 'Direzione', { min: -180, max: 180, step: 1, value: params.lightAzimuth, unit: '°' },
    (v) => (params.lightAzimuth = v));
  slider(luce, 'Altezza', { min: -60, max: 90, step: 1, value: params.lightElevation, unit: '°' },
    (v) => (params.lightElevation = v));
  slider(luce, 'Quantità d\'ombra', { min: 0, max: 1, step: 0.01, value: params.shadowThreshold },
    (v) => (params.shadowThreshold = v));
  select(luce, 'Stile ombra', { tone: 'Retino', hatch: 'Tratteggio', black: 'Nero pieno' } as Record<ShadowStyle, string>,
    params.shadowStyle, (v) => (params.shadowStyle = v));
  slider(luce, 'Intensità ombra', { min: 0, max: 0.8, step: 0.01, value: params.shadowTone },
    (v) => (params.shadowTone = v));
  checkbox(luce, 'Ombre sul viso', params.faceShadows, (v) => (params.faceShadows = v));

  const retini = section(panelEl, 'Campiture e retini');
  slider(retini, 'Soglia nero', { min: 0, max: 0.6, step: 0.01, value: params.inkThreshold },
    (v) => (params.inkThreshold = v));
  slider(retini, 'Peso del colore', { min: 0, max: 1, step: 0.01, value: params.colorWeight },
    (v) => (params.colorWeight = v));
  slider(retini, 'Soglia retino medio', { min: 0, max: 1, step: 0.01, value: params.midToneThreshold },
    (v) => (params.midToneThreshold = v));
  slider(retini, 'Soglia retino chiaro', { min: 0, max: 1, step: 0.01, value: params.lightToneThreshold },
    (v) => (params.lightToneThreshold = v));
  slider(retini, 'Densità retino medio', { min: 0, max: 0.8, step: 0.01, value: params.midTone },
    (v) => (params.midTone = v));
  slider(retini, 'Densità retino chiaro', { min: 0, max: 0.6, step: 0.01, value: params.lightTone },
    (v) => (params.lightTone = v));
  slider(retini, 'Passo retino', { min: 2, max: 14, step: 0.5, value: params.dotSpacing, unit: ' px' },
    (v) => (params.dotSpacing = v));
  slider(retini, 'Angolo retino', { min: 0, max: 90, step: 1, value: params.dotAngle, unit: '°' },
    (v) => (params.dotAngle = v));

  const esporta = section(panelEl, 'Esporta');
  const exportBtn = button(esporta, 'Scatta vignetta (PNG ×3)', async () => {
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

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  buildPanel();
  setStatus('Caricamento personaggio… 0%');
  try {
    vrm = await loadVRM(MODEL_URL, (f) => setStatus(`Caricamento personaggio… ${Math.round(f * 100)}%`));
  } catch (err) {
    console.error(err);
    setStatus(`Impossibile caricare il personaggio: ${(err as Error).message}`);
    return;
  }
  viewport.scene.add(vrm.scene);
  applyPose(vrm, POSES[state.pose].bones);
  applyExpression(vrm, state.expression);
  settlePhysics(vrm);
  viewport.onUpdate(() => vrm && updatePose(vrm));
  frameShot((query.get('shot') as ShotName) ?? 'full');
  setStatus('');
  document.body.dataset.ready = 'true';
}

main();
