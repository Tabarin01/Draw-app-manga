import * as THREE from 'three';
import { MangaRenderer } from '../manga/MangaRenderer';
import type { Viewport } from '../Viewport';

const MAX_EXPORT_SIZE = 8192;

/**
 * Renderizza l'inquadratura attuale come vignetta manga ad alta risoluzione.
 * Le misure (linee, retini) restano identiche all'anteprima: cambia solo la nitidezza.
 *
 * @param scale moltiplicatore rispetto alla dimensione dell'anteprima (3 ≈ qualità stampa)
 */
export async function exportPanel(viewport: Viewport, scale = 3): Promise<Blob> {
  const { renderer, scene, camera, container } = viewport;
  const cssW = container.clientWidth;
  const cssH = container.clientHeight;

  const fit = Math.min(scale, MAX_EXPORT_SIZE / cssW, MAX_EXPORT_SIZE / cssH);
  const width = Math.round(cssW * fit);
  const height = Math.round(cssH * fit);

  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    depthBuffer: false,
  });
  const exporter = new MangaRenderer(viewport.manga.params);

  try {
    exporter.render(renderer, scene, camera, { target, width, height, designScale: fit });

    const pixels = new Uint8Array(width * height * 4);
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, pixels);

    // WebGL legge dal basso verso l'alto: capovolgiamo le righe.
    const image = new ImageData(width, height);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
      image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.putImageData(image, 0, 0);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Esportazione PNG fallita'))), 'image/png'),
    );
  } finally {
    exporter.dispose();
    target.dispose();
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
