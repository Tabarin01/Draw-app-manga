import * as THREE from 'three';

/**
 * Materiale del "G-buffer": sostituisce temporaneamente il materiale originale
 * di ogni mesh e scrive, in un solo passaggio, tre immagini (MRT):
 *
 *   location 0 → R: luminosità nitida, G: illuminazione (half-lambert),
 *                B: saturazione, A: luminosità "morbida" (per i retini)
 *   location 1 → normale in view space (impacchettata 0..1)
 *   location 2 → ID dell'oggetto/materiale (per le linee di confine), A = 1 dove c'è un oggetto
 *
 * La profondità finisce nel depthTexture del render target.
 * Supporta skinning e morph target (pose ed espressioni) grazie ai chunk standard di three.
 */

const vertexShader = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

varying vec2 vMapUv;
varying vec3 vViewNormal;

void main() {
  vMapUv = uv;

  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>

  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>

  vViewNormal = normalize(transformedNormal);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform bool hasMap;
uniform vec3 baseColor;
uniform float cutoff;
uniform vec3 objectId;
uniform vec3 lightDirView;
uniform float isFace;
uniform float faceFlat;
uniform float forceInk;
uniform float isSkin;

varying vec2 vMapUv;
varying vec3 vViewNormal;

layout(location = 0) out vec4 gShade;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gId;

// Colore lineare → percettivo (approssimazione gamma 2.2).
vec3 toPerceptual(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 albedo = vec4(baseColor, 1.0);
  // Versione "sfocata" (mipmap più bassa) usata per le campiture: un retino copre
  // una zona uniforme, non deve inseguire ogni sfumatura dipinta nella texture.
  vec3 albedoSoft = baseColor;
  if (hasMap) {
    albedo *= texture(map, vMapUv);
    albedoSoft *= texture(map, vMapUv, 2.0).rgb;
  }
  if (albedo.a < cutoff) discard;

  vec3 n = normalize(vViewNormal);
  if (!gl_FrontFacing) n = -n;

  // Half-lambert: 0 = completamente in ombra, 1 = piena luce.
  float lit = dot(n, normalize(lightDirView)) * 0.5 + 0.5;
  lit = mix(lit, 1.0, isFace * faceFlat);

  // Luminanze percettive, così le soglie delle campiture sono intuitive.
  float lumSharp = pow(clamp(lumaOf(albedo.rgb), 0.0, 1.0), 1.0 / 2.2);
  float lumSoft = pow(clamp(lumaOf(albedoSoft), 0.0, 1.0), 1.0 / 2.2);
  // Saturazione: un colore vivace (es. un vestito verde) merita un retino
  // anche se è "luminoso", come farebbe un mangaka.
  vec3 p = toPerceptual(albedoSoft);
  float maxC = max(p.r, max(p.g, p.b));
  float sat = maxC > 0.0 ? (maxC - min(p.r, min(p.g, p.b))) / maxC : 0.0;

  lumSharp *= 1.0 - forceInk;
  // Convenzione manga: la pelle è carta bianca (le ombre arrivano dopo, dalla luce).
  lumSoft = mix(lumSoft, 1.0, isSkin);
  sat *= 1.0 - isSkin;

  // R: luminosità nitida (→ nero pieno), G: luce, B: saturazione, A: luminosità morbida (→ retini)
  gShade = vec4(lumSharp, lit, sat, lumSoft);
  gNormal = vec4(n * 0.5 + 0.5, 1.0);
  gId = vec4(objectId, 1.0);
}
`;

/** Uniform condivise da tutti i materiali G-buffer (aggiornate una volta per frame). */
export interface SharedGBufferUniforms {
  lightDirView: THREE.IUniform<THREE.Vector3>;
  faceFlat: THREE.IUniform<number>;
}

export function createSharedGBufferUniforms(): SharedGBufferUniforms {
  return {
    lightDirView: { value: new THREE.Vector3(0, 0, 1) },
    faceFlat: { value: 1 },
  };
}

/** Materiale invisibile per i contorni "a guscio" di MToon: le linee le disegniamo noi. */
export const HIDDEN_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

/** Riconosce le parti del viso dei modelli VRoid (pelle del viso, occhi, sopracciglia...). */
function isFaceMaterial(name: string): boolean {
  return /Face.*_SKIN|_FACE$|_EYE$/i.test(name);
}

/**
 * Elementi del viso che in un manga sono sempre tratti d'inchiostro, qualunque
 * sia il loro colore nel modello: sopracciglia, ciglia, linea dell'occhio.
 */
function isInkMaterial(name: string): boolean {
  return /FaceBrow|FaceEyelash|FaceEyeline/i.test(name);
}

/** Codifica un intero in un colore RGB univoco (24 bit). */
function idToColor(id: number): THREE.Vector3 {
  return new THREE.Vector3(
    (id & 0xff) / 255,
    ((id >> 8) & 0xff) / 255,
    ((id >> 16) & 0xff) / 255,
  );
}

interface MaterialLike extends THREE.Material {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  isOutline?: boolean;
}

export function createGBufferMaterial(
  source: THREE.Material,
  id: number,
  shared: SharedGBufferUniforms,
): THREE.Material {
  const src = source as MaterialLike;
  if (src.isOutline) return HIDDEN_MATERIAL;

  const map = src.map ?? null;
  // Opaco: nessun ritaglio. Cutout/trasparente: ritaglia dove l'alpha è bassa
  // (ciglia, sopracciglia, punte delle ciocche...).
  const cutoff = src.transparent || src.alphaTest > 0 ? Math.max(src.alphaTest, 0.5) : 0;

  return new THREE.ShaderMaterial({
    name: `GBuffer(${source.name})`,
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      map: { value: map },
      hasMap: { value: map !== null },
      baseColor: { value: src.color ? src.color.clone() : new THREE.Color(1, 1, 1) },
      cutoff: { value: cutoff },
      objectId: { value: idToColor(id) },
      isFace: { value: isFaceMaterial(source.name) ? 1 : 0 },
      forceInk: { value: isInkMaterial(source.name) ? 1 : 0 },
      isSkin: { value: /_SKIN$/i.test(source.name) ? 1 : 0 },
      lightDirView: shared.lightDirView,
      faceFlat: shared.faceFlat,
    },
    side: source.side,
    depthWrite: source.depthWrite,
    depthTest: true,
    // I materiali trasparenti (ciglia, sopracciglia, linea dell'occhio...) sono strati
    // appoggiati sulla pelle: vanno disegnati DOPO gli opachi, come nel modello originale.
    // "transparent" li mette in coda; NoBlending scrive i dati del G-buffer senza mescolarli.
    transparent: source.transparent,
    blending: THREE.NoBlending,
  });
}
