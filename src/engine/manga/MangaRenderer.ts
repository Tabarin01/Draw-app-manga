import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
  createGBufferMaterial,
  createSharedGBufferUniforms,
  HIDDEN_MATERIAL,
  type SharedGBufferUniforms,
} from './GBufferMaterial';
import { blitFragmentShader, compositeFragmentShader, compositeVertexShader } from './compositeShader';
import type { MangaParams, MangaView, ShadowStyle } from './params';

const VIEW_INDEX: Record<MangaView, number> = {
  manga: 0, lines: 1, shading: 2, normals: 3, depth: 4, ids: 5, albedo: 6,
};
const SHADOW_INDEX: Record<ShadowStyle, number> = { tone: 0, hatch: 1, black: 2 };

/** Dimensione massima interna, per non esaurire la memoria della GPU. */
const MAX_INTERNAL_SIZE = 8192;

export interface MangaRenderOptions {
  /** Dove scrivere il risultato: null = schermo. */
  target: THREE.WebGLRenderTarget | null;
  /** Dimensione di output in pixel reali. */
  width: number;
  height: number;
  /** Pixel di output per pixel di design (devicePixelRatio, o fattore di export). */
  designScale: number;
}

/**
 * Pipeline di render manga:
 *   scena 3D → G-buffer (MRT: ombre/luminosità, normali, ID + profondità)
 *            → composizione (linee, campiture, retini) a risoluzione interna × ssaa
 *            → downsample sul target finale.
 */
export class MangaRenderer {
  private readonly gbuffer: THREE.WebGLRenderTarget;
  private readonly composite: THREE.WebGLRenderTarget;
  private readonly compositeQuad: FullScreenQuad;
  private readonly blitQuad: FullScreenQuad;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly blitMaterial: THREE.ShaderMaterial;

