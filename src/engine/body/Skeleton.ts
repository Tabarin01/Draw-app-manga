import * as THREE from 'three';
import type { AnatomyData, SoftLayerId } from './anatomyAsset';
import type { BodyDefinition, BoneDef } from './bodyDefinition';
import { JOINT_TYPE_COLOR, type JointType } from './joints';

/** Layer dei marcatori: visibili nella vista 3D, esclusi dal render manga e usati per il picking. */
export const MARKER_LAYER = 1;

const BONE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.65, metalness: 0, name: 'Osso' });
/** Organi e vasi: il colore anatomico è per vertice (rosso arterie, blu vene, colori degli organi). */
const SOFT_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, name: 'Tessuto' });
const MARKER_GEOMETRY = new THREE.SphereGeometry(1, 16, 12);
const SELECTED_COLOR = 0xffd60a;

const markerMaterials = new Map<JointType | 'selected', THREE.MeshBasicMaterial>();
function markerMaterial(type: JointType | 'selected'): THREE.MeshBasicMaterial {
  let m = markerMaterials.get(type);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: type === 'selected' ? SELECTED_COLOR : JOINT_TYPE_COLOR[type],
      transparent: true,
      opacity: type === 'selected' ? 1 : 0.85,
      depthTest: false,
      depthWrite: false,
    });
    markerMaterials.set(type, m);
  }
  return m;
}

/** Livelli anatomici visualizzabili. Lo scheletro è la base; gli altri si appoggiano su di esso. */
export type LayerId = 'skeleton' | SoftLayerId;

export const LAYER_LABEL: Record<LayerId, string> = {
  skeleton: 'Scheletro',
  organs: 'Organi',
  vessels: 'Vasi sanguigni',
  nerves: 'Sistema nervoso',
};

/**
 * Il corpo nella scena: una gerarchia di ossa (THREE.Bone), una per osso anatomico,
 * posizionate sui giunti. A riposo ogni osso ha assi allineati al mondo; la posa è solo
 * la rotazione delle ossa. I tessuti molli (organi, vasi) sono mesh deformate dalle ossa.
 */
export class Skeleton {
  readonly root = new THREE.Group();
  readonly markers: THREE.Mesh[] = [];
  private readonly nodes = new Map<string, THREE.Bone>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly layerObjects = new Map<LayerId, THREE.Object3D[]>();
  private selected: string | null = null;

  constructor(readonly body: BodyDefinition, anatomy: AnatomyData) {
    this.root.name = 'Corpo';
    const defs = new Map<string, BoneDef>(body.bones.map((b) => [b.id, b]));
    const boneMeshes: THREE.Object3D[] = [];
    this.layerObjects.set('skeleton', boneMeshes);

    for (const b of body.bones) {
      const node = new THREE.Bone();
      node.name = b.id;
      const parentDef = b.parent ? defs.get(b.parent) : undefined;
      node.position.copy(b.head);
      if (parentDef) node.position.sub(parentDef.head);
      (b.parent ? this.nodes.get(b.parent)! : this.root).add(node);
      this.nodes.set(b.id, node);

      // Geometria reale dell'atlante (coordinate mondo) → scalata e portata nello spazio del giunto.
      const source = anatomy.geometries.get(b.id);
      if (source) {
        const geo = source.clone();
        geo.scale(body.scale, body.scale, body.scale);
        geo.translate(-b.head.x, -b.head.y, -b.head.z);
        const mesh = new THREE.Mesh(geo, BONE_MATERIAL);
        mesh.name = b.label;
        mesh.userData.boneId = b.id;
        node.add(mesh);
        this.geometries.push(geo);
        boneMeshes.push(mesh);
      }
    }

    // Tessuti molli: legati alle ossa con i pesi di skinning calcolati dall'atlante.
    // Le matrici di legame si calcolano ora, con il corpo in posizione anatomica.
    this.root.updateMatrixWorld(true);
    for (const [id, layer] of anatomy.layers) {
      const bones = layer.jointNames.map((name) => {
        const bone = this.nodes.get(name);
        if (!bone) throw new Error(`Il livello "${id}" usa un osso sconosciuto: ${name}`);
        return bone;
      });
      const geo = layer.geometry.clone();
      geo.scale(body.scale, body.scale, body.scale);
      const mesh = new THREE.SkinnedMesh(geo, SOFT_MATERIAL);
      mesh.name = LAYER_LABEL[id];
      mesh.frustumCulled = false;
      this.root.add(mesh);
      mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
      this.geometries.push(geo);
      this.layerObjects.set(id, [mesh]);
    }

    for (const c of body.controls) {
      const node = this.nodes.get(c.marker.bone)!;
      const def = defs.get(c.marker.bone)!;
      const marker = new THREE.Mesh(MARKER_GEOMETRY, markerMaterial(c.type));
      marker.name = `Marcatore: ${c.label}`;
      marker.position.copy(c.marker.at).sub(def.head);
      marker.scale.setScalar(c.marker.size);
      marker.renderOrder = 1000;
      marker.layers.set(MARKER_LAYER);
      marker.userData.controlId = c.id;
      marker.userData.type = c.type;
      marker.userData.size = c.marker.size;
      node.add(marker);
      this.markers.push(marker);
    }
  }

  /** Applica le rotazioni calcolate dal sistema nervoso. Le ossa non citate tornano a riposo. */
  applyRotations(rotations: Map<string, THREE.Quaternion>): void {
    for (const [id, node] of this.nodes) {
      const q = rotations.get(id);
      if (q) node.quaternion.copy(q);
      else node.quaternion.identity();
    }
  }

  setSelected(controlId: string | null): void {
    this.selected = controlId;
    for (const m of this.markers) {
      const isSel = m.userData.controlId === controlId;
      m.material = markerMaterial(isSel ? 'selected' : (m.userData.type as JointType));
    }
  }

  /**
   * I marcatori hanno una dimensione nel mondo pensata per la figura intera:
   * avvicinandosi la riduciamo, così da vicino non coprono mani e piedi.
   */
  updateMarkerScale(camera: THREE.Camera): void {
    const fullBodyDistance = this.body.height * 3.5;
    const p = new THREE.Vector3();
    for (const m of this.markers) {
      m.getWorldPosition(p);
      const k = THREE.MathUtils.clamp(p.distanceTo(camera.position) / fullBodyDistance, 0.2, 1);
      const sel = m.userData.controlId === this.selected ? 1.5 : 1;
      m.scale.setScalar((m.userData.size as number) * k * sel);
    }
  }

  get selectedControl(): string | null {
    return this.selected;
  }

  /** Posizione attuale (in posa) del giunto di un osso, nel mondo. */
  boneWorldPosition(boneId: string): THREE.Vector3 | null {
    const node = this.nodes.get(boneId);
    if (!node) return null;
    this.root.updateMatrixWorld(true);
    return node.getWorldPosition(new THREE.Vector3());
  }

  /** Livelli disponibili per questo corpo (lo scheletro c'è sempre). */
  get layers(): LayerId[] {
    return [...this.layerObjects.keys()];
  }

  setLayerVisible(layer: LayerId, visible: boolean): void {
    for (const obj of this.layerObjects.get(layer) ?? []) obj.visible = visible;
  }

  setMarkersVisible(visible: boolean): void {
    for (const m of this.markers) m.visible = visible;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
  }
}
