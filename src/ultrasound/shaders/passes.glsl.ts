import { TISSUE_COUNT } from '../../anatomy/tissues';
import { C_RECONSTRUCTION_MM_S } from '../../core/units';
import { ANATOMY_GLSL } from '../../anatomy/gpu/anatomy.glsl';
import { APERTURE_GLSL, STEERED_APERTURE_GLSL } from '../aperture';
import { COMPOUND, COMPOUND_GLSL } from '../compound';
import { IFACE_REACH_MM, INTERFACE_ECHO_GLSL } from '../interfaceEcho';
import { GAS_DB_PER_CM, MIRROR_BISECTION_STEPS, STEERED_PREFIX_GLSL } from '../transmission';
import {
  CURTAIN_AIR_GLSL,
  CURTAIN_CONTIGUOUS_SEGMENTS,
  CURTAIN_GAS_KIND,
  CURTAIN_RECORD_MM,
  PLEURA_GLSL,
  PLEURA_STEER_GUESS_MM,
  PLEURA_STEER_ITERATIONS,
} from '../pleura';
import { SPECKLE_LOOK_GLSL, SPECKLE_TISSUE_GLSL } from '../speckleField';
import { WALL_FACE_ECHO_GLSL, WALL_TEXTURE_GLSL } from '../wallTexture';
import { REST_TEXTURE_GLSL } from '../restTexture';
import { PORTAL_TRIADS_GLSL } from '../portalTriads';
import { RETRO_TEXTURE_GLSL } from '../retroTexture';
import { CLUTTER, SIDELOBE_PHASE_GLSL } from '../clutter';
import { RECEIVER_GLSL, glslFloat } from '../receiver';
import { HARMONIC_GLSL } from '../harmonic';
import { STEERING_GLSL } from '../steering';
import { M_SAMPLES } from '../mmode';

export const VERT = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 pos = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = 0.5 * (pos + 1.0);
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

/** Geometría del haz común a las pasadas de formación de imagen. */
/** Ejes de la sonda y dirección de una línea de la mirada 0: los comparten las pasadas con geometría del haz y K. */
const LINE_DIR_GLSL = /* glsl */ `
uniform vec3 uAxial;
uniform vec3 uLateral;
uniform vec3 uElev;
vec3 lineDir(float theta) { return normalize(uAxial * cos(theta) + uLateral * sin(theta)); }
`;

const BEAM_GEOMETRY_GLSL = /* glsl */ `
uniform vec3 uFace;${LINE_DIR_GLSL}uniform vec3 uCurvC;
uniform float uCurvR;
uniform float uHalfSector;
uniform float uDepth;      // mm
uniform float uLinesF;
uniform sampler2D uCoupling; // 1D: acoplamiento por línea

float lineTheta(float u) { return -uHalfSector + 2.0 * uHalfSector * u; }
vec3 pointOnLine(vec3 dir, float r) { return uCurvC + dir * (uCurvR + r); }
`;

/**
 * σ elevacional de una vía de la lente (mm) a la distancia r: la usan B y, por la cortina (decisión 61), K. En
 * armónica (decisión 77, `harmonic.ts`) la emisión va a λ1 = 2λ (cintura y rango de Rayleigh ×2) con la fuente
 * ∝ p1² (÷√2) y la recepción a λ: la σ equivalente de una vía es √2 × la de dos vías de ese par. Gemelo:
 * `elevSigmaMm` de `pleura.ts`.
 */
const ELEV_SIGMA_GLSL = /* glsl */ `
uniform float uElevSigma0;  // σ elevacional en el foco de la lente (mm)
uniform float uElevFocus;   // mm
uniform float uElevHarmonic; // 1: armónica (decisión 77)
float elevSigma(float r) {
  float zr = 45.0;
  float x = (r - uElevFocus) / zr;
  float s = uElevSigma0 * sqrt(1.0 + x * x);
  if (uElevHarmonic < 0.5) return s;
  float sT = 1.41421356 * uElevSigma0 * sqrt(1.0 + 0.25 * x * x);
  return 1.41421356 * s * sT * inversesqrt(s * s + sT * sT);
}
`;

/**
 * vec4 de una tabla por tejido empaquetada de 4 en 4 (patrón de `uTissueClump4`): una ranura de uniforms
 * por cada 4 tejidos y no una por tejido. El renderer sube `4·TISSUE_VEC4` floats (los de relleno, a 0).
 */
export const TISSUE_VEC4 = Math.ceil(TISSUE_COUNT / 4);

/** Retrodispersión por tejido: la única tabla por tejido que lee la pasada B. */
const TISSUE_BACK_GLSL = /* glsl */ `
uniform vec4 uTissueBack4[${TISSUE_VEC4}]; // amplitud de retrodispersión, de 4 en 4
float tissueBack(int t) { return uTissueBack4[t / 4][t % 4]; }
`;

/**
 * Geometría del haz y tablas por tejido (tamaño desde TISSUE_COUNT, nunca a mano; de 4 en 4 por vec4:
 * 21 ranuras en lugar de 81). La pasada B no declara atenuación ni banderas (no las lee).
 */
const BEAM_GLSL = /* glsl */ `${BEAM_GEOMETRY_GLSL}
uniform vec4 uTissueAlpha4[${TISSUE_VEC4}]; // dB/cm a la frecuencia B, de 4 en 4
uniform vec4 uTissueFlag4[${TISSUE_VEC4}];  // 1 gas, 2 hueso, de 4 en 4
float tissueAlpha(int t) { return uTissueAlpha4[t / 4][t % 4]; }
float tissueFlag(int t) { return uTissueFlag4[t / 4][t % 4]; }
${TISSUE_BACK_GLSL}`;

/**
 * Mirada del cuadro (composición espacial, decisión 58): la adquisición intercalada forma una mirada por
 * cuadro. A2, A y B tienen dos programas cada una, de una sola fuente (`transPrefixShader`,
 * `transmissionShader`, `rawFieldShader`): el de la mirada 0 (θ = 0: la mirada 0 o el compuesto apagado),
 * que es byte a byte el de antes de la composición y no lleva nada de la dirigida, y el de las miradas ±θ,
 * el único que declara uSteer. El renderizador elige uno por cuadro. Compilar la rama dirigida dentro del
 * programa de la mirada 0, detrás de un `if (uSteer.x != 0.0)` que con θ = 0 no se tomaba, le costaba a B
 * ~2 ms por cuadro en el M4 aun con el compuesto apagado (registros y tamaño del programa): se descartó.
 */
const STEER_GLSL = /* glsl */ `
uniform vec4 uSteer; // (θ en el elemento, R·sin θ, R·cos θ, k2 = 4π/λ): compound.ts y steering.ts
`;

/** Programa de la mirada 0 o de las miradas dirigidas de una pasada con miradas (decisión 58). */
type Look = 'look0' | 'steered';

/**
 * Hueco de una fuente con miradas: el texto solo va en el programa dirigido; en el de la mirada 0 no queda
 * nada (ni una línea en blanco), así que ese programa es el de antes de la composición byte a byte.
 */
const steeredOnly = (look: Look, glsl: string): string => (look === 'steered' ? glsl : '');

/**
 * PSF lateral de dos vías por número F (`ultrasound/beamModel.ts`: misma fórmula). La comparten la
 * pasada D (su anchura) y la B (la coherencia de curvatura del eco de interfaz, decisión 57). La emisión lleva
 * su λ y su escala (`uBeamTx`): las de recepción y 1 en fundamental; 2λ y 1/√2 en armónica (decisión 77). Las
 * dos λ crecen con la profundidad por la bajada de la frecuencia central (decisión 84): λ(r) = λ·(1 + κ·r), con la κ
 * de emisión y la del eco en `uBeamTx.zw` (el Doppler, 0).
 */
export const LATERAL_PSF_GLSL = /* glsl */ `
uniform vec2 uFocus;       // foco (mm) y FWHM de la emisión en el foco del preajuste (mm, referencia de focalGain)
uniform vec4 uBeam;        // λ·k de recepción (mm), c·D_tx (cono de emisión, mm), D_rx,max (mm), F#_rx,min
uniform vec4 uBeamTx;      // λ·k_tx·c de emisión (mm), escala del haz de emisión, κ de emisión y del eco (1/mm)
// FWHM de los haces de emisión y de recepción de una vía (beamFwhmMm)
vec2 beamFwhm(float r) {
  float rr = max(1.0, r);
  float F = max(10.0, uFocus.x);
  float tx = uBeamTx.y * length(vec2(uBeamTx.x * (1.0 + uBeamTx.z * rr) * F / uBeam.y, uBeam.y * abs(rr - F) / F));
  float dRx = min(uBeam.z, rr / uBeam.w);
  return vec2(tx, uBeam.x * (1.0 + uBeamTx.w * rr) * rr / max(1.0, dRx));
}
float lateralSigmaMm(float r) {
  vec2 w = beamFwhm(r);
  return inversesqrt(1.0 / (w.x * w.x) + 1.0 / (w.y * w.y)) / 2.3548;
}
// Ganancia focal de la emisión (focalGain): la intensidad en el eje, ∝ 1/FWHM_tx, en amplitud y relativa a la del
// foco del preajuste (solo la pasada B, sobre el eco)
float focalGain(float r) { return sqrt(uFocus.y / beamFwhm(r).x); }
// f(r)/f0 del eco: la bajada de la frecuencia central (frequencyRatio)
float echoFrequency(float r) { return 1.0 / (1.0 + uBeamTx.w * max(r, 0.0)); }
`;

/**
 * Pasada A en cuatro etapas (decisión 54). Antes cada celda (línea × profundidad gruesa) marchaba
 * su rayo desde la piel: O(N²), ~2,5 millones de clasificaciones por cuadro. Ahora:
 *   A0 impactos: una marcha por línea (primer pulmón del tórax con su reflexión especular —el espejo, en
 *      el cruce exacto por bisección (decisión 57)—, primer gas, primer hueso) y, aparte, la pleura
 *      parietal (decisión 61): el cruce exacto de la cara interna de la pared en el receso, su distancia al
 *      borde de la cortina y la pérdida que el pulmón de la cortina añade frente al tejido de detrás; el
 *      pulmón de la cortina no es espejo ni impacto de gas (el camino sigue recto);
 *   A1 segmentos: cada segmento grueso se clasifica una vez, sobre el camino (reflejado o no) de A0;
 *   A2 suma: la atenuación ida y vuelta acumulada hasta cada profundidad, con las mismas reglas que
 *      `ultrasound/transmission.ts` (gel previo a la piel sin pérdidas, gas 60 dB/cm, hueso 6 dB al
 *      entrar + absorción, espejo 0,5 dB);
 *   A  apertura: la transmisión de ida es la media sobre el cono del haz, no la de un solo rayo: un
 *      obstáculo que tapa parte de la apertura deja penumbra y la sombra se rellena en profundidad.
 * Salida de A: 0 = (transmisión ida y vuelta con apertura, gasHit, boneHit, mirrorHit),
 * 1 = (dirección reflejada, tipo de gas: 1 pulmón, 2 intestinal), 2 = (transmisión de un solo rayo:
 * la que usan el color y el PW, que así comparten modelo; decisión 50), 3 = la mirada dirigida del
 * cuadro (decisión 58): (transmisión con apertura, primer gas, tipo de gas + 4·(línea del espejo + 1),
 * espejo), con las distancias a lo largo de su camino. A2 y A la suman sobre los segmentos de A1, sin
 * clasificación ni pasada nuevas (`steeredPrefixDb`, `steeredApertureTransmission`), en sus programas
 * dirigidos: en un cuadro de la mirada 0 nadie escribe ni lee la salida 3 de A ni la 2 y la 3 de A2.
 */