  private readonly shared: SharedGBufferUniforms = createSharedGBufferUniforms();
  /** Materiale G-buffer per ogni coppia (mesh, materiale originale). */
  private readonly gbufferMaterials = new Map<string, THREE.Material>();
  private nextId = 1;
  private readonly swapped: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] = [];

  constructor(readonly params: MangaParams) {
    this.gbuffer = new THREE.WebGLRenderTarget(1, 1, {
      count: 3,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });

    this.composite = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    const [tShade, tNormal, tId] = this.gbuffer.textures;
    this.compositeMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: compositeVertexShader,
      fragmentShader: compositeFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tShade: { value: tShade },
        tNormal: { value: tNormal },
        tId: { value: tId },
        tDepth: { value: this.gbuffer.depthTexture },
        texel: { value: new THREE.Vector2() },
        designScale: { value: 1 },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 100 },
        view: { value: 0 },
        outerLineWidth: { value: 0 },
        innerLineWidth: { value: 0 },
        depthThreshold: { value: 0 },
        normalThreshold: { value: 0 },
        idLines: { value: true },
        shadowThreshold: { value: 0 },
        shadowStyle: { value: 0 },
        shadowTone: { value: 0 },
        inkThreshold: { value: 0 },
        colorWeight: { value: 0 },
        midToneThreshold: { value: 0 },
        lightToneThreshold: { value: 0 },
        midTone: { value: 0 },
        lightTone: { value: 0 },
        dotSpacing: { value: 0 },
        dotAngle: { value: 0 },
      },
    });
    this.compositeQuad = new FullScreenQuad(this.compositeMaterial);

    this.blitMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: compositeVertexShader,
      fragmentShader: blitFragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: { tSource: { value: this.composite.texture } },
    });
    this.blitQuad = new FullScreenQuad(this.blitMaterial);
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    opts: MangaRenderOptions,
  ): void {
    const p = this.params;

    // Risoluzione interna = output × ssaa, limitata alla dimensione massima supportata.
    const maxSize = Math.min(MAX_INTERNAL_SIZE, renderer.capabilities.maxTextureSize);
    const ssaa = Math.max(1, Math.min(p.ssaa, maxSize / opts.width, maxSize / opts.height));
    const iw = Math.max(1, Math.floor(opts.width * ssaa));
    const ih = Math.max(1, Math.floor(opts.height * ssaa));
    if (this.gbuffer.width !== iw || this.gbuffer.height !== ih) {
      this.gbuffer.setSize(iw, ih);
      this.composite.setSize(iw, ih);
    }

    this.updateUniforms(camera, iw, ih, opts.designScale * (iw / opts.width));

    const prevTarget = renderer.getRenderTarget();
    const prevBackground = scene.background;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();

    // 1) G-buffer
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    this.swapMaterials(scene);
    renderer.setRenderTarget(this.gbuffer);
    renderer.clear();
    renderer.render(scene, camera);
    this.restoreMaterials();
    scene.background = prevBackground;
    renderer.setClearColor(prevClear, prevClearAlpha);

    // 2) Composizione a risoluzione interna
    renderer.setRenderTarget(this.composite);
    this.compositeQuad.render(renderer);

    // 3) Downsample sul target finale
    renderer.setRenderTarget(opts.target);
    this.blitQuad.render(renderer);

    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.gbuffer.depthTexture?.dispose();
    this.gbuffer.dispose();
    this.composite.dispose();
    this.compositeQuad.dispose();
    this.blitQuad.dispose();
    this.compositeMaterial.dispose();
    this.blitMaterial.dispose();
    for (const m of this.gbufferMaterials.values()) if (m !== HIDDEN_MATERIAL) m.dispose();
    this.gbufferMaterials.clear();
  }

  private updateUniforms(camera: THREE.PerspectiveCamera, iw: number, ih: number, designScale: number): void {
    const p = this.params;
    const u = this.compositeMaterial.uniforms;
    u.texel.value.set(1 / iw, 1 / ih);
    u.designScale.value = designScale;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.view.value = VIEW_INDEX[p.view];
    u.outerLineWidth.value = p.outerLineWidth;
    u.innerLineWidth.value = p.innerLineWidth;
    u.depthThreshold.value = p.depthThreshold;
    u.normalThreshold.value = p.normalThreshold;
    u.idLines.value = p.idLines;
    u.shadowThreshold.value = p.shadowThreshold;
    u.shadowStyle.value = SHADOW_INDEX[p.shadowStyle];
    u.shadowTone.value = p.shadowTone;
    u.inkThreshold.value = p.inkThreshold;
    u.colorWeight.value = p.colorWeight;
    u.midToneThreshold.value = p.midToneThreshold;
    u.lightToneThreshold.value = p.lightToneThreshold;
    u.midTone.value = p.midTone;
    u.lightTone.value = p.lightTone;
    u.dotSpacing.value = p.dotSpacing;
    u.dotAngle.value = p.dotAngle;

    // Luce relativa all'inquadratura: è già in view space.
    const az = THREE.MathUtils.degToRad(p.lightAzimuth);
    const el = THREE.MathUtils.degToRad(p.lightElevation);
    this.shared.lightDirView.value
      .set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
      .normalize();
    this.shared.faceFlat.value = p.faceShadows ? 0 : 1;
  }

  private swapMaterials(scene: THREE.Scene): void {
    this.swapped.length = 0;
    scene.traverseVisible((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const original = mesh.material;
      this.swapped.push({ mesh, original });
      mesh.material = Array.isArray(original)
        ? original.map((m) => this.gbufferMaterialFor(mesh, m))
        : this.gbufferMaterialFor(mesh, original);
    });
  }

  private restoreMaterials(): void {
    for (const { mesh, original } of this.swapped) mesh.material = original;
    this.swapped.length = 0;
  }

  private gbufferMaterialFor(mesh: THREE.Mesh, material: THREE.Material): THREE.Material {
    const key = `${mesh.uuid}/${material.uuid}`;
    let m = this.gbufferMaterials.get(key);
    if (!m) {
      m = createGBufferMaterial(material, this.nextId++, this.shared);
      this.gbufferMaterials.set(key, m);
    }
    return m;
  }
}
