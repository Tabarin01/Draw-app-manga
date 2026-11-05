import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type Tuple3 = [number, number, number];

/**
 * Corpo anatomico reale, generato da tools/build-anatomy.mjs a partire da
 * BodyParts3D (© The Database Center for Life Science, CC BY 4.0).
 *
 * Lo scheletro è la base: geometria di ogni osso mobile (coordinate mondo, posizione
 * anatomica, piedi a y = 0) e centri articolari calcolati dalla geometria.
 * Sopra lo scheletro ci sono i livelli dei tessuti molli (organi, vasi sanguigni),
 * legati alle ossa con pesi di skinning così da seguire la posa.
 */
export interface AnatomyData {
  attribution: string;
  /** Altezza del soggetto scansionato, in metri. */
  modelHeight: number;
  /** Centro del giunto di ogni osso con il suo genitore. */
  heads: Record<string, Tuple3>;
  /** Baricentro di ogni osso. */
  centers: Record<string, Tuple3>;
  /** Punti di repere aggiuntivi (es. articolazione radio-ulnare distale). */
  extra: Record<string, Tuple3>;
  /** Geometria di ogni osso. */
  geometries: Map<string, THREE.BufferGeometry>;
  /** Livelli dei tessuti molli. */
  layers: Map<SoftLayerId, SoftLayer>;
}

export type SoftLayerId = 'organs' | 'vessels';

export interface SoftLayer {
  /** Geometria con colori per vertice e pesi di skinning (skinIndex / skinWeight). */
  geometry: THREE.BufferGeometry;
  /** Ordine delle ossa a cui si riferiscono gli indici di skinning. */
  jointNames: string[];
}

const SOFT_LAYERS: SoftLayerId[] = ['organs', 'vessels'];

async function loadGlb(url: string, onProgress?: (e: ProgressEvent) => void) {
  return new GLTFLoader().loadAsync(url, onProgress);
}

export async function loadAnatomy(baseUrl: string, onProgress?: (fraction: number) => void): Promise<AnatomyData> {
  const files = ['skeleton', ...SOFT_LAYERS];
  const progress = new Map<string, number>();
  const report = () => onProgress?.([...progress.values()].reduce((a, b) => a + b, 0) / files.length);

  const [skeleton, ...soft] = await Promise.all(
    files.map((name) =>
      loadGlb(`${baseUrl}${name}.glb`, (e) => {
        if (e.total > 0) progress.set(name, e.loaded / e.total);
        report();
      }),
    ),
  );

  const extras = skeleton.scene.userData as Omit<AnatomyData, 'geometries' | 'layers'>;
  if (!extras?.heads) throw new Error('Il file dello scheletro non contiene i dati anatomici attesi');

  const geometries = new Map<string, THREE.BufferGeometry>();
  skeleton.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeVertexNormals();
    geometries.set(mesh.name, mesh.geometry);
  });

  const layers = new Map<SoftLayerId, SoftLayer>();
  soft.forEach((gltf, i) => {
    let geometry: THREE.BufferGeometry | null = null;
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) geometry = mesh.geometry;
    });
    if (!geometry) return;
    (geometry as THREE.BufferGeometry).computeVertexNormals();
    layers.set(SOFT_LAYERS[i], { geometry, jointNames: gltf.scene.userData.jointNames as string[] });
  });

  return { ...extras, geometries, layers };
}
