/**
 * Parametri artistici del render manga.
 *
 * Tutte le misure "px" sono in pixel di design (CSS px dell'anteprima):
 * il renderer le scala automaticamente per supersampling ed export ad alta
 * risoluzione, così la tavola esportata è identica all'anteprima, solo più nitida.
 */
export type ShadowStyle = 'tone' | 'hatch' | 'black';

export type MangaView = 'manga' | 'lines' | 'shading' | 'normals' | 'depth' | 'ids' | 'albedo';

export interface MangaParams {
  view: MangaView;

  // --- Linee ---
  /** Spessore del contorno esterno e delle linee di sovrapposizione (px). */
  outerLineWidth: number;
  /** Spessore delle linee interne: pieghe e confini tra materiali (px). */
  innerLineWidth: number;
  /** Salto di profondità relativo oltre il quale si traccia un contorno. */
  depthThreshold: number;
  /** Variazione di normale (0..1) oltre la quale si traccia una piega. */
  normalThreshold: number;
  /** Traccia linee al confine tra oggetti/materiali diversi (es. ciocche di capelli). */
  idLines: boolean;

  // --- Luce e ombre ---
  /** Direzione della luce relativa all'inquadratura, in gradi (0 = frontale). */
  lightAzimuth: number;
  lightElevation: number;
  /** Soglia (0..1) sotto cui una zona è in ombra. */
  shadowThreshold: number;
  shadowStyle: ShadowStyle;
  /** Copertura di retino aggiunta nelle zone d'ombra (0..1). */
  shadowTone: number;
  /** Se false il viso non riceve ombre (come nei manga: niente ombre "sporche" su naso e guance). */
  faceShadows: boolean;

  // --- Campiture e retini ---
  /** Sotto questa luminosità il colore diventa nero pieno (occhi, capelli scuri...). */
  inkThreshold: number;
  /** Quanto la saturazione "scurisce" un colore ai fini del retino (0 = solo luminosità). */
  colorWeight: number;
  /** Sotto questa luminosità: retino medio. */
  midToneThreshold: number;
  /** Sotto questa luminosità: retino chiaro. Sopra: bianco carta. */
  lightToneThreshold: number;
  midTone: number;
  lightTone: number;
  /** Distanza tra i punti del retino (px). */
  dotSpacing: number;
  /** Inclinazione della griglia del retino (gradi). Classico manga: 45°. */
  dotAngle: number;

  /** Fattore di supersampling (1 = nessuno, 2 = linee molto più pulite). */
  ssaa: number;
}

export function defaultMangaParams(): MangaParams {
  return {
    view: 'manga',
    outerLineWidth: 3.0,
    innerLineWidth: 1.4,
    depthThreshold: 0.04,
    normalThreshold: 0.35,
    idLines: true,
    lightAzimuth: -40,
    lightElevation: 35,
    shadowThreshold: 0.45,
    shadowStyle: 'tone',
    shadowTone: 0.3,
    faceShadows: false,
    inkThreshold: 0.18,
    colorWeight: 0.35,
    midToneThreshold: 0.42,
    lightToneThreshold: 0.72,
    midTone: 0.35,
    lightTone: 0.15,
    dotSpacing: 5,
    dotAngle: 45,
    ssaa: 2,
  };
}
