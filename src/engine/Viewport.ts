import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MangaRenderer } from './manga/MangaRenderer';
import type { MangaParams } from './manga/params';

export type DisplayMode = '3d' | 'manga';

/**
 * Lo "studio": renderer, scena, camera da regista e loop di disegno.
 * Indipendente dall'interfaccia: la UI lo pilota solo tramite metodi e parametri.
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly manga: MangaRenderer;
  mode: DisplayMode = 'manga';

  private readonly updaters: ((dt: number) => void)[] = [];
  private lastTime = performance.now();
  private readonly drawingSize = new THREE.Vector2();

  constructor(readonly container: HTMLElement, params: MangaParams) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.1, 3.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.85, 0);
    this.controls.enableDamping = true;
    this.controls.update();

    // Luci per la vista "3D" (MToon). Il render manga usa la propria luce.
    this.scene.background = new THREE.Color(0xd8d8dc);
    const key = new THREE.DirectionalLight(0xffffff, Math.PI);
    key.position.set(-1, 2, 2);
    this.scene.add(key, new THREE.AmbientLight(0xffffff, 0.6));

    this.manga = new MangaRenderer(params);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Registra una funzione chiamata a ogni frame (es. fisica dei capelli). */
  onUpdate(fn: (dt: number) => void): void {
    this.updaters.push(fn);
  }

  /** Lunghezza focale in mm (equivalente full-frame), come su una vera macchina fotografica. */
  setFocalLength(mm: number): void {
    this.camera.setFocalLength(mm);
    this.camera.updateProjectionMatrix();
  }

  /** Inquadra un punto mantenendo la direzione di vista attuale. */
  frame3D(target: THREE.Vector3, distance: number): void {
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.controls.update();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.controls.update();
    for (const fn of this.updaters) fn(dt);

    if (this.mode === '3d') {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.renderer.getDrawingBufferSize(this.drawingSize);
    this.manga.render(this.renderer, this.scene, this.camera, {
      target: null,
      width: this.drawingSize.x,
      height: this.drawingSize.y,
      designScale: this.renderer.getPixelRatio(),
    });
  }
}