export const FRAG_TRANS_HITS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
${BEAM_GLSL}
uniform float uCoarseN;
in vec2 vUv;
layout(location = 0) out vec4 h0; // (segmento del espejo, del primer gas, del primer hueso, tipo de gas)
layout(location = 1) out vec4 h1; // (dirección reflejada, r del espejo)
layout(location = 2) out vec4 h2; // pleura parietal (decisión 61): (D, dz, ΔL dB, 3 + 4·(último seg. de la cortina + 1))
// dB ida y vuelta del segmento con la regla de A1
float segmentDb(int t, float step) {
  float flag = tissueFlag(t);
  return flag > 0.5 && flag < 1.5 ? ${glslFloat(GAS_DB_PER_CM)} * step / 10.0 : 2.0 * tissueAlpha(t) * (step / 10.0);
}
void main() {
  vec3 dir0 = lineDir(lineTheta(vUv.x));
  float step = uDepth / uCoarseN;
  int n = int(uCoarseN);
  vec3 origin = pointOnLine(dir0, 0.0);
  vec3 dir = dir0;
  vec3 hitPoint = origin;
  float hitR = 0.0;
  float mirrorSeg = -1.0, gasSeg = -1.0, boneSeg = -1.0, gasKind = 0.0;
  float pleuraD = -1.0, pleuraDz = 0.0, curtainDb = 0.0, prevInside = -1.0, curtainLast = -1.0;
  bool entered = false;
  bool curtainRun = false;
  bool crossed = false;
  // Una sola clasificación por vuelta (classifyWith inlineado una vez, como classify antes de la decisión 61):
  // tras una muestra de la lámina de la cortina, la vuelta siguiente (behind) clasifica la misma muestra sin la
  // cortina, lo de detrás de la lámina, y suma su ΔL. Hasta 2·512 vueltas para 512 muestras.
  bool behind = false;
  float lungDb = 0.0;
  int s = -1;
  for (int it = 0; it < 1024; it++) {
    if (!behind) s++;
    if (s >= n) break;
    float r = (float(s) + 0.5) * step;
    vec3 p = mirrorSeg >= 0.0 ? hitPoint + dir * (r - hitR) : origin + dir * r;
    vec3 m = toMaterial(p);
    Cls c = classifyWith(m, !behind);
    if (behind) {
      // ΔL: lo que el gas de la cortina cuesta de más frente al tejido de detrás
      curtainDb += lungDb - segmentDb(c.tissue, step);
      behind = false;
      continue;
    }
    // Pleura parietal: primer cruce exacto de la cara interna de la pared, si cae en el receso cerca del borde
    if (mirrorSeg < 0.0 && !crossed) {
      float inside = insideWallMm(m);
      if (inside >= 0.0 && prevInside < 0.0) {
        crossed = true;
        float lo = max(r - step, 0.0);
        float hi = r;
        for (int it = 0; it < ${MIRROR_BISECTION_STEPS}; it++) {
          float mid = 0.5 * (lo + hi);
          if (insideWallMm(toMaterial(origin + dir0 * mid)) >= 0.0) hi = mid; else lo = mid;
        }
        float rp = 0.5 * (lo + hi);
        float dz = lungCurtainEdgeMm(toMaterial(origin + dir0 * rp));
        if (dz > -${glslFloat(CURTAIN_RECORD_MM)}) { pleuraD = rp; pleuraDz = dz; }
      }
      prevInside = inside;
    }
    // Hueco entre la cara convexa y la piel: gel de acoplamiento (el acoplamiento va aparte).
    if (c.tissue == T_AIR && !entered) continue;
    entered = true;
    float flag = tissueFlag(c.tissue);
    // pulmón que toca la pared en el receso (la cortina o el tórax) y el que le sigue pegado (aire con aire),
    // solo si su pleura está registrada y el pulmón empieza pegado a ella (si el cruce cae fuera de la huella, o
    // la línea roza el borde y llega al pulmón del receso mucho más hondo, el modelo de antes: el espejo)
    curtainRun = c.tissue == T_LUNG && mirrorSeg < 0.0 && (curtainRun || (pleuraD >= 0.0 && float(s) * step <= pleuraD + ${glslFloat(CURTAIN_CONTIGUOUS_SEGMENTS)} * step && inLungRecess(m, insideWallMm(m))));
    if (flag > 0.5 && flag < 1.5) {
      if (curtainRun) {
        // ni espejo ni impacto de gas; en la lámina, la vuelta siguiente clasifica lo de detrás (ΔL). Fuera de ella
        // (el pulmón del tórax que le sigue pegado) classifyWith sin la cortina da el mismo pulmón: ΔL 0, sin vuelta
        lungDb = segmentDb(c.tissue, step);
        curtainLast = float(s);
        behind = lungCurtainDistance(m, insideWallMm(m)) >= 0.0;
        continue;
      }
      if (c.tissue == T_LUNG && mirrorSeg < 0.0) {
        // Cruce exacto con la pleura (decisión 57): bisección entre la muestra gruesa anterior (que no es
        // pulmón) y esta. Antes el espejo quedaba en el centro de la primera celda de pulmón (0–1,1 mm
        // dentro) y dejaba una costura negra entre el diafragma y su imagen especular.
        float lo = max(r - step, 0.0);
        float hi = r;
        vec3 nn = c.n;
        for (int it = 0; it < ${MIRROR_BISECTION_STEPS}; it++) {
          float mid = 0.5 * (lo + hi);
          Cls cm = classify(toMaterial(origin + dir * mid));
          if (cm.tissue == T_LUNG) { hi = mid; nn = cm.n; } else lo = mid;
        }
        mirrorSeg = float(s); hitR = 0.5 * (lo + hi); hitPoint = origin + dir * hitR;
        if (dot(nn, dir) > 0.0) nn = -nn;
        dir = reflect(dir, nn);
        if (gasSeg < 0.0) { gasSeg = float(s); gasKind = 1.0; }
        continue;
      }
      if (gasSeg < 0.0) { gasSeg = float(s); gasKind = 2.0; }
      continue;
    }
    if (flag > 1.5 && boneSeg < 0.0) boneSeg = float(s);
  }
  h0 = vec4(mirrorSeg, gasSeg, boneSeg, gasKind);
  h1 = vec4(dir, hitR);
  h2 = pleuraD >= 0.0 ? vec4(pleuraD, pleuraDz, curtainDb, ${glslFloat(CURTAIN_GAS_KIND)} + 4.0 * (curtainLast + 1.0)) : vec4(-1.0, 0.0, 0.0, 0.0);
}
`;

export const FRAG_TRANS_SEGMENTS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
${BEAM_GLSL}
uniform float uCoarseN;
uniform sampler2D uHits0;
uniform sampler2D uHits1;
uniform sampler2D uHits2;
in vec2 vUv;
out vec4 oSeg; // (dB ida y vuelta del segmento, es aire, es hueso, tipo de gas: 0 no, 1 pulmón, 2 otro, 3 cortina)
void main() {
  int line = int(gl_FragCoord.x);
  int s = int(gl_FragCoord.y);
  vec4 h0 = texelFetch(uHits0, ivec2(line, 0), 0);
  vec4 h1 = texelFetch(uHits1, ivec2(line, 0), 0);
  vec4 h2 = texelFetch(uHits2, ivec2(line, 0), 0);
  // último segmento del pulmón de la cortina (A0, decisión 61)
  float curtainLast = floor(h2.w / 4.0) - 1.0;
  vec3 dir0 = lineDir(lineTheta(vUv.x));
  float step = uDepth / uCoarseN;
  float r = (float(s) + 0.5) * step;
  vec3 origin = pointOnLine(dir0, 0.0);
  // tras el espejo, el camino sigue la dirección reflejada desde el punto de impacto
  bool reflected = h0.x >= 0.0 && float(s) > h0.x;
  vec3 p = reflected ? origin + dir0 * h1.w + h1.xyz * (r - h1.w) : origin + dir0 * r;
  Cls c = classify(toMaterial(p));
  float flag = tissueFlag(c.tissue);
  float db;
  if (float(s) == h0.x) db = 0.5;                                  // el espejo: 0,5 dB y sigue
  else if (flag > 0.5 && flag < 1.5) db = 60.0 * step / 10.0;      // gas (o aire tras la piel)
  else db = 2.0 * tissueAlpha(c.tissue) * (step / 10.0);
  // .w: marca de gas para el prefijo dirigido (decisión 58), como A0: 1 pulmón, 2 otro gas, 3 cortina (61)
  float lung = !reflected && float(s) <= curtainLast ? ${glslFloat(CURTAIN_GAS_KIND)} : 1.0;
  float gas = flag > 0.5 && flag < 1.5 ? (c.tissue == T_LUNG ? lung : 2.0) : 0.0;
  oSeg = vec4(db, c.tissue == T_AIR ? 1.0 : 0.0, flag > 1.5 ? 1.0 : 0.0, gas);
}
`;

/**
 * A2 de una mirada (decisión 58). La mirada 0 es la suma de siempre; el programa dirigido calcula además, en
 * `o2`/`o3`, el prefijo de la mirada del cuadro a lo largo de su camino (`steeredPrefix`). La mirada 0 se
 * calcula en todos los cuadros: el programa dirigido de B lee la dirección reflejada del espejo de A o1 y
 * `readTransmission` lee la mirada 0 tras cualquier cuadro.
 */
