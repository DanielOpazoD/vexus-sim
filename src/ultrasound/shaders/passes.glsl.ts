import { TISSUE_COUNT } from '../../anatomy/tissues';
import { C_RECONSTRUCTION_MM_S } from '../../core/units';
import { ANATOMY_GLSL } from '../../anatomy/gpu/anatomy.glsl';
import { APERTURE_GLSL } from '../aperture';
import { IFACE_REACH_MM, INTERFACE_ECHO_GLSL } from '../interfaceEcho';
import { MIRROR_BISECTION_STEPS } from '../transmission';
import { SPECKLE_TISSUE_GLSL } from '../speckleField';
import { RECEIVER_GLSL } from '../receiver';

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
const BEAM_GEOMETRY_GLSL = /* glsl */ `
uniform vec3 uFace;
uniform vec3 uAxial;
uniform vec3 uLateral;
uniform vec3 uElev;
uniform vec3 uCurvC;
uniform float uCurvR;
uniform float uHalfSector;
uniform float uDepth;      // mm
uniform float uLinesF;
uniform sampler2D uCoupling; // 1D: acoplamiento por línea

float lineTheta(float u) { return -uHalfSector + 2.0 * uHalfSector * u; }
vec3 lineDir(float theta) { return normalize(uAxial * cos(theta) + uLateral * sin(theta)); }
vec3 pointOnLine(vec3 dir, float r) { return uCurvC + dir * (uCurvR + r); }
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
 * PSF lateral de dos vías por número F (`ultrasound/beamModel.ts`: misma fórmula). La comparten la
 * pasada D (su anchura) y la B (la coherencia de curvatura del eco de interfaz, decisión 57).
 */
export const LATERAL_PSF_GLSL = /* glsl */ `
uniform float uFocus;      // mm
uniform vec4 uBeam;        // λ·k (mm), D_tx (mm), D_rx,max (mm), F#_rx,min
float lateralSigmaMm(float r) {
  float rr = max(1.0, r);
  float F = max(10.0, uFocus);
  float tx = length(vec2(uBeam.x * F / uBeam.y, uBeam.y * abs(rr - F) / F));
  float dRx = min(uBeam.z, rr / uBeam.w);
  float rx = uBeam.x * rr / max(1.0, dRx);
  float fwhm = inversesqrt(1.0 / (tx * tx) + 1.0 / (rx * rx));
  return fwhm / 2.3548;
}
`;

/**
 * Pasada A en cuatro etapas (decisión 54). Antes cada celda (línea × profundidad gruesa) marchaba
 * su rayo desde la piel: O(N²), ~2,5 millones de clasificaciones por cuadro. Ahora:
 *   A0 impactos: una marcha por línea (primer pulmón con su reflexión especular —el espejo, en el cruce
 *      exacto por bisección (decisión 57)—, primer gas, primer hueso);
 *   A1 segmentos: cada segmento grueso se clasifica una vez, sobre el camino (reflejado o no) de A0;
 *   A2 suma: la atenuación ida y vuelta acumulada hasta cada profundidad, con las mismas reglas que
 *      `ultrasound/transmission.ts` (gel previo a la piel sin pérdidas, gas 60 dB/cm, hueso 6 dB al
 *      entrar + absorción, espejo 0,5 dB);
 *   A  apertura: la transmisión de ida es la media sobre el cono del haz, no la de un solo rayo: un
 *      obstáculo que tapa parte de la apertura deja penumbra y la sombra se rellena en profundidad.
 * Salida de A: 0 = (transmisión ida y vuelta con apertura, gasHit, boneHit, mirrorHit),
 * 1 = (dirección reflejada, tipo de gas: 1 pulmón, 2 intestinal), 2 = (transmisión de un solo rayo:
 * la que usan el color y el PW, que así comparten modelo; decisión 50).
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
void main() {
  vec3 dir0 = lineDir(lineTheta(vUv.x));
  float step = uDepth / uCoarseN;
  int n = int(uCoarseN);
  vec3 origin = pointOnLine(dir0, 0.0);
  vec3 dir = dir0;
  vec3 hitPoint = origin;
  float hitR = 0.0;
  float mirrorSeg = -1.0, gasSeg = -1.0, boneSeg = -1.0, gasKind = 0.0;
  bool entered = false;
  for (int s = 0; s < 512; s++) {
    if (s >= n) break;
    float r = (float(s) + 0.5) * step;
    vec3 p = mirrorSeg >= 0.0 ? hitPoint + dir * (r - hitR) : origin + dir * r;
    Cls c = classify(toMaterial(p));
    // Hueco entre la cara convexa y la piel: gel de acoplamiento (el acoplamiento va aparte).
    if (c.tissue == T_AIR && !entered) continue;
    entered = true;
    float flag = tissueFlag(c.tissue);
    if (flag > 0.5 && flag < 1.5) {
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
in vec2 vUv;
out vec4 oSeg; // (dB ida y vuelta del segmento, es aire, es hueso, 0)
void main() {
  int line = int(gl_FragCoord.x);
  int s = int(gl_FragCoord.y);
  vec4 h0 = texelFetch(uHits0, ivec2(line, 0), 0);
  vec4 h1 = texelFetch(uHits1, ivec2(line, 0), 0);
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
  oSeg = vec4(db, c.tissue == T_AIR ? 1.0 : 0.0, flag > 1.5 ? 1.0 : 0.0, 0.0);
}
`;

