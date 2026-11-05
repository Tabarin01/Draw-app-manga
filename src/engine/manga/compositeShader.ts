/**
 * Shader di composizione: legge il G-buffer e "disegna" la vignetta.
 *
 * 1. Linee
 *    - esterne: dove si passa da oggetto a carta, o c'è un salto di profondità
 *      (es. un braccio davanti al busto) → tratto spesso
 *    - interne: pieghe (cambio brusco di normale) e confini tra materiali → tratto fine
 * 2. Campiture: dalla luminosità del colore base → nero pieno / retino medio / retino chiaro / bianco
 * 3. Ombre: dove l'illuminazione è sotto soglia → retino più denso, tratteggio o nero
 *
 * I retini sono calcolati nello spazio dello schermo (come i retini adesivi veri),
 * non sulla superficie 3D.
 */

export const compositeVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const compositeFragmentShader = /* glsl */ `
#include <packing>

uniform sampler2D tShade;
uniform sampler2D tNormal;
uniform sampler2D tId;
uniform sampler2D tDepth;

uniform vec2 texel;          // 1 / dimensione interna
uniform float designScale;   // pixel interni per pixel di design
uniform float cameraNear;
uniform float cameraFar;

uniform int view;            // 0 manga, 1 linee, 2 ombre, 3 normali, 4 profondità, 5 id

uniform float outerLineWidth;
uniform float innerLineWidth;
uniform float depthThreshold;
uniform float normalThreshold;
uniform bool idLines;

uniform float shadowThreshold;
uniform int shadowStyle;     // 0 retino, 1 tratteggio, 2 nero
uniform float shadowTone;

uniform float inkThreshold;
uniform float colorWeight;
uniform float midToneThreshold;
uniform float lightToneThreshold;
uniform float midTone;
uniform float lightTone;
uniform float dotSpacing;
uniform float dotAngle;

varying vec2 vUv;
layout(location = 0) out vec4 outColor;

const int DIRS = 8;

float linearDepth(vec2 uv) {
  float d = texture(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
}

struct Sample {
  float obj;
  float depth;
  vec3 normal;
  vec3 id;
};

Sample fetchSample(vec2 uv) {
  Sample s;
  vec4 idv = texture(tId, uv);
  s.obj = idv.a;
  s.id = idv.rgb;
  s.depth = linearDepth(uv);
  s.normal = normalize(texture(tNormal, uv).xyz * 2.0 - 1.0);
  return s;
}

// Restituisce x = linea esterna, y = linea interna (0..1).
vec2 detectLines(vec2 uv) {
  Sample c = fetchSample(uv);
  float outer = 0.0;
  float inner = 0.0;

  // Soglia di profondità più tollerante sulle superfici molto inclinate,
  // altrimenti apparirebbero linee false dove la superficie "scappa" dalla camera.
  float facing = max(abs(c.normal.z), 0.15);
  float dThr = depthThreshold / facing;

  float rOuter = max(outerLineWidth * designScale * 0.5, 0.5);
  float rInner = max(innerLineWidth * designScale * 0.5, 0.5);

  for (int ring = 0; ring < 2; ring++) {
    float k = ring == 0 ? 1.0 : 0.5;
    for (int i = 0; i < DIRS; i++) {
      float a = (float(i) + 0.5 * float(ring)) * (6.28318530718 / float(DIRS));
      vec2 dir = vec2(cos(a), sin(a));

      // Contorni esterni e sovrapposizioni
      Sample so = fetchSample(uv + dir * rOuter * k * texel);
      if ((so.obj > 0.5) != (c.obj > 0.5)) {
        outer = 1.0;
      } else if (c.obj > 0.5) {
        float rel = abs(so.depth - c.depth) / min(so.depth, c.depth);
        if (rel > dThr) outer = 1.0;
      }

      // Pieghe e confini tra materiali
      if (c.obj > 0.5) {
        Sample si = fetchSample(uv + dir * rInner * k * texel);
        if (si.obj > 0.5) {
          if (idLines && distance(si.id, c.id) > 0.001) inner = 1.0;
          if (1.0 - dot(si.normal, c.normal) > normalThreshold) inner = 1.0;
        }
      }
    }
  }
  return vec2(outer, inner);
}

// Retino a punti: restituisce 1 dove c'è inchiostro.
float halftone(vec2 px, float coverage) {
  if (coverage <= 0.001) return 0.0;
  if (coverage >= 0.999) return 1.0;
  float a = radians(dotAngle);
  mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
  float spacing = dotSpacing * designScale;
  vec2 p = rot * px / spacing;
  float d = length(fract(p) - 0.5);
  float r = sqrt(coverage / 3.14159265);
  float aa = 0.75 / spacing;
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

// Tratteggio a linee parallele: restituisce 1 dove c'è inchiostro.
float hatch(vec2 px, float coverage) {
  float spacing = dotSpacing * 1.2 * designScale;
  float t = fract((px.x + px.y) / (spacing * 1.41421356));
  float w = clamp(coverage, 0.05, 0.9);
  float aa = 0.75 / spacing;
  return 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, abs(t - 0.5));
}

void main() {
  vec4 shade = texture(tShade, vUv);
  vec4 idv = texture(tId, vUv);
  bool isObj = idv.a > 0.5;
  vec2 px = gl_FragCoord.xy;

  // --- Viste di debug ---
  if (view == 3) { outColor = vec4(isObj ? texture(tNormal, vUv).rgb : vec3(1.0), 1.0); return; }
  if (view == 4) {
    float d = isObj ? clamp((linearDepth(vUv) - 0.5) / 4.0, 0.0, 1.0) : 1.0;
    outColor = vec4(vec3(d), 1.0); return;
  }
  if (view == 5) { outColor = vec4(isObj ? fract(idv.rgb * vec3(37.0, 91.0, 53.0) * 7.0) : vec3(1.0), 1.0); return; }
  if (view == 2) { outColor = vec4(vec3(isObj ? shade.g : 1.0), 1.0); return; }
  if (view == 6) { outColor = vec4(vec3(isObj ? shade.a - colorWeight * shade.b : 1.0), 1.0); return; }

  vec2 lines = detectLines(vUv);
  float ink = max(lines.x, lines.y);

  if (view == 0 && isObj) {
    float lit = shade.g;
    // Luminosità "da retino": i colori saturi contano come più scuri.
    float toneLum = shade.a - colorWeight * shade.b;

    // Campitura base dal colore: il nero pieno usa la luminosità nitida (dettagli),
    // i retini quella morbida (zone uniformi).
    float coverage = 0.0;
    if (shade.r < inkThreshold) coverage = 1.0;
    else if (toneLum < midToneThreshold) coverage = midTone;
    else if (toneLum < lightToneThreshold) coverage = lightTone;

    bool inShadow = lit < shadowThreshold;
    float toneInk = 0.0;

    if (inShadow && shadowStyle == 2) {
      toneInk = 1.0;
    } else if (inShadow && shadowStyle == 0) {
      toneInk = halftone(px, min(coverage + shadowTone, 1.0));
    } else {
      toneInk = halftone(px, coverage);
      if (inShadow && shadowStyle == 1) toneInk = max(toneInk, hatch(px, shadowTone));
    }
    ink = max(ink, toneInk);
  }

  outColor = vec4(vec3(1.0 - ink), 1.0);
}
`;

/** Copia semplice: con filtro lineare e target interno 2x fa da downsample (antialiasing). */
export const blitFragmentShader = /* glsl */ `
uniform sampler2D tSource;
varying vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  outColor = texture(tSource, vUv);
}
`;