function transPrefixShader(look: Look): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${BEAM_GLSL}
uniform float uCoarseN;
uniform sampler2D uSeg;
uniform sampler2D uHits0;
uniform sampler2D uHits1;
in vec2 vUv;
layout(location = 0) out vec4 o0; // (dB ida y vuelta de un rayo, gasHit, boneHit, mirrorHit)
layout(location = 1) out vec4 o1; // (dirección, tipo de gas)
${steeredOnly(look, STEERED_PREFIX_DECL_GLSL)}void main() {
  int line = int(gl_FragCoord.x);
  int k = int(gl_FragCoord.y);
  float attenDb = 0.0;
  bool entered = false;
  bool boneEntered = false;
  for (int s = 0; s < 512; s++) {
    if (s > k) break;
    vec4 g = texelFetch(uSeg, ivec2(line, s), 0);
    if (g.y > 0.5 && !entered) continue;
    entered = true;
    if (g.z > 0.5 && !boneEntered) { attenDb += 6.0; boneEntered = true; }
    attenDb += g.x;
  }
  vec4 h0 = texelFetch(uHits0, ivec2(line, 0), 0);
  vec4 h1 = texelFetch(uHits1, ivec2(line, 0), 0);
  float step = uDepth / uCoarseN;
  float kf = float(k);
  // Espejo desde la fila que contiene su r exacta menos el alcance del eco pleural: la pasada B refleja
  // solo r > mirrorHit y centra ahí el eco (decisión 57). Las A-lines, a múltiplos de la pleura exacta.
  float mirrorHit = h0.x >= 0.0 && h1.w < (kf + 1.0) * step + ${IFACE_REACH_MM.toFixed(4)} ? h1.w : -1.0;
  float gasHit = h0.y >= 0.0 && h0.y <= kf ? (h0.y == h0.x ? h1.w : (h0.y + 0.5) * step) : -1.0;
  float boneHit = h0.z >= 0.0 && h0.z <= kf ? (h0.z + 0.5) * step : -1.0;
  vec3 dir = mirrorHit >= 0.0 ? h1.xyz : lineDir(lineTheta(vUv.x));
  o0 = vec4(attenDb, gasHit, boneHit, mirrorHit);
  o1 = vec4(dir, gasHit >= 0.0 ? h0.w : 0.0);
${steeredOnly(look, STEERED_PREFIX_MAIN_GLSL)}}
`;
}

/** Declaraciones que A2 añade en su programa dirigido (decisión 58). */
const STEERED_PREFIX_DECL_GLSL = /* glsl */ `${STEER_GLSL}
// Mirada dirigida del cuadro (decisión 58), a lo largo de su camino: (dB, sGas, sBone, sMirror) y
// (tipo de gas, línea del espejo, 0, 0); −1 sin impacto
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
${STEERING_GLSL}
${STEERED_PREFIX_GLSL}
`;

/** Final del main de A2 en su programa dirigido: el prefijo de la mirada del cuadro. */
const STEERED_PREFIX_MAIN_GLSL = /* glsl */ `  vec2 extra;
  o2 = steeredPrefix(line, k, extra);
  o3 = vec4(extra, 0.0, 0.0);
`;

/** A2 de la mirada 0: el de antes de la composición, sin nada de la dirigida (decisión 58). */
export const FRAG_TRANS_PREFIX = transPrefixShader('look0');
/** A2 de las miradas ±θ: la mirada 0 y, en `o2`/`o3`, el prefijo de la mirada del cuadro. */
export const FRAG_TRANS_PREFIX_STEERED = transPrefixShader('steered');

/**
 * A de una mirada (decisión 58). La mirada 0 es la penumbra de siempre (`o0`–`o2`); el programa dirigido
 * calcula además, en `o3`, la de la mirada del cuadro sobre los caminos dirigidos vecinos
 * (`steeredApertureTransmission`, con las distancias a lo largo del camino), con el primer gas, y el tipo
 * de gas y la línea del espejo juntos en .z (enteros pequeños, exactos en float32: la pasada B los separa).
 */
function transmissionShader(look: Look): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${BEAM_GLSL}
uniform float uCoarseN;
uniform sampler2D uPre0;
uniform sampler2D uPre1;
uniform sampler2D uHits0;
uniform vec3 uAperture; // D de emisión (mm), D de recepción máxima (mm), F# de recepción mínimo
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
${APERTURE_GLSL}
${steeredOnly(look, STEERED_TRANSMISSION_DECL_GLSL)}void main() {
  int line = int(gl_FragCoord.x);
  int k = int(gl_FragCoord.y);
  vec4 c0 = texelFetch(uPre0, ivec2(line, k), 0);
  vec4 c1 = texelFetch(uPre1, ivec2(line, k), 0);
  float step = uDepth / uCoarseN;
  float r = (float(k) + 0.5) * step;
  float single = pow(10.0, -c0.x / 20.0);
  float T = apertureTransmission(line, k, r, step, single);
  o0 = vec4(T, c0.yzw);
  o1 = c1;
  o2 = vec4(single, 0.0, 0.0, 0.0);
${steeredOnly(look, STEERED_TRANSMISSION_MAIN_GLSL)}}
`;
}

/** Declaraciones que A añade en su programa dirigido (van detrás de `APERTURE_GLSL`: usan AP_TAPS). */
const STEERED_TRANSMISSION_DECL_GLSL = /* glsl */ `uniform sampler2D uPreSteer;  // A2 o2: prefijo de la mirada dirigida del cuadro (decisión 58)
uniform sampler2D uPreSteerX; // A2 o3: (tipo de gas, línea del espejo) de esa mirada
${STEER_GLSL}
layout(location = 3) out vec4 o3;
${STEERING_GLSL}
${STEERED_APERTURE_GLSL}
`;

/** Final del main de A en su programa dirigido: la penumbra de la mirada del cuadro. */
const STEERED_TRANSMISSION_MAIN_GLSL = /* glsl */ `  vec4 ps = texelFetch(uPreSteer, ivec2(line, k), 0);
  vec4 px = texelFetch(uPreSteerX, ivec2(line, k), 0);
  float s = alongLineMm(uCurvR + r, uSteer.y, uSteer.z);
  float singleK = pow(10.0, -ps.x / 20.0);
  float Tk = steeredApertureTransmission(line, k, s, singleK);
  // el rayo único de la mirada: la pasada B acota con él la transmisión sin la lámina de la cortina (decisión 61)
  o2.y = singleK;
  o3 = vec4(Tk, ps.y, px.x + 4.0 * (px.y + 1.0), ps.w);
`;

/** A de la mirada 0: el de antes de la composición, sin nada de la dirigida (decisión 58). */
export const FRAG_TRANSMISSION = transmissionShader('look0');
/** A de las miradas ±θ: la mirada 0 y, en `o3`, la penumbra de la mirada del cuadro. */
export const FRAG_TRANSMISSION_STEERED = transmissionShader('steered');

/**
 * Rama dirigida de la pasada B (composición espacial, decisión 58): la muestra P (línea j, fila r) de la
 * rejilla común, formada por la línea dirigida que pasa por ella, la del elemento φ_k = α − θ + β(ρ)
 * (`steering.ts`). Lo que cambia respecto a la mirada 0:
 *  - el moteado: los mismos dispersores con la fase de la mirada por nodo (`speckleFieldPh`), así que se
 *    decorrela de la mirada 0 según la ley de la PSF, sin ningún filtro (§23); grumos y heterogeneidad son
 *    del material y comunes a todas las miradas;
 *  - la transmisión: la del camino dirigido con su penumbra (A o3) y el acoplamiento del elemento φ_k;
 *  - el eco de interfaz, con la incidencia de esta mirada (dirección φ_k + θ = α + β);
 *  - la reverberación, a múltiplos del primer gas de la mirada a lo largo de su camino, y la cola sucia y
 *    el transitorio, anclados a (línea dirigida, distancia del camino) con la sal de la mirada: cada
 *    mirada es otro disparo y no comparte artefactos;
 *  - tras el espejo diafragmático: el camino sigue la dirección reflejada de la línea cuyo espejo cruza,
 *    desde su propio cruce, con la fase del potencial directo (aproximaciones declaradas); la pleura dibuja
 *    su eco con el coseno de esta mirada;
 *  - la pleura parietal y la cortina (decisión 61), con el mismo modelo que la mirada 0 a lo largo del camino
 *    dirigido: su cruce sD es el de la línea que el camino corta a la profundidad de la pleura (punto fijo
 *    sobre A0 h2), la serie remuestrea la pared en el propio camino con la fase de la mirada y el
 *    deslizamiento lleva la sal de la mirada.
 * Fuera del arreglo la mirada no existe (K la pesa 0), pero se forma hasta el alcance del núcleo lateral de
 * D (±2,5σ, el mismo cálculo): si no, D mezclaría ceros en las muestras con peso junto al borde.
 * Va solo en el programa dirigido de B (`FRAG_RAWFIELD_STEERED`), cuyo main es `steeredField()`; el de la
 * mirada 0 no la lleva. Gemelo de la geometría (punto, dirección, pleura, reverberación, anclas, alcance,
 * cortina): `steeredSample` (`steering.ts`); `steeredSample.test.ts` fija estas líneas.
 */
