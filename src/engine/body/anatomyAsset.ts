import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type Tuple3 = [number, number, number];

/**
 * Scheletro anatomico reale, generato da tools/build-anatomy.mjs a partire da
 * BodyParts3D (© The Database Center for Life Science, CC BY 4.0).
 *
 * Contiene la geometria di ogni osso mobile (coordinate mondo, posizione anatomica,
 * piedi a y = 0) e i centri articolari calcolati dalla geometria.
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
  geometries: Map<string, THREE.BufferGeometry>;
}

export async function loadAnatomy(url: string, onProgress?: (fraction: number) => void): Promise<AnatomyData> {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => {
    if (onProgress && e.total > 0) onProgress(e.loaded / e.total);
  });
  const extras = gltf.scene.userData as Omit<AnatomyData, 'geometries'>;
  if (!extras?.heads) throw new Error('Il file non contiene i dati anatomici attesi');

  const geometries = new Map<string, THREE.BufferGeometry>();
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeVertexNormals();
    geometries.set(mesh.name, mesh.geometry);
  });

  return { ...extras, geometries };
}
