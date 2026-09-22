import { C_RECONSTRUCTION_MM_S } from '../../core/units';
import { ANATOMY_GLSL } from './anatomy.glsl';

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
const BEAM_GLSL = /* glsl */ `
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
uniform float uTissueAlpha[23]; // dB/cm a la frecuencia B
uniform float uTissueBack[23];  // amplitud de retrodispersión
uniform float uTissueFlag[23];  // 1 gas, 2 hueso

float lineTheta(float u) { return -uHalfSector + 2.0 * uHalfSector * u; }
vec3 lineDir(float theta) { return normalize(uAxial * cos(theta) + uLateral * sin(theta)); }
vec3 pointOnLine(vec3 dir, float r) { return uCurvC + dir * (uCurvR + r); }
`;

/**
 * Pasada A: transmisión (marcha por rayos) — atenuación acumulada por tejido,
 * primer gas, primer hueso y reflexión especular en la interfaz
 * diafragma–pulmón (el rayo se refleja y sigue: artefacto en espejo real).
 * Salida 0: (transmisión de amplitud ida y vuelta, gasHit, boneHit, mirrorHit)
 * Salida 1: (dirección reflejada.xyz, tipo de gas: 1 pulmón, 2 intestinal)
 */
export const FRAG_TRANSMISSION = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
${BEAM_GLSL}
uniform float uCoarseN;
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  float theta = lineTheta(vUv.x);
  vec3 dir0 = lineDir(theta);
  float rEnd = vUv.y * uDepth;
  float step = uDepth / uCoarseN;
  int n = int(ceil(rEnd / step));
  float attenDb = 0.0;
  float gasHit = -1.0, boneHit = -1.0, mirrorHit = -1.0, gasKind = 0.0;
  vec3 dir = dir0;
  vec3 origin = pointOnLine(dir0, 0.0);
  vec3 hitPoint = origin;
  float hitR = 0.0;
  bool boneEntered = false;
  bool entered = false;
  for (int s = 0; s < 512; s++) {
    if (s >= n) break;
    float r = (float(s) + 0.5) * step;
    vec3 p = mirrorHit >= 0.0 ? hitPoint + dir * (r - hitR) : origin + dir * r;
    vec3 m = toMaterial(p);
    Cls c = classify(m);
    // Hueco entre la cara convexa y la piel: gel de acoplamiento, sin pérdidas
    // ni ecos (el acoplamiento por línea se modela aparte).
    if (c.tissue == T_AIR && !entered) continue;
    entered = true;
    float flag = uTissueFlag[c.tissue];
    if (flag > 0.5 && flag < 1.5) {
      if (c.tissue == T_LUNG && mirrorHit < 0.0) {
        mirrorHit = r; hitR = r; hitPoint = p;
        vec3 nn = c.n;
        if (dot(nn, dir) > 0.0) nn = -nn;
        dir = reflect(dir, nn);
        attenDb += 0.5;
        if (gasHit < 0.0) { gasHit = r; gasKind = 1.0; }
        continue;
      }
      if (gasHit < 0.0) { gasHit = r; gasKind = 2.0; }
      attenDb += 60.0 * step / 10.0; // gas intestinal: pérdida masiva y progresiva
      continue;
    }
    if (flag > 1.5) {
      if (boneHit < 0.0) boneHit = r;
      if (!boneEntered) { attenDb += 6.0; boneEntered = true; }
    }
    attenDb += 2.0 * uTissueAlpha[c.tissue] * (step / 10.0);
  }
  float transmission = pow(10.0, -attenDb / 20.0);
  o0 = vec4(transmission, gasHit, boneHit, mirrorHit);
  o1 = vec4(dir, gasKind);
}
`;

/**
 * Pasada B: campo complejo crudo por muestra de haz — dispersores persistentes
 * en coordenadas materiales integrados en elevación, término especular de las
 * interfaces, reverberación/A-lines tras gas y cola sucia del gas intestinal.
 */
export const FRAG_RAWFIELD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${ANATOMY_GLSL}
${BEAM_GLSL}
uniform sampler2D uTrans0;
uniform sampler2D uTrans1;
uniform float uSeed;
uniform float uLattice;     // paso de retícula (mm)
uniform float uElevSigma0;  // σ elevacional en el foco de la lente (mm)
uniform float uElevFocus;   // mm
uniform float uSpecGain;
uniform float uNoise;
uniform float uFrame;
in vec2 vUv;
out vec2 oField;

float elevSigma(float r) {
  float zr = 45.0;
  return uElevSigma0 * sqrt(1.0 + pow((r - uElevFocus) / zr, 2.0));
}

float hash12b(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// Campo de dispersores con la célula ELEVACIONAL igual al grosor de corte: la
// coordenada material a lo largo de la normal del plano se comprime para que la
// textura se decorrele al inclinar la sonda un grosor de corte, no una célula
// de 0,4 mm (idea de EchoTwin, decisión 99; Chen/Fowlkes/Carson/Rubin 1997).
vec2 scattererFieldSlice(vec3 m, float h, float sliceHalfMm, float salt) {
  float across = dot(m, uElev);
  vec3 q = m - uElev * across + uElev * (across * (h / max(h, 2.0 * sliceHalfMm)));
  return scattererField(q, h, salt);
}

// Campo de dispersores de un punto material con clasificación conocida
vec2 fieldFor(vec3 m, float se, int tissue) {
  vec2 f = scattererFieldSlice(m, uLattice, se, uSeed);
  // Heterogeneidad lenta del parénquima (±4 dB p-p a ~1,6 ciclos/cm) [EXTRAPOLACIÓN PROPIA]
  float het = 1.0;
  if (tissue == T_LIVER || tissue == T_MUSCLE || tissue == T_BOWEL || tissue == T_RENAL_CORTEX) {
    float hv = hash13(floor(m / 6.25) + vec3(uSeed + 11.0));
    het = pow(10.0, (hv - 0.5) * 4.0 / 20.0);
  }
  return f * uTissueBack[tissue] * het;
}

vec2 sampleTissue(vec3 p, float se, out Cls c) {
  vec3 m = toMaterial(p);
  c = classify(m);
  return fieldFor(m, se, c.tissue);
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
  vec4 t0 = texture(uTrans0, vUv);
  vec4 t1 = texture(uTrans1, vUv);
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
  Cls c0;
  // Tres planos en elevación: la amplitud incoherente se promedia (¼ ½ ¼); el
  // fasor viene del plano central con la célula elevacional ya anclada al corte.
  vec2 f0 = sampleTissue(p, se, c0);
  vec2 f1 = sampleSide(p + uElev * se, se, c0);
  vec2 f2 = sampleSide(p - uElev * se, se, c0);
  float sideMag = 0.5 * length(f0) + 0.25 * (length(f1) + length(f2));
  vec2 field = length(f0) > 1e-6 ? f0 * (sideMag / length(f0)) : f0;
  // Término especular: (n·d)⁴, confinado a la muestra que atraviesa la interfaz
  // (ventana |n·d|·dr con mínimo 0,15·dr) y SIN fasor: coherente.
  float dr = uDepth / 1024.0;
  float cosI = abs(dot(normalize(c0.n), dir));
  float win = max(cosI, 0.15) * dr;
  float spec = c0.spec * uSpecGain * pow(cosI, 4.0) * (c0.bd < win ? 1.0 : 0.0) * 0.5;
  field += vec2(spec, 0.0);
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
  // Campo cercano: transitorio del transductor, anclado a la sonda (línea, r), no al tejido.
  out2 += scattererField(vec3(vUv.x * 190.0, r * 3.0, 1.0), 0.8, uSeed + 7.0) * 0.35 * exp(-r / 4.0) * coupling;
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
uniform float uFocus;      // mm
uniform vec4 uBeam;        // λ·k (mm), D_tx (mm), D_rx,max (mm), F#_rx,min
in vec2 vUv;
out float oEnv;
// PSF lateral de dos vías por número F (ultrasound/beamModel.ts: misma fórmula)
float lateralSigmaMm(float r) {
  float rr = max(1.0, r);
  float F = max(10.0, uFocus);
  float tx = length(vec2(uBeam.x * F / uBeam.y, uBeam.y * abs(rr - F) / F));
  float dRx = min(uBeam.z, rr / uBeam.w);
  float rx = uBeam.x * rr / max(1.0, dRx);
  float fwhm = inversesqrt(1.0 / (tx * tx) + 1.0 / (rx * rx));
  return fwhm / 2.3548;
}
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
uniform float uPrf;
uniform float uF0;
uniform float uWallHz;
uniform float uColorGain;
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
  float theta = mix(uBox.x, uBox.y, vUv.x);
  float r = mix(uBox.z, uBox.w, vUv.y);
  vec3 dir = lineDir(theta);
  vec3 bhat = -dir;
  vec3 p = pointOnLine(dir, r);
  // Transmisión (pasada A, a la frecuencia B) convertida a la frecuencia Doppler.
  float u = (theta + uHalfSector) / (2.0 * uHalfSector);
  float Tb = texture(uTrans0, vec2(u, r / uDepth)).x;
  float T = pow(max(Tb, 1e-6), 0.714);
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
  // Potencias en unidades de sangre (amplitud de sangre = 1 a transmisión 1).
  float Ac = 0.9 / 0.008; // clutter tisular ≈ +41 dB respecto a sangre
  float Pb = bf * T * T * wallResp(fdB);
  float Pc = (1.0 - bf) * Ac * Ac * T * T * wallResp(fdT);
  float Pn = 3.2e-4; // suelo de ruido Doppler ≈ −35 dB re sangre a T=1 ([EXTRAPOLACIÓN PROPIA])
  float phB = 6.2831853 * fdB / uPrf;
  float phT = 6.2831853 * fdT / uPrf;
  vec2 R1 = Pb * vec2(cos(phB), sin(phB)) + Pc * vec2(cos(phT), sin(phT));
  // Ruido del estimador: ∝ sqrt(P_total·P_n / ensemble)
  float n1 = hash12(vUv * 811.0 + uFrame * 2.3);
  float n2 = hash12(vUv * 457.0 + uFrame * 5.9 + 3.0);
  float rad = sqrt(-2.0 * log(max(1e-6, n1)));
  float sigma = sqrt((Pb + Pc + Pn) * Pn / uEnsemble);
  R1 += sigma * rad * vec2(cos(6.2831853 * n2), sin(6.2831853 * n2));
  float fEst = uPrf * atan(R1.y, R1.x) / 6.2831853;
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