export const STEERED_FIELD_GLSL = /* glsl */ `
${SPECKLE_LOOK_GLSL}
${STEERING_GLSL}
const int PLEURA_STEER_ITERATIONS = ${PLEURA_STEER_ITERATIONS};
const float PLEURA_STEER_GUESS_MM = ${glslFloat(PLEURA_STEER_GUESS_MM)};
// fieldFor y sampleSide con la fase de la mirada por nodo (speckleField.ts, variantes …Ph); b0, la dirección de la
// mirada 0 en el punto del mundo (la radial desde el centro de curvatura); w, la jacobiana de la compresión
vec2 fieldForPhBase(vec3 m, float se, int tissue, float ph0, vec3 g, vec3 b0, Warp w) {
  vec2 f = speckleFieldPh(m, uLattice, se, float(tissue) * TISSUE_SALT_STEP, ph0, g);
  float het = 1.0;
  if (tissue == T_LIVER || tissue == T_MUSCLE || tissue == T_BOWEL || tissue == T_RENAL_CORTEX || tissue == T_PSOAS || tissue == T_QUADRATUS) het = hetGain(m);
  // textura de la pared (decisión 62) con la dirección de esta mirada: b_k = b_0 + g/k2 (g = k2·(b_k − b_0))
  if (tissue == T_FAT || tissue == T_MUSCLE) het *= wallTexture(m, tissue, normalize(b0 + g / uSteer.w), w);
  // el resto del abdomen: asas y grasa mesentérica (decisión 74, restTexture.ts)
  if (tissue == T_BOWEL) het *= restTexture(m);
  // tríadas portales finas del hígado (decisión 78, portalTriads.ts)
  if (tissue == T_LIVER) het *= portalTriad(m);
  return f * tissueBack(tissue) * het;
}
// con los septos del psoas y del cuadrado (decisión 81) en la dirección de esta mirada; wallFieldPh usa la base
vec2 fieldForPh(vec3 m, float se, int tissue, float ph0, vec3 g, vec3 b0, Warp w) {
  return fieldForPhBase(m, se, tissue, ph0, g, b0, w) * retroTexture(m, tissue, normalize(b0 + g / uSteer.w), w);
}
vec2 sampleSidePh(vec3 p, float se, Cls center, float ph0, vec3 g, bool withCurtain, Warp w) {
  vec3 m = toMaterial(p);
  int t = center.bd > se + 0.5 ? center.tissue : classifyWith(m, withCurtain).tissue;
  return fieldForPh(m, se, t, ph0, g, normalize(p - uCurvC), w);
}
// h2 de A0 de la línea cuyo cruce de la pleura está en el camino de φ_k (punto fijo) y sD, su distancia en él
vec4 steeredPleura(float phiK, float a, int line0, out float sD) {
  vec4 h = texelFetch(uHits2, ivec2(line0, 0), 0);
  float dg = h.x >= 0.0 ? h.x : PLEURA_STEER_GUESS_MM;
  for (int it = 0; it < PLEURA_STEER_ITERATIONS; it++) {
    float al = phiK + uSteer.x - steerBeta(uCurvR + dg, a);
    int l = clamp(int(floor((al + uHalfSector) / (2.0 * uHalfSector) * uLinesF)), 0, int(uLinesF) - 1);
    h = texelFetch(uHits2, ivec2(l, 0), 0);
    if (h.x >= 0.0) dg = h.x;
  }
  sD = h.x >= 0.0 ? alongLineMm(uCurvR + h.x, a, uSteer.z) : -1.0;
  return h;
}
// A o3 (sin acoplamiento) en el punto del camino a la distancia x
float steeredT(float phiK, float a, float x) {
  float rho = sqrt(uCurvR * uCurvR + x * x + 2.0 * x * uSteer.z);
  float al = phiK + uSteer.x - steerBeta(rho, a);
  return texture(uTrans3, vec2((al + uHalfSector) / (2.0 * uHalfSector), (rho - uCurvR) / uDepth)).x;
}
// mediumField y wallField con la fase de la mirada por nodo
vec2 mediumFieldPh(vec3 p, vec3 dir, float r, float se, bool withCurtain, float ph0, vec3 g) {
  vec3 m = toMaterial(p);
  Warp w = warpAt(p);
  Cls c = classifyWith(m, withCurtain);
  vec2 f0 = fieldForPh(m, se, c.tissue, ph0, g, normalize(p - uCurvC), w);
  vec2 f1 = sampleSidePh(p + uElev * se, se, c, ph0, g, withCurtain, w);
  vec2 f2 = sampleSidePh(p - uElev * se, se, c, ph0, g, withCurtain, w);
  float sideMag = 0.5 * length(f0) + 0.25 * (length(f1) + length(f2));
  vec2 field = length(f0) > 1e-6 ? f0 * (sideMag / length(f0)) : f0;
  float clump = uTissueClump4[c.tissue / 4][c.tissue % 4];
  if (clump > 0.0) field *= anchoredClump(m, se, clump, float(c.tissue) * TISSUE_SALT_STEP);
  return field + vec2(interfaceEcho(c, m, dir, r, se, w), 0.0);
}
vec2 wallFieldPh(vec3 p, vec3 dir, float se, float ph0, vec3 g, Warp w) {
  vec3 m = toMaterial(p);
  Cls c;
  float depth;
  vec3 tn;
  if (!classifyWall(m, c, depth, tn)) { c.tissue = T_FAT; c.n = tn; }
  vec2 field = fieldForPhBase(m, se, c.tissue, ph0, g, normalize(p - uCurvC), w);
  float clump = uTissueClump4[c.tissue / 4][c.tissue % 4];
  if (clump > 0.0) field *= anchoredClump(m, se, clump, float(c.tissue) * TISSUE_SALT_STEP);
  return field + vec2(WALL_COPY_FACE_GAIN * wallFaceEchoFlat(c, m, dir, w), 0.0);
}
vec2 steeredField() {
  float alpha = lineTheta(vUv.x);
  float r = vUv.y * uDepth;
  float rho = uCurvR + r;
  float a = uSteer.y;
  float phiK = steeredElement(alpha, rho, uSteer.x, a);
  float lineSpacing = rho * (2.0 * uHalfSector / (uLinesF - 1.0));
  float reach = ceil(2.5 * max(0.35, lateralSigmaMm(r) / lineSpacing));
  if ((abs(phiK) - uHalfSector) / (2.0 * uHalfSector / uLinesF) > 0.5 + reach) return vec2(0.0);
  float s = alongLineMm(rho, a, uSteer.z);          // distancia a lo largo del camino dirigido
  float k2 = uSteer.w * echoFrequency(r);           // la fase de la mirada a la frecuencia del eco (decisión 84)
  float uK = (phiK + uHalfSector) / (2.0 * uHalfSector);
  vec3 dirK = lineDir(alpha + steerBeta(rho, a));   // = lineDir(φ_k + θ): el camino es recto
  ivec2 ts = textureSize(uTrans3, 0);
  ivec2 tc = ivec2(min(floor(vUv * vec2(ts)), vec2(ts) - 1.0));
  vec4 t3 = texelFetch(uTrans3, tc, 0);
  float coupling = texture(uCoupling, vec2(uK, 0.5)).r;
  float sGas = t3.y;
  float sMirror = t3.w;
  float code = floor(t3.z / 4.0);                   // línea del espejo + 1
  float gasKind = t3.z - 4.0 * code;
  vec3 dir = dirK;
  vec3 dRefl = dirK;
  vec3 dMirror = dirK;
  if (sMirror >= 0.0) {
    int ml = clamp(int(code) - 1, 0, ts.x - 1);
    // dirección reflejada de la línea del espejo: A2 la publica en todas las filas desde su alcance
    dRefl = normalize(texelFetch(uTrans1, ivec2(ml, ts.y - 1), 0).xyz);
    dMirror = lineDir(lineTheta((float(ml) + 0.5) / uLinesF));
  }
  vec3 p;
  if (sMirror >= 0.0 && s > sMirror) {
    dir = dRefl;
    p = uCurvC + uCurvR * lineDir(phiK) + dirK * sMirror + dir * (s - sMirror);
  } else {
    p = pointOnLine(lineDir(alpha), r);
  }
  // Pleura parietal y cortina (decisión 61) a lo largo del camino dirigido, con su propio cruce sD
  vec3 elem = uCurvC + uCurvR * lineDir(phiK);
  float sD;
  vec4 h2 = steeredPleura(phiK, a, tc.x, sD);
  float fAir = sD > 0.0 ? curtainAirFraction(h2.y, h2.x, dirK) : 0.0;
  bool curtain = fAir >= CURTAIN_MIN_AIR;
  bool under = curtain && s > sD;
  float sCap = alongLineMm(uCurvR + pleuraCapMm(max(h2.x, 0.0), uDepth / float(ts.y)), a, uSteer.z);
  float tD = curtain ? steeredT(phiK, a, sCap) : 0.0;
  vec3 pD = elem + dirK * max(sD, 0.0);
  // la incidencia de la pleura en el mundo: su normal material por la jacobiana de la compresión (decisión 63)
  Warp wD = noWarp();
  if (curtain) wD = warpAt(pD);
  float cosI = curtain ? abs(dot(normalize(warpNormal(wD, torsoNormal(toMaterial(pD)))), dirK)) : 1.0;
  float chi = pleuraCoherence(cosI);
  float G = pleuraRoundTrip(tD, chi);
  vec3 ser = under ? pleuraSeriesDepths(s, sD) : vec3(0.0);
  float gn = seriesPow(G, ser.x);
  bool series = under && gn * tD * PLEURA_WALL_FIELD_BOUND * coupling > PLEURA_SERIES_FLOOR;
  float wTissue = under ? 1.0 - fAir : 1.0;
  // El tejido de la imagen fuera de bucles y la pared de las series en un bucle barato, como la mirada 0, cada
  // muestra con la fase de la mirada en su punto (σe de la rejilla común: s − r ≤ 0,5 mm)
  vec2 tissue = vec2(0.0);
  if (wTissue >= CURTAIN_MIN_AIR) {
    vec2 gr = lookPhaseGrad(rho, alpha, a, k2);
    tissue = mediumFieldPh(p, dir, s, elevSigma(r), !under, lookPhase(rho, alpha, a, k2), gr.x * uLateral + gr.y * uAxial);
  }
  vec2 air = vec2(0.0);
  int nWall = series ? 2 : 0;
  for (int j = 1; j <= nWall; j++) {
    float d = j == 1 ? ser.y : ser.z;
    float rhoJ = sqrt(uCurvR * uCurvR + d * d + 2.0 * d * uSteer.z);
    float alJ = phiK + uSteer.x - steerBeta(rhoJ, a);
    vec2 gr = lookPhaseGrad(rhoJ, alJ, a, k2);
    vec2 f = wallFieldPh(elem + dirK * d, dirK, elevSigma(rhoJ - uCurvR), lookPhase(rhoJ, alJ, a, k2), gr.x * uLateral + gr.y * uAxial, wD);
    float td = steeredT(phiK, a, min(d, sCap));
    air += f * (j == 1 ? (ser.x + 1.0) * PLEURA_RP * PLEURA_RP * chi * chi * tD * tD / max(td, 1e-6) * gn : (ser.x + 2.0) * td * G * gn);
  }
  vec2 out2 = vec2(0.0);
  if (wTissue >= CURTAIN_MIN_AIR) {
    if (sMirror >= 0.0) {
      // la normal de la pleura sale de la reflexión de la línea del espejo (dR − d0 ∥ n)
      vec3 dn = dRefl - dMirror;
      float ln = length(dn);
      tissue += vec2(pleuraEcho(s - sMirror, dirK, ln > 1e-6 ? reflect(dirK, dn / ln) : dirK), 0.0);
    }
    float dr = uDepth / 1024.0;
    float gain = pow(10.0, h2.z / 20.0);
    float tFree = min(texture(uTrans3, vUv).x, texture(uTrans2, vUv).y) * gain;
    float T = (curtain ? (under ? min(tFree, tD) : steeredT(phiK, a, min(s, sCap))) : texture(uTrans3, vUv).x) * coupling;
    tissue *= T;
    if (sGas > 0.0 && s > sGas) {
      // transmisión del camino hasta su gas: la de la mirada en el punto de la rejilla por el que pasa
      float sg = max(sGas - dr, 0.0);
      float rhoG = sqrt(uCurvR * uCurvR + sg * sg + 2.0 * sg * uSteer.z);
      float alphaG = phiK + uSteer.x - steerBeta(rhoG, a);
      float Tg = texture(uTrans3, vec2((alphaG + uHalfSector) / (2.0 * uHalfSector), (rhoG - uCurvR) / uDepth)).x * coupling;
      vec2 uvG = vec2((alphaG + uHalfSector) / (2.0 * uHalfSector), (rhoG - uCurvR) / uDepth);
      if (curtain && sGas > sD) Tg = min(min(Tg, texture(uTrans2, uvG).y * coupling) * gain, tD * coupling);
      float amp = 0.0;
      for (int k = 2; k <= 4; k++) {
        float z = (s - float(k) * sGas) / 1.2;
        amp += pow(0.5, float(k - 1)) * pow(Tg, float(k)) * exp(-0.5 * z * z);
      }
      tissue += vec2(amp * 0.9, 0.0);
      if (gasKind > 1.5)
        tissue += scattererField(vec3(uK * 190.0, s * 0.9, 0.0), 0.6, uSeed + 3.0 + uLookSalt) * 0.3 * Tg * exp(-(s - sGas) / 40.0);
    }
    out2 = tissue * wTissue;
  }
  if (curtain) {
    // el pulmón con la incidencia de esta mirada; el deslizamiento con su sal (cada mirada, otro disparo)
    float k = aLineOrder(s, sD);
    air += vec2(seriesPow(G, k - 1.0) * tD * interfaceProfileEcho(IF_PLEURA_WALL, cosI, 1.0, k * sD - s), 0.0);
    if (under && slidingAmplitude(s - sD) * tD * coupling > PLEURA_SERIES_FLOOR) air += slidingField(pD, s - sD, uLookSalt) * tD;
    out2 += air * (fAir * coupling);
  }
  // la acumulación del armónico (decisión 77) y la ganancia focal (decisión 84) son del eco del tejido, no del
  // transitorio ni del ruido
  out2 *= harmonicNearGain(s) * focalGain(s);
  if (s < TRANSIENT_SKIP_MM)
    out2 += scattererField(vec3(uK * 190.0, s * 3.0, 1.0), 0.8, uSeed + 7.0 + uLookSalt) * TRANSIENT_AMPLITUDE * uTransientGain * exp(-s / TRANSIENT_DECAY_MM) * coupling;
  float n1 = hash12b(vUv * 977.0 + uFrame * 1.7);
  float n2 = hash12b(vUv * 613.0 + uFrame * 3.1 + 11.0);
  float rad = sqrt(-2.0 * log(max(1e-6, n1)));
  return out2 + uNoise * rad * vec2(cos(6.2831853 * n2), sin(6.2831853 * n2));
}
`;