export const FRAG_TRANS_PREFIX = /* glsl */ `#version 300 es
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
void main() {
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
}
`;

export const FRAG_TRANSMISSION = /* glsl */ `#version 300 es
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
void main() {
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
}
`;

/**
 * Pasada B: campo complejo crudo por muestra de haz — dispersores persistentes
 * en coordenadas materiales integrados en elevación, eco de interfaz coherente en
 * el cruce exacto (decisión 57), reverberación/A-lines tras gas y cola sucia del gas
 * intestinal.
 */
export const FRAG_RAWFIELD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
${BEAM_GEOMETRY_GLSL}
${TISSUE_BACK_GLSL}
uniform sampler2D uTrans0;
uniform sampler2D uTrans1;
uniform float uSeed;
uniform float uLattice;     // paso de retícula (mm)
uniform float uElevSigma0;  // σ elevacional en el foco de la lente (mm)
uniform float uElevFocus;   // mm
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
${RECEIVER_GLSL}
in vec2 vUv;
out vec2 oField;

float elevSigma(float r) {
  float zr = 45.0;
  return uElevSigma0 * sqrt(1.0 + pow((r - uElevFocus) / zr, 2.0));
}
${LATERAL_PSF_GLSL}
${INTERFACE_ECHO_GLSL}

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

${SPECKLE_TISSUE_GLSL}

// Campo de dispersores de un punto material con clasificación conocida. Cada tejido es otra
// población: su propia semilla (el moteado no continúa a través de un borde).
vec2 fieldFor(vec3 m, float se, int tissue) {
  vec2 f = speckleField(m, uLattice, se, float(tissue) * TISSUE_SALT_STEP);
  // Heterogeneidad lenta y continua del parénquima (desviación 1,15 dB a ~1,6 ciclos/cm) [EXTRAPOLACIÓN PROPIA]
  float het = 1.0;
  if (tissue == T_LIVER || tissue == T_MUSCLE || tissue == T_BOWEL || tissue == T_RENAL_CORTEX) het = hetGain(m);
  return f * tissueBack(tissue) * het;
}

