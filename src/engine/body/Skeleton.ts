import * as THREE from 'three';
import type { AnatomyData } from './anatomyAsset';
import type { BodyDefinition, BoneDef } from './bodyDefinition';
import { JOINT_TYPE_COLOR, type JointType } from './joints';

/** Layer dei marcatori: visibili nella vista 3D, esclusi dal render manga e usati per il picking. */
export const MARKER_LAYER = 1;

const BONE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.65, metalness: 0, name: 'Osso' });
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

/**
 * Lo scheletro nella scena: una gerarchia di nodi, uno per osso, posizionati sui giunti.
 * A riposo ogni nodo ha assi allineati al mondo; la posa è solo la rotazione dei nodi.
 */
export class Skeleton {
  readonly root = new THREE.Group();
  readonly markers: THREE.Mesh[] = [];
  private readonly nodes = new Map<string, THREE.Object3D>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private selected: string | null = null;

  constructor(readonly body: BodyDefinition, anatomy: AnatomyData) {
    this.root.name = 'Scheletro';
    const defs = new Map<string, BoneDef>(body.bones.map((b) => [b.id, b]));

    for (const b of body.bones) {
      const node = new THREE.Group();
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
      }
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

  setMarkersVisible(visible: boolean): void {
    for (const m of this.markers) m.visible = visible;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
  }
}