/**
 * Pasada B: campo complejo crudo por muestra de haz — dispersores persistentes
 * en coordenadas materiales integrados en elevación, eco de interfaz coherente en
 * el cruce exacto (decisión 57), reverberación/A-lines tras gas, cola sucia del gas
 * intestinal y, bajo la pleura parietal de la cortina, la línea pleural, la serie de reverberaciones de
 * la pared, el deslizamiento y el borde blando (decisión 61, `pleura.ts`). Dos programas de la misma fuente (decisión 58): el de la mirada 0 (`FRAG_RAWFIELD`, el de
 * siempre) y el de las miradas ±θ (`FRAG_RAWFIELD_STEERED`: la muestra de la rejilla común formada por la
 * línea dirigida que pasa por ella, `steeredField`). Comparten todo salvo sus entradas y su `main`.
 */
function rawFieldShader(look: Look): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
${BEAM_GEOMETRY_GLSL}
${TISSUE_BACK_GLSL}
${look === 'steered' ? STEERED_RAW_INPUTS_GLSL : LOOK0_RAW_INPUTS_GLSL}
uniform float uSeed;
uniform float uLattice;     // paso de retícula (mm)
uniform float uNoise;
uniform float uFrame;
// Ancla del medio de dispersores (speckleField.ts): vigente (0) y anterior (1), peso del fundido
uniform vec3 uAnchorE0;
uniform vec3 uAnchorP0;
uniform vec3 uAnchorE1;
uniform vec3 uAnchorP1;
uniform vec2 uAnchorSalt;
uniform float uAnchorW;
// Grumos de dispersores por tejido (decisión 56), de 4 en 4 para no gastar una ranura por tejido
uniform vec4 uTissueClump4[${TISSUE_VEC4}];
${RECEIVER_GLSL}${HARMONIC_GLSL}
in vec2 vUv;
out vec2 oField;
${ELEV_SIGMA_GLSL}${LATERAL_PSF_GLSL}
${SPECKLE_TISSUE_GLSL}
${WALL_TEXTURE_GLSL}
${REST_TEXTURE_GLSL}
${PORTAL_TRIADS_GLSL}
${RETRO_TEXTURE_GLSL}
${INTERFACE_ECHO_GLSL}
${WALL_FACE_ECHO_GLSL}

