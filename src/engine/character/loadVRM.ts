import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';

/** Carica un personaggio VRM (0.x o 1.0) pronto per essere messo in posa. */
export async function loadVRM(
  url: string,
  onProgress?: (fraction: number) => void,
): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await loader.loadAsync(url, (e) => {
    if (onProgress && e.total > 0) onProgress(e.loaded / e.total);
  });

  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`Il file ${url} non contiene un modello VRM valido`);

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  // I modelli VRM 0.x guardano verso -Z: li giriamo verso la camera.
  VRMUtils.rotateVRM0(vrm);

  // Le mesh con skinning possono uscire dal bounding box originale in posa.
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
  });

  return vrm;
}

/**
 * Una vignetta è un'immagine ferma: la fisica (capelli, gonna, ecc.) non gira "dal vivo",
 * ma viene fatta assestare con passi fissi dopo ogni cambio di posa e poi congelata.
 * Così la stessa scena produce sempre la stessa identica vignetta.
 */
export function settlePhysics(vrm: VRM, seconds = 2, step = 1 / 60): void {
  updatePose(vrm);
  const springs = vrm.springBoneManager;
  if (!springs) return;
  springs.reset();
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i++) springs.update(step);
}

/** Applica posa ed espressioni alla mesh, senza far avanzare la fisica. */
export function updatePose(vrm: VRM): void {
  vrm.humanoid.update();
  vrm.expressionManager?.update();
  vrm.scene.updateMatrixWorld(true);
}

export function disposeVRM(vrm: VRM): void {
  vrm.scene.removeFromParent();
  VRMUtils.deepDispose(vrm.scene);
}

export type { VRM };