// Plano lateral en elevación: si el plano central está lejos de toda interfaz
// (bd > desplazamiento), el tejido es el mismo y se ahorra la clasificación.
vec2 sampleSide(vec3 p, float se, Cls center) {
  vec3 m = toMaterial(p);
  if (center.bd > se + 0.5) return fieldFor(m, se, center.tissue);
  Cls c = classify(m);
  return fieldFor(m, se, c.tissue);
}

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
  float se = elevSigma(r);
  vec3 m0 = toMaterial(p);
  Cls c0 = classify(m0);
  // Tres planos en elevación: la amplitud incoherente se promedia (¼ ½ ¼); el
  // fasor viene del plano central con la célula elevacional ya anclada al corte.
  vec2 f0 = fieldFor(m0, se, c0.tissue);
  vec2 f1 = sampleSide(p + uElev * se, se, c0);
  vec2 f2 = sampleSide(p - uElev * se, se, c0);
  float sideMag = 0.5 * length(f0) + 0.25 * (length(f1) + length(f2));
  vec2 field = length(f0) > 1e-6 ? f0 * (sideMag / length(f0)) : f0;
  // Grumos (decisión 56): un factor por píxel, del tejido del plano central, sobre la coordenada
  // anclada con la célula elevacional del grosor de corte, para los tres planos a la vez (la potencia
  // media se conserva y el grano no parpadea al inclinar)
  float clump = uTissueClump4[c0.tissue / 4][c0.tissue % 4];
  if (clump > 0.0) field *= anchoredClump(m0, se, clump, float(c0.tissue) * TISSUE_SALT_STEP);
  // Eco de interfaz (decisión 57): coherente, con fase 0 común a la cara, antes de la transmisión; la
  // pleura, desde el cruce exacto del espejo
  field += vec2(interfaceEcho(c0, m0, dir, r, se), 0.0);
  if (mirrorHit >= 0.0) field += vec2(pleuraEcho(r - mirrorHit, dir0, normalize(t1.xyz)), 0.0);
  float dr = uDepth / 1024.0;
  float T = t0.x * coupling;
  vec2 out2 = field * T;
  // Reverberación tras gas: A-lines a múltiplos de la profundidad del reflector.
  float gasHit = t0.y;
  if (gasHit > 0.0 && r > gasHit) {
    // Transmisión de ida y vuelta hasta el reflector: cada eco múltiple la paga k veces
    // y la cola sucia una vez. Sin este factor la TGC los amplificaba hasta el blanco.
    float Tg = texture(uTrans0, vec2(vUv.x, max(gasHit - dr, 0.0) / uDepth)).x * coupling;
    float a = 0.0;
    for (int k = 2; k <= 4; k++) {
      float rk = float(k) * gasHit;
      a += pow(0.5, float(k - 1)) * pow(Tg, float(k)) * exp(-0.5 * pow((r - rk) / 1.2, 2.0));
    }
    out2 += vec2(a * 0.9, 0.0);
    if (t1.w > 1.5) {
      // Sombra sucia: cola de ecos incoherentes anclada a línea y profundidad (no al tejido),
      // ~−10 dB re parénquima junto al gas y decayendo con 40 mm [EXTRAPOLACIÓN PROPIA]
      vec2 tail = scattererField(vec3(vUv.x * 190.0, r * 0.9, 0.0), 0.6, uSeed + 3.0) * 0.3 * Tg * exp(-(r - gasHit) / 40.0);
      out2 += tail;
    }
  }
  // Campo cercano: transitorio del transductor, anclado a la sonda (línea, r), no al tejido. Desde
  // TRANSIENT_SKIP_MM (receiver.ts) vale ≤ ruido/10 y no se calcula: un campo de dispersores menos por
  // muestra en casi toda la profundidad.
  if (r < TRANSIENT_SKIP_MM)
    out2 += scattererField(vec3(vUv.x * 190.0, r * 3.0, 1.0), 0.8, uSeed + 7.0) * TRANSIENT_AMPLITUDE * exp(-r / TRANSIENT_DECAY_MM) * coupling;
  // Ruido del receptor: gaussiano complejo blanco añadido ANTES de la PSF (queda
  // limitado en banda por la respuesta de recepción) y antes de la detección.
  float n1 = hash12b(vUv * 977.0 + uFrame * 1.7);
  float n2 = hash12b(vUv * 613.0 + uFrame * 3.1 + 11.0);
  float rad = sqrt(-2.0 * log(max(1e-6, n1)));
  out2 += uNoise * rad * vec2(cos(6.2831853 * n2), sin(6.2831853 * n2));
  oField = out2;
}
`;

/** Pasada C: convolución axial gaussiana (pulso) sobre el campo complejo. */
export const FRAG_AXIAL = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform float uSigmaTexels;
uniform vec2 uTexel;
in vec2 vUv;
out vec2 oField;
void main() {
  vec2 acc = vec2(0.0);
  float wsum = 0.0;
  int R = int(ceil(uSigmaTexels * 2.5));
  // Núcleo de energía unitaria (Σw² = 1): el nivel incoherente no depende de la
  // anchura del pulso; los ecos coherentes se ensanchan y ganan con ella.
  for (int k = -12; k <= 12; k++) {
    if (k < -R || k > R) continue;
    float w = exp(-0.5 * pow(float(k) / uSigmaTexels, 2.0));
    acc += w * texture(uField, vUv + vec2(0.0, float(k) * uTexel.y)).rg;
    wsum += w * w;
  }
  oField = acc / sqrt(wsum);
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
in vec2 vUv;
out float oEnv;
${LATERAL_PSF_GLSL}
void main() {
  float r = vUv.y * uDepth;
  float sigmaMm = lateralSigmaMm(r);
  float lineSpacing = (uCurvR + r) * (2.0 * uHalfSector / (uLinesF - 1.0));
  float sigmaTex = max(0.35, sigmaMm / lineSpacing);
  vec2 acc = vec2(0.0);
  float wsum = 0.0;
  int R = int(ceil(sigmaTex * 2.5));
  for (int k = -14; k <= 14; k++) {
    if (k < -R || k > R) continue;
    float w = exp(-0.5 * pow(float(k) / sigmaTex, 2.0));
    acc += w * texture(uField, vUv + vec2(float(k) * uTexel.x, 0.0)).rg;
    wsum += w * w;
  }
  vec2 f = acc / sqrt(wsum);
  // Envolvente calibrada: E|z| de una gaussiana compleja unitaria es √π/2, así
  // que ×2/√π deja mean(envolvente) = amplitud de retrodispersión.
  oEnv = length(f) * 1.1283792;
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
void main() {
  // El estimador trabaja por celda (una línea de color × un paquete axial), no por
  // píxel: de ahí el mosaico grueso del color real. La conversión de barrido interpola.
  vec2 cell = (floor(vUv * uCells) + 0.5) / uCells;
  float theta = mix(uBox.x, uBox.y, cell.x);
  float r = mix(uBox.z, uBox.w, cell.y);
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
  float Pb = bf * T * T * wallResp(fdB);
  float Pc = (1.0 - bf) * Ac * Ac * T * T * wallResp(fdT);
  float Pn = 3.2e-4; // suelo de ruido Doppler ≈ −35 dB re sangre a T=1 ([EXTRAPOLACIÓN PROPIA])
  float phB = 6.2831853 * fdB / uPrf;
  float phT = 6.2831853 * fdT / uPrf;
  vec2 R1 = Pb * rho * vec2(cos(phB), sin(phB)) + Pc * vec2(cos(phT), sin(phT));
  // Ruido del estimador: ∝ sqrt(P_total·P_n / ensemble)
  float n1 = hash12(cell * 811.0 + uFrame * 2.3);
  float n2 = hash12(cell * 457.0 + uFrame * 5.9 + 3.0);
  float rad = sqrt(-2.0 * log(max(1e-6, n1)));
  float sigma = sqrt((Pb + Pc + Pn) * Pn / uEnsemble);
  R1 += sigma * rad * vec2(cos(6.2831853 * n2), sin(6.2831853 * n2));
  // Varianza de fase de Kasai con N pares: σφ² ≈ (1 − ρ²) / (2·N·ρ²), ponderada por
  // la fracción de sangre (el clutter residual es coherente). Es el moteado de
  // velocidad dentro del vaso y el mosaico en el borde del aliasing.
  float wB = Pb * rho / max(1e-9, Pb * rho + Pc);
  float sigPh = wB * sqrt((1.0 - rho * rho) / (2.0 * uEnsemble * max(1e-3, rho * rho)));
  float n3 = hash12(cell * 613.0 + uFrame * 3.7 + 7.0);
  float n4 = hash12(cell * 271.0 + uFrame * 1.9 + 11.0);
  float g = sqrt(-2.0 * log(max(1e-6, n3))) * cos(6.2831853 * n4);
  float ph = atan(R1.y, R1.x) + sigPh * g;
  ph = mod(ph + 3.14159265, 6.2831853) - 3.14159265;
  float fEst = uPrf * ph / 6.2831853;
  float power = length(R1) * uColorGain;
  oColor = vec4(fEst, power, bf, 0.0);
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
uniform float uDepth;
uniform float uGainDb;
uniform float uRefDb;
uniform float uNominalTgcDbPerCm; // compensación nominal del equipo (tejido de referencia)
uniform float uTgcCapDb;          // techo de compensación nominal + TGC
uniform float uDynRange;
uniform float uGreyCurve;
uniform float uTgc[8];
uniform int uColorOn;
uniform vec4 uBox;         // theta0, theta1, r0, r1
uniform float uPrf;
uniform float uColorThreshold;
uniform float uColorPriority;
uniform int uColorInvert;
in vec2 vUv;
out vec4 oColor;
float tgcAt(float r) {
  float x = clamp(r / uDepth, 0.0, 0.9999) * 7.0;
  int i = int(floor(x));
  float f = x - float(i);
  return mix(uTgc[i], uTgc[i + 1], f);
}
void main() {
  vec2 px = vUv * uCanvas;
  vec2 d = (px - uApex) / uScale;  // mm, y hacia abajo
  float rho = length(d);
  float theta = -atan(d.x, d.y);   // marcador a la izquierda ↔ +θ
  float r = rho - uCurvR;
  if (r < 0.0 || r > uDepth || abs(theta) > uHalfSector) { oColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 uv = vec2((theta + uHalfSector) / (2.0 * uHalfSector), r / uDepth);
  float env = texture(uEnv, uv).r;
  // TGC nominal + TGC del usuario: amplifican ecos y ruido por igual (E.2/E.4).
  float comp = min(uTgcCapDb, tgcAt(r) + uNominalTgcDbPerCm * (r / 10.0));
  float db = 20.0 * (log(max(env, 1e-7)) / 2.302585093) + uGainDb + comp + uRefDb;
  float y = clamp((db + uDynRange) / uDynRange, 0.0, 1.0);
  // Mapa «clínico»: expansión exponencial del extremo brillante (la desviación
  // del gris crece con el nivel en imágenes reales; EchoTwin decisión 90).
  float g = (exp(y * log(1.0 + uGreyCurve)) - 1.0) / uGreyCurve;
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