float hash12b(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// Campo de dispersores con la célula ELEVACIONAL igual al grosor de corte: la
// coordenada material a lo largo del eje del ancla se comprime para que la
// textura se decorrele al inclinar la sonda un grosor de corte, no una célula
// de 0,4 mm (idea de EchoTwin, decisión 99; Chen/Fowlkes/Carson/Rubin 1997).
// El eje y el pivote son un ancla fija, no la normal actual ni el origen del
// mundo: el medio no cambia al girar la sonda (decisión 55, speckleField.ts).
vec2 scattererFieldSlice(vec3 m, float h, float sliceHalfMm, float salt, vec3 e, vec3 pivot) {
  float across = dot(m - pivot, e);
  vec3 q = m - e * (across * (1.0 - h / max(h, 2.0 * sliceHalfMm)));
  return scattererField(q, h, salt);
}

// Medio anclado: fuera del fundido, una sola ancla; durante el fundido,
// √w·A + √(1−w)·B con semillas distintas (sigue siendo gaussiano).
vec2 speckleField(vec3 m, float h, float se, float salt) {
  vec2 fa = scattererFieldSlice(m, h, se, uSeed + salt + uAnchorSalt.x, uAnchorE0, uAnchorP0);
  if (uAnchorW >= 1.0) return fa;
  vec2 fb = scattererFieldSlice(m, h, se, uSeed + salt + uAnchorSalt.y, uAnchorE1, uAnchorP1);
  return sqrt(uAnchorW) * fa + sqrt(1.0 - uAnchorW) * fb;
}


// Campo de dispersores de un punto material con clasificación conocida. Cada tejido es otra
// población: su propia semilla (el moteado no continúa a través de un borde).
vec2 fieldForBase(vec3 m, float se, int tissue, vec3 dir, Warp w) {
  vec2 f = speckleField(m, uLattice, se, float(tissue) * TISSUE_SALT_STEP);
  // Heterogeneidad lenta y continua del parénquima (desviación 1,15 dB a ~1,6 ciclos/cm) [EXTRAPOLACIÓN PROPIA]
  float het = 1.0;
  if (tissue == T_LIVER || tissue == T_MUSCLE || tissue == T_BOWEL || tissue == T_RENAL_CORTEX || tissue == T_PSOAS || tissue == T_QUADRATUS) het = hetGain(m);
  // Textura de la pared (decisión 62, wallTexture.ts): septos de la grasa y estrías del músculo, anclados al
  // material; dir, la dirección del haz de la mirada 0 en el punto del mundo (la radial desde el centro de
  // curvatura) y w, la jacobiana de la compresión de la sonda (decisión 63) que lleva la lámina al mundo
  if (tissue == T_FAT || tissue == T_MUSCLE) het *= wallTexture(m, tissue, dir, w);
  // el resto del abdomen: asas y grasa mesentérica (decisión 74, restTexture.ts)
  if (tissue == T_BOWEL) het *= restTexture(m);
  // tríadas portales finas del hígado (decisión 78, portalTriads.ts)
  if (tissue == T_LIVER) het *= portalTriad(m);
  return f * tissueBack(tissue) * het;
}
// Con los septos de los fascículos del psoas y del cuadrado lumbar (decisión 81, retroTexture.ts): la muestra del medio
// y sus planos de elevación. La pared que copia la serie de la pleura (wallField, en un bucle) usa fieldForBase: allí no
// hay músculos retroperitoneales y el JIT de SwiftShader se dispara con código pesado en un bucle
vec2 fieldFor(vec3 m, float se, int tissue, vec3 dir, Warp w) {
  return fieldForBase(m, se, tissue, dir, w) * retroTexture(m, tissue, dir, w);
}

// Plano lateral en elevación: si el plano central está lejos de toda interfaz
// (bd > desplazamiento), el tejido es el mismo y se ahorra la clasificación. Bajo la pleura de la
// cortina (decisión 61) el tejido es el de detrás de la lámina de pulmón (withCurtain = false). Una sola
// llamada a fieldFor (se inlinea una vez por plano, no dos).
vec2 sampleSide(vec3 p, float se, Cls center, bool withCurtain, Warp w) {
  vec3 m = toMaterial(p);
  int t = center.bd > se + 0.5 ? center.tissue : classifyWith(m, withCurtain).tissue;
  return fieldFor(m, se, t, normalize(p - uCurvC), w);
}
${PLEURA_GLSL}
${look === 'steered' ? STEERED_RAW_MAIN_GLSL : LOOK0_RAW_MAIN_GLSL}`;
}

/** Entradas de B en la mirada 0: A o0 (transmisión e impactos) y A o1 (dirección reflejada, tipo de gas). */
const LOOK0_RAW_INPUTS_GLSL = /* glsl */ `uniform sampler2D uTrans0;
uniform sampler2D uTrans1;`;

/**
 * Entradas de B en una mirada dirigida (decisión 58): A o3 (la transmisión y los impactos del camino
 * dirigido), A o1 (la dirección reflejada de la línea del espejo) y la mirada; no lee A o0.
 */
const STEERED_RAW_INPUTS_GLSL = /* glsl */ `uniform sampler2D uTrans1;
uniform sampler2D uTrans3;  // A o3: la mirada dirigida del cuadro (decisión 58)
${STEER_GLSL}
uniform float uLookSalt;    // sal del transitorio y de la cola de la mirada (compound.ts)`;

/**
 * main de B en la mirada 0: el de antes de la composición salvo en las líneas de la cortina (decisión 61),
 * donde la fracción del haz que da en el pulmón (fAir) dibuja la línea pleural, sus réplicas, la serie de
 * reverberaciones de la pared y el deslizamiento, y el resto ve el tejido de detrás de la lámina de pulmón.
 */
const LOOK0_RAW_MAIN_GLSL = /* glsl */ `
void main() {
  float theta = lineTheta(vUv.x);
  vec3 dir0 = lineDir(theta);
  float r = vUv.y * uDepth;
  // Transmisión interpolada; impactos y dirección sin interpolar (texelFetch): mezclar entre líneas
  // una profundidad de impacto con «sin impacto» (−1) inventaba impactos a media profundidad.
  ivec2 ts = textureSize(uTrans0, 0);
  ivec2 tc = ivec2(min(floor(vUv * vec2(ts)), vec2(ts) - 1.0));
  vec4 t0 = vec4(texture(uTrans0, vUv).x, texelFetch(uTrans0, tc, 0).yzw);
  vec4 t1 = texelFetch(uTrans1, tc, 0);
  float coupling = texture(uCoupling, vec2(vUv.x, 0.5)).r;
  float mirrorHit = t0.w;
  vec3 dir = dir0;
  vec3 p;
  if (mirrorHit >= 0.0 && r > mirrorHit) {
    vec3 hp = pointOnLine(dir0, mirrorHit);
    dir = normalize(t1.xyz);
    p = hp + dir * (r - mirrorHit);
  } else {
    p = pointOnLine(dir0, r);
  }
  // Pleura parietal y cortina (decisión 61): cruce D (A0), fracción de aire del haz, transmisión hasta la
  // pleura sin el gas de su fila y, bajo ella, la serie (orden, distancias de la pared copiada)
  vec4 h2 = texelFetch(uHits2, ivec2(tc.x, 0), 0);
  float D = h2.x;
  float fAir = D > 0.0 ? curtainAirFraction(h2.y, D, dir0) : 0.0;
  bool curtain = fAir >= CURTAIN_MIN_AIR;
  bool under = curtain && r > D;
  float rCap = pleuraCapMm(max(D, 0.0), uDepth / float(ts.y));
  float tD = curtain ? texture(uTrans0, vec2(vUv.x, rCap / uDepth)).x : 0.0;
  vec3 pD = pointOnLine(dir0, max(D, 0.0));
  // la incidencia de la pleura en el mundo: su normal material por la jacobiana de la compresión (decisión 63)
  Warp wD = noWarp();
  if (curtain) wD = warpAt(pD);
  float cosI = curtain ? abs(dot(normalize(warpNormal(wD, torsoNormal(toMaterial(pD)))), dir0)) : 1.0;
  float chi = pleuraCoherence(cosI);
  float G = pleuraRoundTrip(tD, chi);
  vec3 ser = under ? pleuraSeriesDepths(r, D) : vec3(0.0);
  float gn = seriesPow(G, ser.x);
  bool series = under && gn * tD * PLEURA_WALL_FIELD_BOUND * coupling > PLEURA_SERIES_FLOOR;
  // El tejido: todo sobre la pleura; bajo ella, el de detrás de la cortina con peso 1 − fAir
  float wTissue = under ? 1.0 - fAir : 1.0;
  // El tejido de la imagen, fuera de bucles como antes de la decisión 61 (bajo la pleura, el de detrás de la
  // cortina con peso 1 − fAir); la pared que copian las series espejo y directa, a lo sumo dos muestras baratas
  // en un bucle (wallField: el JIT de SwiftShader se dispara con código pesado dentro de un bucle)
  vec2 tissue = wTissue >= CURTAIN_MIN_AIR ? mediumField(p, dir, r, elevSigma(r), !under) : vec2(0.0);
  vec2 air = vec2(0.0);
  int nWall = series ? 2 : 0;
  for (int j = 1; j <= nWall; j++) {
    float d = j == 1 ? ser.y : ser.z;
    vec2 f = wallField(pointOnLine(dir0, d), dir0, elevSigma(d), wD);
    float td = texture(uTrans0, vec2(vUv.x, min(d, rCap) / uDepth)).x;
    air += f * (j == 1 ? (ser.x + 1.0) * PLEURA_RP * PLEURA_RP * chi * chi * tD * tD / max(td, 1e-6) * gn : (ser.x + 2.0) * td * G * gn);
  }
  vec2 out2 = vec2(0.0);
  if (wTissue >= CURTAIN_MIN_AIR) {
    // la pleura del diafragma, desde el cruce exacto del espejo
    if (mirrorHit >= 0.0) tissue += vec2(pleuraEcho(r - mirrorHit, dir0, normalize(t1.xyz)), 0.0);
    float dr = uDepth / 1024.0;
    // cortina: sobre la pleura, sin el gas de su fila; bajo ella, sin el de la lámina (ΔL de la línea), con el
    // rayo único de la línea por tope (el cono de la apertura mezcla líneas con otra lámina) y ≤ la de la pleura
    float gain = pow(10.0, h2.z / 20.0);
    float tFree = min(t0.x, texture(uTrans2, vUv).x) * gain;
    float T = (curtain ? (under ? min(tFree, tD) : texture(uTrans0, vec2(vUv.x, min(r, rCap) / uDepth)).x) : t0.x) * coupling;
    tissue *= T;
    // Reverberación tras gas: A-lines a múltiplos de la profundidad del reflector.
    float gasHit = t0.y;
    if (gasHit > 0.0 && r > gasHit) {
      // Transmisión de ida y vuelta hasta el reflector: cada eco múltiple la paga k veces
      // y la cola sucia una vez. Sin este factor la TGC los amplificaba hasta el blanco.
      vec2 uvG = vec2(vUv.x, max(gasHit - dr, 0.0) / uDepth);
      float tg = texture(uTrans0, uvG).x;
      float Tg = (curtain && gasHit > D ? min(min(tg, texture(uTrans2, uvG).x) * gain, tD) : tg) * coupling;
      float a = 0.0;
      for (int k = 2; k <= 4; k++) {
        float rk = float(k) * gasHit;
        a += pow(0.5, float(k - 1)) * pow(Tg, float(k)) * exp(-0.5 * pow((r - rk) / 1.2, 2.0));
      }
      tissue += vec2(a * 0.9, 0.0);
      if (t1.w > 1.5) {
        // Sombra sucia: cola de ecos incoherentes anclada a línea y profundidad (no al tejido),
        // ~−10 dB re parénquima junto al gas y decayendo con 40 mm [EXTRAPOLACIÓN PROPIA]
        vec2 tail = scattererField(vec3(vUv.x * 190.0, r * 0.9, 0.0), 0.6, uSeed + 3.0) * 0.3 * Tg * exp(-(r - gasHit) / 40.0);
        tissue += tail;
      }
    }
    out2 = tissue * wTissue;
  }
  if (curtain) {
    // El pulmón, con peso fAir: línea pleural y réplicas (líneas A), la serie (arriba) y el deslizamiento
    float k = aLineOrder(r, D);
    air += vec2(seriesPow(G, k - 1.0) * tD * interfaceProfileEcho(IF_PLEURA_WALL, cosI, 1.0, k * D - r), 0.0);
    if (under && slidingAmplitude(r - D) * tD * coupling > PLEURA_SERIES_FLOOR) air += slidingField(pD, r - D, 0.0) * tD;
    out2 += air * (fAir * coupling);
  }
  // Campo cercano: transitorio del transductor, anclado a la sonda (línea, r), no al tejido. Desde
  // TRANSIENT_SKIP_MM (receiver.ts) su escala es ≤ ruido/10 aquí, antes de la PSF (tras C y D, ≈ ruido/7
  // con 60 mm de profundidad), y no se calcula: un campo de dispersores menos por muestra en casi toda la
  // profundidad. La acumulación del armónico (decisión 77) y la ganancia focal de la emisión (decisión 84) son del eco
  // del tejido: antes del transitorio y del ruido.
  out2 *= harmonicNearGain(r) * focalGain(r);
  if (r < TRANSIENT_SKIP_MM)
    out2 += scattererField(vec3(vUv.x * 190.0, r * 3.0, 1.0), 0.8, uSeed + 7.0) * TRANSIENT_AMPLITUDE * uTransientGain * exp(-r / TRANSIENT_DECAY_MM) * coupling;
  // Ruido del receptor: gaussiano complejo blanco añadido ANTES de la PSF (queda
  // limitado en banda por la respuesta de recepción) y antes de la detección.
  float n1 = hash12b(vUv * 977.0 + uFrame * 1.7);
  float n2 = hash12b(vUv * 613.0 + uFrame * 3.1 + 11.0);
  float rad = sqrt(-2.0 * log(max(1e-6, n1)));
  out2 += uNoise * rad * vec2(cos(6.2831853 * n2), sin(6.2831853 * n2));
  oField = out2;
}
`;

/** main de B en una mirada dirigida: solo la rama dirigida (decisión 58). */
const STEERED_RAW_MAIN_GLSL = /* glsl */ `${STEERED_FIELD_GLSL}
void main() {
  oField = steeredField();
}
`;

/** Pasada B de la mirada 0: la de antes de la composición, sin nada de la dirigida (decisión 58). */
export const FRAG_RAWFIELD = rawFieldShader('look0');
/** Pasada B de las miradas ±θ: la rama dirigida sobre el mismo preludio. */
export const FRAG_RAWFIELD_STEERED = rawFieldShader('steered');

/**
 * Pasada C: convolución axial gaussiana (pulso) sobre el campo complejo, más las réplicas de reverberación de la
 * pared (decisión 76, `clutter.ts`: `reverbGains`, `reverbGateWeight`): el mismo campo convolucionado, tomado W y 2W
 * texeles enteros más arriba (la réplica aparece más honda), solo de los ecos fuertes y con las ganancias de
 * `uReverb` por la transmisión de ida y vuelta de la línea hasta la pared (`uTrans`, una vez por orden). El pulso se
 * alarga con la profundidad (decisión 84, `axialSigmaMm`): σ = max(0,6; uSigmaTexels.x + uSigmaTexels.y·fila).
 */
export const FRAG_AXIAL = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform sampler2D uTrans; // transmisión de ida y vuelta de la mirada (A o0; o3 en las dirigidas), .x
uniform vec2 uSigmaTexels; // σ axial (texeles) en la fila 0 y su aumento por fila (bajada de la frecuencia, decisión 84)
uniform vec2 uTexel;
uniform vec4 uReverb; // desplazamiento W en texeles (entero), ganancias de las réplicas a W y a 2W, fila más honda de sus fuentes
in vec2 vUv;
out vec2 oField;
void main() {
  vec2 acc = vec2(0.0);
  vec2 acc1 = vec2(0.0);
  vec2 acc2 = vec2(0.0);
  float wsum = 0.0;
  float row = vUv.y / uTexel.y - 0.5;
  float sT = max(0.6, uSigmaTexels.x + uSigmaTexels.y * row);
  int R = int(ceil(sT * 2.5));
  // solo reverbera la pared: la fuente (W o 2W filas más arriba) no pasa de su cara interna (uReverb.w)
  bool rep1 = uReverb.y > 0.0 && uReverb.x > 0.0 && row >= uReverb.x && row - uReverb.x <= uReverb.w;
  bool rep2 = uReverb.z > 0.0 && uReverb.x > 0.0 && row >= 2.0 * uReverb.x && row - 2.0 * uReverb.x <= uReverb.w;
  vec2 d1 = vec2(0.0, uReverb.x * uTexel.y);
  // Núcleo de energía unitaria (Σw² = 1): el nivel incoherente no depende de la
  // anchura del pulso; los ecos coherentes se ensanchan y ganan con ella.
  for (int k = -12; k <= 12; k++) {
    if (k < -R || k > R) continue;
    float w = exp(-0.5 * pow(float(k) / sT, 2.0));
    vec2 uv = vUv + vec2(0.0, float(k) * uTexel.y);
    acc += w * texture(uField, uv).rg;
    // solo reverberan los ecos fuertes (caras especulares): umbral suave sobre el módulo del campo en bruto
    if (rep1) { vec2 f1 = texture(uField, uv - d1).rg; acc1 += w * f1 * smoothstep(${CLUTTER.reverbGate[0].toFixed(3)}, ${CLUTTER.reverbGate[1].toFixed(3)}, length(f1)); }
    if (rep2) { vec2 f2 = texture(uField, uv - 2.0 * d1).rg; acc2 += w * f2 * smoothstep(${CLUTTER.reverbGate[0].toFixed(3)}, ${CLUTTER.reverbGate[1].toFixed(3)}, length(f2)); }
    wsum += w * w;
  }
  // cada orden paga su viaje extra por la pared: tras una costilla o un gas no hay réplica en la sombra
  float tW = rep1 || rep2 ? texture(uTrans, vec2(vUv.x, uReverb.x * uTexel.y)).x : 0.0;
  oField = (acc + uReverb.y * tW * acc1 + uReverb.z * tW * tW * acc2) / sqrt(wsum);
}
`;

/**
 * Pasada D: convolución lateral con anchura dependiente de profundidad y foco,
 * ruido electrónico y detección de envolvente.
 */
export const FRAG_LATERAL = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform vec2 uTexel;
uniform float uDepth;
uniform float uCurvR;
uniform float uHalfSector;
uniform float uLinesF;
uniform vec2 uSidelobe; // energía del pedestal de lóbulos laterales (ISLR, lineal) y su anchura (× σ del principal); decisión 76
uniform sampler2D uCoupling; // 1D: acoplamiento por línea (una línea sin contacto no recibe lóbulos laterales)
in vec2 vUv;
out float oEnv;
${LATERAL_PSF_GLSL}
// pantalla de fase del pedestal (clutter.ts: SIDELOBE_PHASES), indexada por k + ${CLUTTER.lateralMaxLines}
${SIDELOBE_PHASE_GLSL}
void main() {
  float r = vUv.y * uDepth;
  float sigmaMm = lateralSigmaMm(r);
  float lineSpacing = (uCurvR + r) * (2.0 * uHalfSector / (uLinesF - 1.0));
  float sigmaTex = max(0.35, sigmaMm / lineSpacing);
  float sigmaPed = sigmaTex * uSidelobe.y;
  float coupling = texture(uCoupling, vec2(vUv.x, 0.5)).r;
  bool pedOn = uSidelobe.x > 0.0 && coupling > 0.0;
  int R = min(${CLUTTER.lateralMaxLines}, int(ceil(max(sigmaTex * 2.5, pedOn ? sigmaPed * 2.5 : 0.0))));
  // el principal (real) y el pedestal (con su fase) por separado: la amplitud del pedestal sale de las sumas
  // discretas (a² = ISLR·c²·Σgm²/Σgp²) y la energía del núcleo, de Σ|w|² = Σgm² + a²Σgp² + 2aΣgm·gp·cos φ
  vec2 accM = vec2(0.0);
  vec2 accP = vec2(0.0);
  float sm = 0.0;
  float sp = 0.0;
  float cx = 0.0;
  for (int k = -${CLUTTER.lateralMaxLines}; k <= ${CLUTTER.lateralMaxLines}; k++) {
    if (k < -R || k > R) continue;
    float kf = float(k);
    float gm = exp(-0.5 * pow(kf / sigmaTex, 2.0));
    float gp = pedOn ? exp(-0.5 * pow(kf / sigmaPed, 2.0)) : 0.0;
    vec2 ph = PED_PHASE[k + ${CLUTTER.lateralMaxLines}];
    vec2 f = texture(uField, vUv + vec2(kf * uTexel.x, 0.0)).rg;
    accM += gm * f;
    accP += gp * vec2(ph.x * f.x - ph.y * f.y, ph.x * f.y + ph.y * f.x);
    sm += gm * gm;
    sp += gp * gp;
    cx += gm * gp * ph.x;
  }
  float amp = pedOn ? coupling * sqrt(uSidelobe.x * sm / sp) : 0.0;
  vec2 f = (accM + amp * accP) * inversesqrt(sm + amp * amp * sp + 2.0 * amp * cx);
  // Envolvente calibrada: E|z| de una gaussiana compleja unitaria es √π/2, así
  // que ×2/√π deja mean(envolvente) = amplitud de retrodispersión.
  oEnv = length(f) * 1.1283792;
}
`;

/** Miradas del anillo: una ranura (una textura) por mirada del orden de adquisición. */
const LOOKS = COMPOUND.order.length;

/**
 * Pasada K (composición espacial, decisión 58): en cada celda, la media lineal de las envolventes válidas
 * del anillo (una mirada por cuadro, la última de cada ángulo) ponderada por su cobertura (`lookWeight`:
 * 1 la mirada 0; la rampa del borde del arreglo las dirigidas), en la misma celda y sin remuestreo. Con
 * solo la mirada 0 válida (compuesto apagado, o el cuadro tras un reinicio) da env·1/1: la envolvente de D
 * bit a bit. Gemelo: `compoundEnvelope`. La celda sale de gl_FragCoord (centro exacto del texel), como el
 * gemelo. Una textura por mirada: en GLSL ES 3.00 un array de samplers solo se indexa con constantes.
 * Bajo la pleura de la cortina (decisión 61) las dirigidas pesan además 1 − fAir de la mirada 0
 * (`curtainSteerWeight`, con la pleura de A0 y la fracción de aire de B): cada mirada reverbera a múltiplos de
 * su propio camino y la media partía cada línea A en tres arcos; los equipos no componen en pulmón.
 */
export const FRAG_COMPOUND = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${COMPOUND.order.map((_, i) => `uniform sampler2D uLook${i};`).join('\n')}
uniform float uLookSteer[${LOOKS}]; // θ de la mirada de cada ranura (rad)
uniform float uLookValid[${LOOKS}]; // 1 si la ranura tiene una mirada del anillo vigente
uniform float uCurvR;
uniform float uHalfSector;
uniform float uLinesF;
uniform float uDepth;
out float oEnv;
${STEERING_GLSL}
${COMPOUND_GLSL}${LINE_DIR_GLSL}${ELEV_SIGMA_GLSL}${LATERAL_PSF_GLSL}${CURTAIN_AIR_GLSL}
float lookEnvelope(int i, ivec2 c) {
${COMPOUND.order.map((_, i) => `  if (i == ${i}) return texelFetch(uLook${i}, c, 0).r;`).join('\n')}
  return 0.0;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float alpha = -uHalfSector + gl_FragCoord.x * (2.0 * uHalfSector / uLinesF);
  float rho = uCurvR + gl_FragCoord.y * (uDepth / float(textureSize(uLook0, 0).y));
  // bajo la pleura de la cortina (decisión 61), la mirada 0 sola: las dirigidas pesan 1 − fAir de la mirada 0
  vec4 h2 = texelFetch(uHits2, ivec2(c.x, 0), 0);
  float fAir = h2.x > 0.0 ? curtainAirFraction(h2.y, h2.x, lineDir(alpha)) : 0.0;
  float steerKeep = curtainSteerWeight(rho - uCurvR, h2.x, fAir);
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < COMPOUND_LOOKS; i++) {
    if (uLookValid[i] < 0.5) continue;
    float w = lookWeight(alpha, rho, uLookSteer[i], uCurvR, uHalfSector, uLinesF);
    if (uLookSteer[i] != 0.0) w *= steerKeep;
    if (w <= 0.0) continue;
    sum += w * lookEnvelope(i, c);
    wsum += w;
  }
  oEnv = wsum > 0.0 ? sum / wsum : 0.0;
}
`;

/**
 * Pasada F: Doppler color — emulación del estimador de autocorrelación sobre la
 * mezcla sangre/clutter/ruido en cada celda del cuadro de color.
 * Salida: (frecuencia estimada Hz plegada, potencia, fracción de sangre, 0).
 */
export const FRAG_COLOR = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
${BEAM_GLSL}
uniform sampler2D uTrans0;
uniform vec4 uBox;        // theta0, theta1, r0, r1
uniform vec2 uCells;      // líneas de color × paquetes axiales dentro de la caja
uniform vec4 uBeam;       // λ·k, D_tx, D_rx,max, F#_rx,min (mismo modelo que la PSF)
uniform float uPrf;
uniform float uF0;
uniform float uWallHz;
uniform float uColorGain;
uniform float uDopplerFreqRatio; // f Doppler / f B del perfil: la atenuación en dB escala con f
uniform float uEnsemble;
uniform vec3 uProbeVel;   // mm/s
uniform float uFrame;
in vec2 vUv;
out vec4 oColor;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wallResp(float f) {
  // Filtro de clutter de orden alto (los equipos usan filtros de regresión con >60 dB de rechazo).
  float x = f * f / (f * f + uWallHz * uWallHz);
  return x * x * x * x;
}
// Normales en los nodos de la retícula de resolución del color (una línea de color × un paquete axial), dos por nodo
vec2 colorGaussAt(vec2 q, float seed) {
  float a = hash12(q * 0.917 + vec2(seed * 1.37, seed * 0.61) + 0.5);
  float b = hash12(q * 1.713 + vec2(seed * 2.11, seed * 1.29) + 7.3);
  float rad = sqrt(-2.0 * log(max(1e-6, a)));
  return rad * vec2(cos(6.2831853 * b), sin(6.2831853 * b));
}
// Campo gaussiano correlado a la escala de la celda de resolución (decisión 70): normales en los nodos interpolados con
// suavizado y renormalizados a varianza 1. El grano del color (manchas de ~2 líneas × ~2 mm, 1,5–4 mm) sale de aquí; con
// ruido independiente por celda se veía el mosaico de la rejilla, y por téxel sería nieve de pantalla.
vec2 colorGauss(vec2 g, float seed) {
  vec2 i = floor(g);
  vec2 f = fract(g);
  vec2 w = f * f * (3.0 - 2.0 * f);
  vec2 n = mix(mix(colorGaussAt(i, seed), colorGaussAt(i + vec2(1.0, 0.0), seed), w.x),
               mix(colorGaussAt(i + vec2(0.0, 1.0), seed), colorGaussAt(i + vec2(1.0, 1.0), seed), w.x), w.y);
  vec2 v = 1.0 - w;
  return n / sqrt((v.x * v.x + w.x * w.x) * (v.y * v.y + w.y * w.y));
}
void main() {
  // Estimación continua en cada téxel (decisión 70): la resolución la ponen el volumen de muestra (las submuestras
  // lateral y elevacional) y el grano correlado del ruido y del moteado de la sangre, no una rejilla de celdas
  // constantes (antes, «floor(vUv·uCells)»: bloques de 3–4 × 2–3 téxeles que la prueba ciega reconocía).
  float theta = mix(uBox.x, uBox.y, vUv.x);
  float r = mix(uBox.z, uBox.w, vUv.y);
  // posición en la retícula de resolución (líneas de color × paquetes axiales) y semilla del cuadro de color
  vec2 grid = vUv * uCells;
  vec3 dir = lineDir(theta);
  vec3 bhat = -dir;
  vec3 p = pointOnLine(dir, r);
  // Transmisión (pasada A, a la frecuencia B) convertida a la frecuencia Doppler del perfil: la misma
  // que usa la puerta PW. Antes el exponente era 0,714 fijo (B a 3,5 MHz) con el perfil a 2,5 y 2,5.
  float u = (theta + uHalfSector) / (2.0 * uHalfSector);
  float Tb = texture(uTrans0, vec2(u, r / uDepth)).x;
  float T = pow(max(Tb, 1e-6), uDopplerFreqRatio);
  // Sin contacto no hay eco: el acoplamiento de la línea multiplica la transmisión como en modo B.
  T *= texture(uCoupling, vec2(u, 0.5)).r;
  float bf = 0.0; float vb = 0.0; float vt = 0.0;
  vec3 lat = normalize(cross(uElev, dir));
  const int NS = 5;
  vec3 offs[5];
  offs[0] = vec3(0.0); offs[1] = lat * 1.2; offs[2] = -lat * 1.2; offs[3] = uElev * 1.5; offs[4] = -uElev * 1.5;
  for (int i = 0; i < NS; i++) {
    vec3 m = toMaterial(p + offs[i]);
    Cls c = classify(m);
    vec3 vtis = tissueVelocity(m) - uProbeVel;
    vt += dot(vtis, bhat);
    if (c.tissue == T_BLOOD && c.vessel >= 0) {
      bf += 1.0;
      vb += dot(bloodVelocity(c) + vtis, bhat);
    }
  }
  vt /= float(NS);
  if (bf > 0.0) vb /= bf;
  bf /= float(NS);
  float c_mm = ${C_RECONSTRUCTION_MM_S}.0;
  float fdB = 2.0 * uF0 * vb / c_mm;
  float fdT = 2.0 * uF0 * vt / c_mm;
  // Ensanchamiento espectral de la sangre en la celda: dispersión angular de la
  // apertura (σθ = D_rx/4r, como en el PW), tiempo de tránsito y gradiente del
  // perfil de velocidades (mayor en las celdas que tocan la pared, bf < 1).
  float dRx = min(uBeam.z, r / uBeam.w);
  float apSig = dRx / (4.0 * max(10.0, r));
  float sigF = abs(fdB) * (2.0 * apSig + 0.12 + (bf < 1.0 ? 0.25 : 0.0));
  // Coherencia de la autocorrelación a un retardo: |ρ| = exp(−2(π·σf/PRF)²)
  float rho = exp(-2.0 * pow(3.14159265 * sigF / uPrf, 2.0));
  // Potencias en unidades de sangre (amplitud de sangre = 1 a transmisión 1).
  float Ac = 0.9 / 0.008; // clutter tisular ≈ +41 dB respecto a sangre
  // Moteado de la sangre (decisión 70): potencia exponencial de media 1 (dispersores de Rayleigh), correlada a la celda
  // de resolución y renovada en cada cuadro (la sangre avanza); da el relleno moteado y los huecos del color real
  vec2 sp = colorGauss(grid, uFrame + 17.0);
  float speckle = 0.5 * dot(sp, sp);
  float Pb = bf * T * T * wallResp(fdB) * speckle;
  float Pc = (1.0 - bf) * Ac * Ac * T * T * wallResp(fdT);
  float Pn = 3.2e-4; // suelo de ruido Doppler ≈ −35 dB re sangre a T=1 ([EXTRAPOLACIÓN PROPIA])
  float phB = 6.2831853 * fdB / uPrf;
  float phT = 6.2831853 * fdT / uPrf;
  vec2 R1 = Pb * rho * vec2(cos(phB), sin(phB)) + Pc * vec2(cos(phT), sin(phT));
  // Ruido del estimador: ∝ sqrt(P_total·P_n / ensemble), complejo gaussiano correlado a la celda de resolución
  float sigma = sqrt((Pb + Pc + Pn) * Pn / uEnsemble);
  R1 += sigma * colorGauss(grid, uFrame * 1.0 + 3.0);
  // Varianza de fase de Kasai con N pares: σφ² ≈ (1 − ρ²) / (2·N·ρ²), ponderada por
  // la fracción de sangre (el clutter residual es coherente). Es el moteado de
  // velocidad dentro del vaso y el mosaico en el borde del aliasing.
  float wB = Pb * rho / max(1e-9, Pb * rho + Pc);
  float sigPh = wB * sqrt((1.0 - rho * rho) / (2.0 * uEnsemble * max(1e-3, rho * rho)));
  float g = colorGauss(grid, uFrame + 29.0).x;
  float ph = atan(R1.y, R1.x) + sigPh * g;
  ph = mod(ph + 3.14159265, 6.2831853) - 3.14159265;
  float fEst = uPrf * ph / 6.2831853;
  float power = length(R1) * uColorGain;
  oColor = vec4(fEst, power, bf, 0.0);
}
`;

/**
 * Mapa de grises de la presentación (una sola fuente para la pasada G y la línea M, decisión 80): envolvente →
 * gris mostrado (0–1) a la profundidad r (mm).
 */
const DISPLAY_GREY_GLSL = /* glsl */ `
uniform float uDepth;
uniform float uGainDb;
uniform float uRefDb;
uniform float uNominalTgcDbPerCm; // compensación nominal del equipo (tejido de referencia)
uniform float uTgcCapDb;          // techo de compensación nominal + TGC
uniform float uDynRange;
uniform float uGreyCurve;
uniform float uTgc[8];
float tgcAt(float r) {
  float x = clamp(r / uDepth, 0.0, 0.9999) * 7.0;
  int i = int(floor(x));
  float f = x - float(i);
  return mix(uTgc[i], uTgc[i + 1], f);
}
float displayGrey(float env, float r) {
  // TGC nominal + TGC del usuario: amplifican ecos y ruido por igual (E.2/E.4).
  float comp = min(uTgcCapDb, tgcAt(r) + uNominalTgcDbPerCm * (r / 10.0));
  float db = 20.0 * (log(max(env, 1e-7)) / 2.302585093) + uGainDb + comp + uRefDb;
  float y = clamp((db + uDynRange) / uDynRange, 0.0, 1.0);
  // Mapa «clínico»: expansión exponencial del extremo brillante (la desviación
  // del gris crece con el nivel en imágenes reales; EchoTwin decisión 90).
  return (exp(y * log(1.0 + uGreyCurve)) - 1.0) / uGreyCurve;
}
`;

/** Pasada G: conversión de barrido + mapeo de grises + superposición de color. */
export const FRAG_SCANCONVERT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uEnv;
uniform sampler2D uColor;
uniform vec2 uCanvas;      // px
uniform vec2 uApex;        // px: centro de curvatura en pantalla
uniform float uScale;      // px por mm
uniform float uCurvR;
uniform float uHalfSector;
uniform int uColorOn;
uniform vec4 uBox;         // theta0, theta1, r0, r1
uniform float uPrf;
uniform float uColorThreshold;
uniform float uColorPriority;
uniform int uColorInvert;
in vec2 vUv;
out vec4 oColor;
${DISPLAY_GREY_GLSL}
void main() {
  vec2 px = vUv * uCanvas;
  vec2 d = (px - uApex) / uScale;  // mm, y hacia abajo
  float rho = length(d);
  float theta = -atan(d.x, d.y);   // marcador a la izquierda ↔ +θ
  float r = rho - uCurvR;
  if (r < 0.0 || r > uDepth || abs(theta) > uHalfSector) { oColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 uv = vec2((theta + uHalfSector) / (2.0 * uHalfSector), r / uDepth);
  float g = displayGrey(texture(uEnv, uv).r, r);
  vec3 col = vec3(g);
  if (uColorOn == 1 && theta >= uBox.x && theta <= uBox.y && r >= uBox.z && r <= uBox.w) {
    vec2 cuv = vec2((theta - uBox.x) / (uBox.y - uBox.x), (r - uBox.z) / (uBox.w - uBox.z));
    vec4 c = texture(uColor, cuv);
    float f = c.x;
    if (uColorInvert == 1) f = -f;
    float mag = clamp(abs(f) / (0.5 * uPrf), 0.0, 1.0);
    if (c.y > uColorThreshold && (g < uColorPriority || c.y > 3.0 * uColorThreshold)) {
      vec3 toward = mix(vec3(0.55, 0.05, 0.0), vec3(1.0, 0.95, 0.35), mag);
      vec3 away = mix(vec3(0.0, 0.1, 0.6), vec3(0.35, 0.95, 1.0), mag);
      col = f >= 0.0 ? toward : away;
    }
  }
  oColor = vec4(col, 1.0);
}
`;

/** Persistencia: mezcla con el cuadro anterior y salida a pantalla. */
export const FRAG_PERSIST = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uPersist;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec4 c = texture(uCur, vUv);
  vec4 p = texture(uPrev, vUv);
  oColor = vec4(mix(c.rgb, p.rgb, uPersist), 1.0);
}
`;

export const FRAG_BLIT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 oColor;
void main() { oColor = texture(uTex, vec2(vUv.x, 1.0 - vUv.y)); }
`;

/**
 * Línea M (decisión 80): la columna de la envolvente mostrada (la que convierte G) en la línea θ, con su mapa de
 * grises, en M_SAMPLES filas de la cara (fila 0) al fondo del sector: una columna del anillo de la franja.
 */
export const FRAG_MLINE = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uEnv;
uniform float uU; // coordenada u de la línea M (mLineU)
out vec4 oColor;
${DISPLAY_GREY_GLSL}
void main() {
  float v = gl_FragCoord.y / ${M_SAMPLES}.0;
  float g = displayGrey(texture(uEnv, vec2(uU, v)).r, v * uDepth);
  oColor = vec4(g, g, g, 1.0);
}
`;

/**
 * Franja del modo M (decisión 80) en pantalla: cada píxel toma la columna del anillo que cubre su instante (uSlots,
 * −1 sin columna: negro) y la fila de su profundidad, con la cara arriba.
 */
export const FRAG_MSTRIP = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uStrip; // anillo de columnas (ranura × fila)
uniform sampler2D uSlots; // ranura por píxel de la franja
uniform float uH;         // alto de la franja (px)
out vec4 oColor;
void main() {
  float s = texelFetch(uSlots, ivec2(gl_FragCoord.x, 0), 0).r;
  int row = min(${M_SAMPLES - 1}, int((1.0 - gl_FragCoord.y / uH) * ${M_SAMPLES}.0));
  float g = s < 0.0 ? 0.0 : texelFetch(uStrip, ivec2(int(s), row), 0).r;
  oColor = vec4(g, g, g, 1.0);
}
`;

/**
 * Pasada H (docente): mapa de tejidos del plano de imagen — clase de tejido y
 * vaso por muestra de haz, a baja resolución, para dibujar el «corte ecográfico»
 * con rótulos. Usa la MISMA clasificación que la imagen.
 */
export const FRAG_TISSUEMAP = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
${BEAM_GLSL}
in vec2 vUv;
out vec4 oMap;
void main() {
  float theta = lineTheta(vUv.x);
  vec3 dir = lineDir(theta);
  float r = vUv.y * uDepth;
  vec3 p = pointOnLine(dir, r);
  Cls c = classify(toMaterial(p));
  oMap = vec4(float(c.tissue) / 255.0, float(c.vessel + 1) / 255.0, c.bd / 50.0, 1.0);
}
`;

/**
 * Consulta puntual de la anatomía GLSL (pruebas y gate de equivalencia): cada texel de
 * `uPoints` es un punto del MUNDO; se clasifica con la misma `classify` que la imagen
 * y se devuelve tejido, índice de tubo (−1 sin vaso), distancia a la interfaz, la cara de
 * interfaz que dibuja y su distancia (`iface`, `ifd`: decisión 57), la velocidad de la sangre
 * en el marco material (la misma que usa el color) y el gradiente de la cara que usa el eco de
 * interfaz (`faceGradient`, marco material: xyz su dirección unitaria, w su norma; la e2e los
 * compara con el gradiente de `faceSdf` de TS). La tercera salida solo se lee si se pide
 * (`queryPoints(…, { normals })`).
 */
export const FRAG_QUERY = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
${BEAM_GLSL}
uniform sampler2D uPoints;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
void main() {
  vec4 p = texelFetch(uPoints, ivec2(gl_FragCoord.xy), 0);
  vec3 m = toMaterial(p.xyz);
  Cls c = classify(m);
  vec3 v = c.tissue == T_BLOOD ? bloodVelocity(c) : vec3(0.0);
  o0 = vec4(float(c.tissue), float(c.vessel), c.bd, c.ifd);
  o1 = vec4(v, float(c.iface));
  o2 = faceGradient(c, m);
}
`;

/**
 * Consulta de las tríadas portales (solo pruebas, decisión 78): el factor de `portalTriad` en puntos MATERIALES de
 * `uPoints`, con el mismo GLSL que la pasada B. La e2e lo compara punto a punto con el gemelo TS (`triadParity`): el
 * hash entero da las mismas tríadas en cualquier GPU y en TS.
 */
export const FRAG_TRIAD_QUERY = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${PORTAL_TRIADS_GLSL}
uniform sampler2D uPoints;
out vec4 o0;
void main() {
  vec3 m = texelFetch(uPoints, ivec2(gl_FragCoord.xy), 0).xyz;
  o0 = vec4(portalTriad(m), 0.0, 0.0, 1.0);
}
`;
