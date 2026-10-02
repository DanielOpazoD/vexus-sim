import { IDENTITY_WARP, warpNormal, type Warp } from '../anatomy/compression';
import { INTERFACES, INTERFACE_COUNT, Interface, interfaceReflectivity } from '../anatomy/interfaces';
import { quadratusSdf, retroFatSdf } from '../anatomy/organs/retroperitoneum';
import { sdDiaphragm, type Diaphragm, type Torso } from '../anatomy/primitives';
import { DIAPHRAGM_THICKNESS_MM, TISSUES, Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { valueNoise } from './speckleField';

/**
 * Eco de interfaz (decisión 57): la reflexión determinista de una cara lisa, sumada en la pasada B de
 * forma COHERENTE, con fase 0 común a toda la cara, al fasor aleatorio del moteado y antes de la
 * transmisión (la envolvente resultante es de Rice). Las pasadas C (pulso) y D (PSF lateral coherente)
 * no cambian. Para una muestra dueña de la cara i, con θ el ángulo entre la normal de la cara y el rayo
 * (el reflejado tras el espejo):
 *
 *   a(r) = A_i · Λ(θ; s_i) · χ(θ; σz,i) · C · g(δ')
 *   A_i  = β · 10^(K/20) · R_ef,i · s_ref/s_i        R_ef = max(|R_Fresnel|, suelo)   (anatomy/interfaces.ts)
 *   Λ    = sec²θ · exp(−tan²θ / (4 s²))               lóbulo de Kirchhoff (óptica geométrica) en amplitud;
 *                                                     con s_ref/s conserva la energía y Λ(0; s_ref) = 1
 *   χ    = exp(−2 (k0 σz cosθ)²)                      rugosidad fina (Ament)
 *   C    = [(1 + (2k0σl²κl)²)(1 + (2k0σe²κe)²)]^(−1/4) coherencia de curvatura de un haz gaussiano (tubos y,
 *                                                     desde la decisión 62, costillas: `hasCurvatureCoherence`)
 *   g    = N(δ'; 0, σh), δ' = ifd/(|∇|·cosθ) − (dos lados ? 0 : 2,5σh), |δ'| ≤ 3,5σh
 *
 * Escala: con S = 1 el pico de la envolvente iguala la envolvente RMS del hígado. K es el de un plano
 * liso frente al moteado del hígado: 56,5 dB (Madsen, Insana y Zagzebski 1984; Chen, Phillips y Parker
 * 1997) menos 1,5 dB de aberración de la pared (K₀ = 55 dB, calibrable en la GPU dentro de [53; 57]).
 * β pasa de S al campo de la pasada B: lo mide el gemelo B→C→D (`interfaceTwin.test.ts`) con una cara en
 * arco a 80 mm y 180 mm de profundidad; si cambian C, D o la retícula del moteado, se re-deriva.
 *
 * g es un perfil de integral unidad en el cruce exacto (δ = ifd/(|∇|·cosθ)), muestreado como el moteado:
 * tras C, eco y moteado escalan los dos con 1/√dr y su cociente no depende de la profundidad
 * seleccionada. `ifd` es el valor de la distancia de la cara y |∇| la norma de su gradiente
 * (`faceGradient`): a lo largo del rayo dδ/dr = 1 aunque la distancia no sea euclídea. Sin |∇| el perfil
 * integraba 1/|∇|: la pared AP de la VCI (|∇| = 1/apScale) perdía 2,1 dB a apScale 0,777 y 6 dB a 0,5,
 * y se apagaba al colapsar la VCI. Sin factor de profundidad: la ganancia coherente natural de D sigue
 * a la de un plano con haces gaussianos coherentes (±1,2 dB entre 40 y 120 mm).
 *
 * Gemelos: `interfaceEchoField` (TS, pruebas y gemelo) e `INTERFACE_ECHO_GLSL` (pasada B), misma fórmula
 * y los mismos uniforms (`interfaceUniforms`).
 *
 * Decisión 65 (modulación de R_ef a lo largo de las caras, modelo de dos escalas). Λ(θ; s) es la MEDIA del
 * conjunto de facetas de pendiente rms s; una cara real es una realización: a la escala del haz (1–3 mm) su
 * normal local se inclina, y cada tramo devuelve el eco especular de SU faceta. Las caras que salen de
 * `classify` (no las dos pleuras, que dibuja la pasada B desde el espejo y la cortina) dibujan así:
 *
 *   especular  a_s = A_i·(s/s_f)·Λ'(θ_f; s_f)·χ(0)·C·g(δ)   con s_f² = s² − σ_t²
 *   difusa     a_d = κ_d·R_ef·√(1 − χ(0)²)·cosθ·g(δ)/g(0) · ξ
 *
 *  - θ_f es el ángulo entre el rayo y la normal de la faceta, n + τ⊥, con τ un campo de inclinación liso anclado
 *    al material (tres ruidos de valor de célula `FACET.cellMm`, σ_t por componente tangente): en media sobre τ la
 *    potencia de cada muestra es la del lóbulo del conjunto (Λ²(θ; s), ±0,6 dB hasta 30°), así que K y las R_ef
 *    calibradas no cambian en media; lo que cambia es que la línea se fragmenta y arrosaria, más cuanto más oblicua (en
 *    el flanco del lóbulo, el eco depende de τ exponencialmente). La especular tiene fase 0 en toda la cara, así que
 *    las pasadas C y D suman las facetas vecinas en amplitud: donde la PSF lateral abarca facetas distintas la imagen
 *    sigue su amplitud media, que a 10–20° queda bajo el lóbulo del conjunto (hasta −1,6 dB en la VCI y −3,8 en la VSH
 *    si la PSF las promediara del todo; con la PSF de 1,4–2 mm frente a la célula de 3 mm, menos);
 *  - χ(0): las facetas que devuelven el eco al transductor le dan la cara de frente (incidencia local ≈ 0), así que
 *    la coherencia de la rugosidad fina es la de incidencia normal (término cuasi especular del modelo de dos
 *    escalas: Valenzuela 1978; Leader 1978). Con χ(θ), la de antes, una cara rugosa (las fascias, σz 0,075 mm)
 *    ganaba hasta +8 dB a 40° y seguía brillando oblicua;
 *  - la componente difusa es la potencia que la rugosidad fina saca de la parte coherente (1 − χ(0)²), repartida
 *    como una capa con la ley de Lambert (amplitud ∝ cosθ), incoherente con la especular: granulosa (ξ es el fasor
 *    unidad del moteado de la muestra, anclado y con la fase de la mirada, así que refuerza el grano del propio tejido
 *    en lugar de sumar uno independiente: hasta +2,8 dB de potencia cuando iguala al moteado) y casi independiente del
 *    ángulo. De frente, por muestra, queda 21–32 dB bajo la especular en las caras lisas (vasos, vesícula, cápsula
 *    hepática, cortical), 11 dB en la cápsula renal y Morison (σz 0,06) y es comparable en las fascias y el peritoneo,
 *    cuya rugosidad deja ~1 % de energía coherente. κ_d no sale de la
 *    conservación de la energía (la parte que vuelve a la apertura depende de ella y de la PSF): se calibra
 *    [ESTIMADO] con las líneas de la pared (W7 y W4 de la decisión 62) y el contraste de Morison a 40–60°.
 */

/** Anchura del perfil de la cara (mm): ≥ 0,6·dr hasta 240 mm, así su integral muestreada es 1 a < 1 %. */
export const IFACE_SIGMA_H_MM = 0.14;
/** Desplazamiento del perfil de una cara de un solo lado, dentro de su dueño (mm). */
export const IFACE_SHIFT_MM = 2.5 * IFACE_SIGMA_H_MM;
/** Alcance del perfil a cada lado de su centro (mm): pérdida en el borde −39 dB. */
export const IFACE_REACH_MM = 3.5 * IFACE_SIGMA_H_MM;
/** Pendiente rms de referencia: Λ(0; s_ref) = 1 (la de la VSH, cuyo nivel no cambia con el lóbulo). */
export const IFACE_SLOPE_REF = 0.14;
/** K (dB): cara Γ = 1, s = s_ref, plana y normal, sobre la envolvente RMS del hígado. */
export const IFACE_K_DB = 55;
/** Rango de calibración de K en la GPU (dB): fuera de él es un error de modelo, no de calibración. */
export const IFACE_K_RANGE_DB = [53, 57] as const;
/** Campo de la pasada B por unidad de S (β, campo·mm): gemelo, 180 mm de profundidad, cara a 80 mm. */
export const IFACE_BETA = 0.2903;
/** Por debajo de este |cosθ| la cara no devuelve nada (rasante). */
export const IFACE_MIN_COS = 0.05;
/**
 * Cota de la norma del gradiente de las caras que no son tubos (cápsula, riñón, diafragma, vesícula) para
 * la salida barata de la pasada B, que descarta ifd > alcance·cota antes de calcular el gradiente. Es
 * exacta si toda muestra descartada tiene ifd/|∇| > alcance (`faceGradient.test.ts` lo comprueba a ≤ 3 mm
 * de cada cara): el riñón y la grasa descartados tienen |∇| ≤ 1,02 y la vesícula, hasta 2 con ifd/|∇|
 * lejos del alcance; la cápsula (0,8 mm) y la mitad hepática del diafragma (1,25 mm) no llegan a la cota
 * (1,26 mm en una cara de un lado). Más hondo, la estimación de primer orden no vale (|∇| ~50 en el centro
 * de la vesícula) y es la salida barata la que evita un eco allí. Los tubos usan su |∇| exacta.
 */
export const IFACE_GRADIENT_MAX = 1.5;

/**
 * Facetas de las caras (decisión 65). La inclinación rms de la normal local por componente tangente (en pendiente)
 * es σ_t = max(`tiltMin`, `tiltRatio`·s): unos grados en las caras lisas (tan 5° en la VSH, la VCI y la cortical; 5,7°
 * en las cápsulas) y la mitad de su pendiente en las anchas (8,5° en las fascias, 11° en el peritoneo, cuya s ya decía
 * que los lóbulos de la grasa preperitoneal lo ondulan), así que la faceta conserva s_f = 0,87·s (0,78·s en la VSH y
 * 0,81·s en la cortical, las más lisas; s > tan 5° es necesaria) y todas las caras se arrosarian parecido de frente
 * [EXTRAPOLACIÓN PROPIA; con 0,4–0,6 el banco con GPU (antes de la decisión 84) casi no cambiaba: la VCI del sano a
 * 0–20° daba 1,26–1,29 en la subxifoidea]; `cellMm`: célula del ruido de valor que la da, con correlación
 * 0,67 a media célula y 0,18 a una (1,5 y 3 mm), del orden del haz lateral (FWHM 1,4–2 mm) [EXTRAPOLACIÓN PROPIA];
 * sales fijas (la anatomía del paciente no depende de la semilla del moteado), independientes entre las tres
 * componentes (correlación 0,001 con 19,19 de separación) y entre caras.
 */
export const FACET = {
  tiltMin: Math.tan((5 * Math.PI) / 180),
  tiltRatio: 0.5,
  cellMm: 3,
  salt: 23.7,
  componentSaltStep: 19.19,
  faceSaltStep: 3.71,
  /**
   * Componente difusa: amplitud de la capa incoherente por unidad de R_ef·√(1 − χ(0)²), en la escala del moteado de
   * la pasada B (el hígado, retrodispersión 1) [ESTIMADO: se calibra con el contraste de Morison a 40–60° de las
   * referencias, 0,53–0,82 del de 0–20°, docs/fidelity/README.md].
   */
  diffuse: 24,
};
/**
 * La cara del peritoneo parietal (la cara interna de la pared, `Interface.Peritoneum`) con grasa al otro lado
 * (`fatAcrossWall`: en la pared posterolateral de la ventana renal): allí no hay peritoneo, la grasa extraperitoneal de
 * la pared se continúa con la retroperitoneal o la perirrenal (grasa con grasa) y queda solo una fascia (la renal
 * posterior o la transversalis, suelo de colágeno en grasa ~0,03, como las de la pared) [ESTIMADO]: su R_ef baja de
 * 0,132 (Fresnel grasa/hígado) a 0,03, en la especular y en la difusa (decisión 65). Contra el hígado (su área
 * desnuda), el diafragma o un músculo el salto de impedancia sigue ahí, haya peritoneo o no, y la cara no cambia.
 */
export const RETRO_PERITONEUM_GAIN = 0.03 / interfaceReflectivity(Interface.Peritoneum);
/**
 * Margen (mm) desde la muestra de la cara (a ≤ 0,84 mm de ella, `IFACE_SHIFT_MM` + `IFACE_REACH_MM`) en el que un
 * órgano del otro lado toca la cara interna de la pared (`fatAcrossWall`) [ESTIMADO: con 1–2,5 mm el recuento de las
 * vistas de partida no cambia].
 */
export const WALL_ACROSS_MM = 1.5;
/** Lo que `fatAcrossWall` lee de la escena (la de `AnatomyScene`). */
export interface WallAcrossScene {
  liverSdf(m: Vec3): number;
  readonly diaphragm: Diaphragm;
  readonly torso: Torso;
}
/**
 * ¿Grasa al otro lado de la cara interna de la pared en la muestra m? Dentro del compartimento retroperitoneal
 * (decisión 81, `retroFatSdf` < 0) y sin hígado, cúpula (diafragma o pulmón) ni cuadrado lumbar a `WALL_ACROSS_MM`:
 * lo que toca la pared es la grasa retroperitoneal o la perirrenal (en `classify` los órganos ganan al compartimento).
 * La columna no se descarta: desde las ventanas abdominales la cara que la toca está en la sombra del hueso. Gemelo
 * de la condición de `interfaceEcho` (GLSL).
 */
export function fatAcrossWall(m: Vec3, scene: WallAcrossScene): boolean {
  return (
    retroFatSdf(m) < 0 &&
    scene.liverSdf(m) > WALL_ACROSS_MM &&
    sdDiaphragm(m, scene.diaphragm, scene.torso) > DIAPHRAGM_THICKNESS_MM + WALL_ACROSS_MM &&
    quadratusSdf(m, 0, 1e3) > 0
  );
}
/** Ganancia de la reflectividad de la cara `face` en el punto material m (1 salvo la cara de la pared con grasa detrás). */
export function faceSiteGain(face: Interface, m: Vec3, scene: WallAcrossScene): number {
  return face === Interface.Peritoneum && fatAcrossWall(m, scene) ? RETRO_PERITONEUM_GAIN : 1;
}
/**
 * Desviación típica de `valueNoise` − 0,5 en un punto al azar (medida en 400 000 puntos: 0,1846; la de la
 * uniforme sería 0,2887: la interpolación con fundido la reduce). Normaliza la inclinación a σ_t.
 */
export const VALUE_NOISE_SD = 0.1846;

/**
 * Distancia por la normal al cruce de la cara, a lo largo del rayo (mm): ifd/(|∇|·cosθ), con ifd el valor
 * de la distancia de la cara y |∇| la norma de su gradiente. Gemelo de la línea de `interfaceEcho` (GLSL).
 */
export function faceDelta(ifd: number, gradNorm: number, cosI: number): number {
  return ifd / (gradNorm * cosI);
}

/** Lóbulo de Kirchhoff en amplitud con conservación de energía: (s_ref/s)·sec²θ·exp(−tan²θ/(4s²)). */
export function facetLobe(cosI: number, s: number): number {
  const c2 = Math.max(cosI * cosI, 1e-6);
  return ((IFACE_SLOPE_REF / s) * Math.exp(-(1 - c2) / c2 / (4 * s * s))) / c2;
}

/**
 * Coherencia de una superficie con rugosidad fina σz (Ament): exp(−2(k0·σz·cosθ)²). Con el k0 nominal, sin la bajada
 * de la frecuencia del eco (decisión 84): las σz son un ajuste hecho con k0 (decisiones 57 y 62), así que el producto
 * k·σz ya es el de la profundidad a la que se calibraron; lo que no se modela es que la misma cara se vea algo más
 * lisa en lo hondo que en lo somero [EXTRAPOLACIÓN PROPIA].
 */
export function roughnessCoherence(cosI: number, sigmaZMm: number, k0: number): number {
  return Math.exp(-2 * (k0 * sigmaZMm * cosI) ** 2);
}

/**
 * Coherencia de curvatura de un haz gaussiano de dos vías (σl lateral, σe elevacional) sobre una cara
 * de curvaturas κl y κe en esas direcciones (fase estacionaria): [(1+(2kσl²κl)²)(1+(2kσe²κe)²)]^(−1/4), con k el
 * número de onda del eco: k0·f(r)/f0 con la bajada de la frecuencia central (decisión 84, `frequencyRatio`). La σl
 * de `beamModel.ts` ya lleva la bajada; la σe de la lente es un perfil fijo que no la lleva (`psf-nominal-tissue`).
 */
export function curvatureCoherence(sigmaLatMm: number, sigmaElevMm: number, kappaLat: number, kappaElev: number, k: number): number {
  const al = 2 * k * sigmaLatMm * sigmaLatMm * kappaLat;
  const ae = 2 * k * sigmaElevMm * sigmaElevMm * kappaElev;
  return ((1 + al * al) * (1 + ae * ae)) ** -0.25;
}

/** Perfil de integral unidad de la cara a la distancia δ del cruce (mm), desplazado si es de un lado. */
export function faceProfile(delta: number, twoSided: boolean): number {
  const d = delta - (twoSided ? 0 : IFACE_SHIFT_MM);
  if (Math.abs(d) > IFACE_REACH_MM) return 0;
  return Math.exp(-0.5 * (d / IFACE_SIGMA_H_MM) ** 2) / (IFACE_SIGMA_H_MM * Math.sqrt(2 * Math.PI));
}

/** Amplitud de incidencia normal de la cara en el campo de la pasada B: β·10^(K/20)·R_ef·s_ref/s. */
export function interfaceAmplitude(id: Interface, kDb = IFACE_K_DB): number {
  if (id === Interface.None) return 0;
  return IFACE_BETA * 10 ** (kDb / 20) * interfaceReflectivity(id) * (IFACE_SLOPE_REF / INTERFACES[id].slopeRms);
}

/**
 * Uniform `uIface` de la pasada B: un vec4 por cara, (A, 2·k0·σz, 1/(4s²), dos lados), con A la
 * amplitud de `interfaceAmplitude`; ceros para `Interface.None`.
 */
export function interfaceUniforms(k0: number, kDb = IFACE_K_DB): Float32Array {
  const out = new Float32Array(4 * INTERFACE_COUNT);
  for (let i = 1; i < INTERFACE_COUNT; i++) {
    const id: Interface = i;
    const p = INTERFACES[id];
    out.set([interfaceAmplitude(id, kDb), 2 * k0 * p.roughnessMm, 1 / (4 * p.slopeRms * p.slopeRms), p.twoSided ? 1 : 0], 4 * i);
  }
  return out;
}

/**
 * ¿Llega el haz a la cara desde el lado de fuera? Solo cuenta para la cortical costal (decisión 62): su cara
 * posterior (la normal exterior, el gradiente de `ribSd`, apunta lejos de la sonda: `normal·dir > 0`) solo se
 * alcanza a través del hueso, que la apaga (−60 dB o más ida y vuelta); los rayos del borde de la apertura que
 * rodean la costilla siguen hacia dentro y nunca la iluminan desde fuera, así que la transmisión con apertura
 * (la penumbra de la decisión 54) no vale para ella, y sin esta regla cada costilla dibujaba un anillo entero.
 * El cartílago transmite: su cara profunda sí se ve. Gemelo de la condición de `interfaceEcho` (GLSL).
 */
export function faceLitFromProbe(face: Interface, normal: readonly number[], dir: readonly number[]): boolean {
  return face !== Interface.RibCortex || normal[0] * dir[0] + normal[1] * dir[1] + normal[2] * dir[2] <= 0;
}

/** Uniforms del último (k0, K) pedido: el gemelo evalúa el eco en cientos de miles de muestras. */
let uniformCache: { k0: number; kDb: number; u: Float32Array } | null = null;

/**
 * Gemelo exacto de `interfaceProfileEcho` (GLSL): el eco de la cara `id` con incidencia cosI, coherencia
 * de curvatura `curv` y la muestra a δ = ifd/(|∇|·cosθ) del cruce (`faceDelta`). Lee los mismos números
 * que el uniform.
 */
export function interfaceEchoField(id: Interface, cosI: number, curv: number, delta: number, k0: number, kDb = IFACE_K_DB): number {
  if (!uniformCache || uniformCache.k0 !== k0 || uniformCache.kDb !== kDb) uniformCache = { k0, kDb, u: interfaceUniforms(k0, kDb) };
  const u = uniformCache.u.subarray(4 * id, 4 * id + 4);
  const d = delta - (u[3] > 0.5 ? 0 : IFACE_SHIFT_MM);
  if (Math.abs(d) > IFACE_REACH_MM || cosI < IFACE_MIN_COS) return 0;
  const c2 = cosI * cosI;
  const lobe = Math.exp((-(1 - c2) / c2) * u[2]) / c2;
  const x = u[1] * cosI;
  const chi = Math.exp(-0.5 * x * x);
  const prof = Math.exp((-0.5 * d * d) / (IFACE_SIGMA_H_MM * IFACE_SIGMA_H_MM)) * (0.39894228 / IFACE_SIGMA_H_MM);
  return u[0] * lobe * chi * curv * prof;
}

/** Inclinación rms de las facetas de una cara de pendiente s (por componente tangente): max(tiltMin, tiltRatio·s). */
export function facetTiltRms(s: number): number {
  return Math.max(FACET.tiltMin, FACET.tiltRatio * s);
}

/**
 * Inclinación de la faceta en el punto MATERIAL m de la cara `face` (decisión 65; gemelo de `facetTilt` en la
 * GLSL): tres ruidos de valor anclados, de media nula y desviación σ_t de la cara (`facetTiltRms`) por componente.
 * Es un vector del espacio: el eco solo usa su parte tangente a la cara (`facetCosine`).
 */
export function facetTilt(m: Vec3, face: Interface): Vec3 {
  const c = FACET.cellMm;
  const q: Vec3 = [m[0] / c, m[1] / c, m[2] / c];
  const s = FACET.salt + face * FACET.faceSaltStep;
  const k = facetTiltRms(INTERFACES[face].slopeRms) / VALUE_NOISE_SD;
  return [
    (valueNoise(q, s) - 0.5) * k,
    (valueNoise(q, s + FACET.componentSaltStep) - 0.5) * k,
    (valueNoise(q, s + 2 * FACET.componentSaltStep) - 0.5) * k,
  ];
}

/**
 * Coseno de incidencia sobre la faceta: |n_f·dir|/|n_f| con n_f = n + τ − (τ·n)·n (la inclinación sin su
 * componente normal). n es material y dir del mundo, ambos unitarios. La faceta completa se
 * transporta mediante Jᵀ antes de medir la incidencia; inclinar la normal ya transformada mezcla marcos.
 */
export function facetCosine(n: readonly number[], dir: readonly number[], tilt: readonly number[], w: Warp = IDENTITY_WARP): number {
  const tn = tilt[0] * n[0] + tilt[1] * n[1] + tilt[2] * n[2];
  const f = warpNormal(w, [n[0] + tilt[0] - tn * n[0], n[1] + tilt[1] - tn * n[1], n[2] + tilt[2] - tn * n[2]]);
  return Math.abs(f[0] * dir[0] + f[1] * dir[1] + f[2] * dir[2]) / Math.hypot(f[0], f[1], f[2]);
}

/** Núcleo compartido por el renderer y la prueba WebGL: n y t materiales, dir del mundo. */
export const FACET_COSINE_GLSL = /* glsl */ `
float facetCosine(vec3 n, vec3 dir, vec3 t, Warp w) {
  vec3 f = warpNormal(w, n + t - dot(t, n) * n);
  return abs(dot(f, dir)) * inversesqrt(dot(f, f));
}
`;

/** Pendiente propia de la faceta: s_f² = s² − σ_t² (la media sobre las inclinaciones da el lóbulo de s). */
export function facetSlope(s: number): number {
  return Math.sqrt(s * s - facetTiltRms(s) ** 2);
}

/**
 * Eco especular de la faceta (gemelo de `faceEcho` en la GLSL de `interfaceEcho`): el lóbulo de su pendiente propia s_f en
 * su incidencia (cosF, `facetCosine`), con la amplitud que conserva la energía (A_i·s/s_f) y la coherencia de la
 * rugosidad fina de frente, χ(0). δ, la distancia por la normal al cruce con la incidencia de la cara (no la de la
 * faceta: el perfil está en la cara).
 */
export function facetEchoField(id: Interface, cosF: number, curv: number, delta: number, k0: number, kDb = IFACE_K_DB): number {
  if (!uniformCache || uniformCache.k0 !== k0 || uniformCache.kDb !== kDb) uniformCache = { k0, kDb, u: interfaceUniforms(k0, kDb) };
  const u = uniformCache.u.subarray(4 * id, 4 * id + 4);
  const d = delta - (u[3] > 0.5 ? 0 : IFACE_SHIFT_MM);
  if (Math.abs(d) > IFACE_REACH_MM || cosF < IFACE_MIN_COS) return 0;
  // (s_f/s)² = 1 − σ_t²/s², con s² = 1/(4·u[2]) (la del uniform, en float32 como la GLSL)
  const kf = Math.min(1 - 4 * FACET.tiltMin * FACET.tiltMin * u[2], 1 - FACET.tiltRatio * FACET.tiltRatio);
  const c2 = cosF * cosF;
  const lobe = Math.exp(((-(1 - c2) / c2) * u[2]) / kf) / c2;
  const chi0 = Math.exp(-0.5 * u[1] * u[1]);
  const prof = Math.exp((-0.5 * d * d) / (IFACE_SIGMA_H_MM * IFACE_SIGMA_H_MM)) * (0.39894228 / IFACE_SIGMA_H_MM);
  return (u[0] / Math.sqrt(kf)) * lobe * chi0 * curv * prof;
}

/**
 * Seno del ángulo crítico de la onda longitudinal del tejido blando al hueso cortical, c_músculo/c_hueso (TISSUES:
 * 1588/3515, 26,9°): más oblicua, se refleja entera y nada entra en la cortical (decisión 88).
 */
export const BONE_CRITICAL_SIN = TISSUES[Tissue.Muscle].c / TISSUES[Tissue.Bone].c;
/** Cociente de impedancias Z_músculo/Z_hueso (TISSUES: 0,258), el de la transmisión en la cara de la cortical. */
export const BONE_IMPEDANCE_RATIO =
  (TISSUES[Tissue.Muscle].c * TISSUES[Tissue.Muscle].rho) / (TISSUES[Tissue.Bone].c * TISSUES[Tissue.Bone].rho);

/**
 * Ventana de la componente difusa de la cortical costal con la incidencia (decisión 88): la difusa de un hueso es la
 * energía que la onda que entra devuelve desde la microestructura de la cortical (periostio, conductos de Havers), no
 * una capa de Lambert encima de una cara lisa, así que su amplitud (ida y vuelta) sigue a la transmisión de energía de la
 * onda longitudinal en la cara, T_E(θ)/T_E(0), con T_E = 4·Z₁Z₂·cosθ·cosθ_t/(Z₂cosθ + Z₁cosθ_t)² (dos fluidos): −2 dB a
 * 20°, −8,6 a 26° y 0 en el ángulo crítico y más allá. Sin la onda transversal, que entra hasta ~60° pero se atenúa en la
 * cortical [EXTRAPOLACIÓN PROPIA]. Con la ley de Lambert sola la difusa seguía a +16 dB sobre el hígado a 60° y dibujaba
 * el contorno de media costilla: un disco. 1 en el resto de caras.
 */
export function boneDiffuseWindow(face: Interface, cosI: number): number {
  if (face !== Interface.RibCortex) return 1;
  const ct2 = 1 - (1 - cosI * cosI) / (BONE_CRITICAL_SIN * BONE_CRITICAL_SIN);
  if (ct2 <= 0) return 0;
  const ct = Math.sqrt(ct2);
  const z = BONE_IMPEDANCE_RATIO;
  return (cosI * ct * (1 + z) * (1 + z)) / ((cosI + z * ct) * (cosI + z * ct));
}

/**
 * Amplitud de la componente difusa de la cara `id` en la muestra (gemelo de la difusa de `interfaceEcho` en la GLSL):
 * κ_d·R_ef·√(1 − χ(0)²)·cosθ·exp(−d²/2σh²), con el perfil de la cara normalizado a 1 en su centro. La pasada B la
 * suma con el fasor unidad del moteado de la muestra (incoherente con la especular). La GLSL la saca del uniform A
 * (`IFACE_DIFFUSE_PER_A`), así que escala con K como la especular: con otro K, el mismo factor 10^((K − K₀)/20).
 */
export function diffuseEchoField(id: Interface, cosI: number, delta: number, k0: number, kDb = IFACE_K_DB): number {
  if (id === Interface.None) return 0;
  const p = INTERFACES[id];
  const d = delta - (p.twoSided ? 0 : IFACE_SHIFT_MM);
  if (Math.abs(d) > IFACE_REACH_MM || cosI < IFACE_MIN_COS) return 0;
  const x = Math.fround(2 * k0 * p.roughnessMm);
  const incoherent = Math.sqrt(Math.max(0, 1 - Math.exp(-x * x)));
  const k = 10 ** ((kDb - IFACE_K_DB) / 20);
  return (
    k *
    FACET.diffuse *
    interfaceReflectivity(id) *
    incoherent *
    cosI *
    boneDiffuseWindow(id, cosI) *
    Math.exp((-0.5 * d * d) / (IFACE_SIGMA_H_MM * IFACE_SIGMA_H_MM))
  );
}

/**
 * La muestra de la imagen con su eco de interfaz (`mediumField` de la pasada B): el campo del tejido más la
 * especular (real, fase 0 común a la cara) y la difusa sobre el fasor unidad del propio campo.
 */
export function addInterfaceEcho(field: readonly [number, number], specular: number, diffuse: number): [number, number] {
  const k = 1 + diffuse / Math.max(Math.hypot(field[0], field[1]), 1e-6);
  return [field[0] * k + specular, field[1] * k];
}

/**
 * Coseno de incidencia de la pleura a partir de la reflexión que calcula la pasada A: con d_R = d0 −
 * 2(d0·n)n, d0·d_R = 1 − 2cos²θ.
 */
export function reflectionCosine(d0: readonly number[], dR: readonly number[]): number {
  return Math.sqrt(Math.max(0, 0.5 * (1 - (d0[0] * dR[0] + d0[1] * dR[1] + d0[2] * dR[2]))));
}

/**
 * La difusa de la GLSL por unidad de P.x·(2s) = β·10^(K/20)·R_ef·2·s_ref (el uniform `uIface`, sin tabla ni ranuras):
 * κ_d/(2·β·10^(K/20)·s_ref), con el K por omisión (el de los uniforms del renderizador).
 */
export const IFACE_DIFFUSE_PER_A = FACET.diffuse / (2 * IFACE_BETA * 10 ** (IFACE_K_DB / 20) * IFACE_SLOPE_REF);

/**
 * Pasada B: eco de interfaz de una muestra (necesita `Cls`, `faceGradient`, `liverSdf`, `domeSd`, `retroFatSdf`,
 * `quadratusSdf` y `uElev` de la anatomía y del haz, `lateralSigmaMm` de `LATERAL_PSF_GLSL`, `wallFaceGain` de
 * `WALL_TEXTURE_GLSL` y `valueNoise` de `SPECKLE_TISSUE_GLSL`). `se` es la σ elevacional de UNA vía (`elevSigma`).
 */
export const INTERFACE_ECHO_GLSL = /* glsl */ `
${FACET_COSINE_GLSL}
uniform vec4 uIface[${INTERFACE_COUNT}]; // (A, 2·k0·σz, 1/(4s²), dos lados) — interfaceEcho.ts
uniform float uIfaceK0;                 // 2π/λ (1/mm)
#define IFACE_SIGMA_H ${IFACE_SIGMA_H_MM.toFixed(4)}
#define IFACE_SHIFT ${IFACE_SHIFT_MM.toFixed(4)}
#define IFACE_REACH ${IFACE_REACH_MM.toFixed(4)}
#define IFACE_MIN_COS ${IFACE_MIN_COS.toFixed(4)}
#define IFACE_GRAD_MAX ${IFACE_GRADIENT_MAX.toFixed(4)}
// facetas y componente difusa (decisión 65): constantes, sin ranuras de uniforms
#define FACET_CELL ${FACET.cellMm.toFixed(4)}
#define FACET_GAIN ${(1 / VALUE_NOISE_SD).toFixed(6)}
#define FACET_TILT2 ${(FACET.tiltMin * FACET.tiltMin).toFixed(8)}
#define FACET_RHO2 ${(FACET.tiltRatio * FACET.tiltRatio).toFixed(8)}
#define FACET_SALT ${FACET.salt.toFixed(4)}
#define FACET_SALT_C ${FACET.componentSaltStep.toFixed(4)}
#define FACET_SALT_F ${FACET.faceSaltStep.toFixed(4)}
#define IFACE_DIFFUSE ${IFACE_DIFFUSE_PER_A.toPrecision(6)}
#define IFACE_RETRO_PERITONEUM ${RETRO_PERITONEUM_GAIN.toFixed(6)}
#define IFACE_ACROSS ${WALL_ACROSS_MM.toFixed(4)}
#define BONE_CRITICAL_SIN2 ${(BONE_CRITICAL_SIN * BONE_CRITICAL_SIN).toFixed(8)}
#define BONE_Z_RATIO ${BONE_IMPEDANCE_RATIO.toFixed(8)}
// Inclinación de la faceta en el punto material: tres ruidos de valor anclados, de desviación st por componente
vec3 facetTilt(vec3 m, int face, float st) {
  vec3 q = m / FACET_CELL;
  float s = FACET_SALT + float(face) * FACET_SALT_F;
  return (vec3(valueNoise(q, s), valueNoise(q, s + FACET_SALT_C), valueNoise(q, s + 2.0 * FACET_SALT_C)) - 0.5) * (FACET_GAIN * st);
}
// Forma del perfil de la cara id en δ, pico 1 y 0 fuera de su alcance (faceProfile de TS, con integral 1): en el cruce
// exacto o 2,5σh dentro del dueño si solo un lado conoce la cara
float faceShape(int id, float delta) {
  float d = delta - (uIface[id].w > 0.5 ? 0.0 : IFACE_SHIFT);
  return abs(d) > IFACE_REACH ? 0.0 : exp(-0.5 * d * d / (IFACE_SIGMA_H * IFACE_SIGMA_H));
}
// Especular de la cara id con el perfil g, de integral unidad (muestreado como el moteado, el cociente eco/moteado no
// depende de dr, decisión 57): Kirchhoff en amplitud, sec²θ·exp(−tan²θ/4s²), en la incidencia cosL con 1/(4s²) = P.z/kf
// y la amplitud que conserva la energía (P.x/√kf, decisión 65), por la rugosidad fina exp(−2(k0·σz·cosX)²)
float faceEcho(int id, float cosL, float kf, float cosX, float curv, float g) {
  vec4 P = uIface[id];
  float c2 = cosL * cosL;
  float x = P.y * cosX;
  return cosL < IFACE_MIN_COS ? 0.0 : P.x * inversesqrt(kf) * exp(-(1.0 - c2) / c2 * P.z / kf) / c2 * exp(-0.5 * x * x) * curv * g * (0.39894228 / IFACE_SIGMA_H);
}
// La de la decisión 57: el lóbulo del conjunto con la rugosidad fina en la incidencia de la cara (las pleuras y las
// copias de la pared de la serie, en su bucle: sin facetas ni difusa)
float interfaceProfileEcho(int id, float cosI, float curv, float delta) {
  return faceEcho(id, cosI, 1.0, cosI, curv, faceShape(id, delta));
}
// Coherencia de curvatura de un haz gaussiano sobre un tubo (fase estacionaria): la curvatura del
// tubo (c.kc, la local de su sección) va por la dirección circunferencial; se proyecta sobre el lateral
// y la elevación del haz
float tubeCurvature(Cls c, vec3 n, vec3 dir, float r, float se) {
  vec3 circ = cross(n, c.tangent);
  float cl = length(circ);
  if (cl < 1e-4) return 1.0;
  circ /= cl;
  vec3 lat = normalize(cross(uElev, dir));
  float sl = lateralSigmaMm(r);                       // dos vías (beamModel)
  float sE = se * 0.70710678;                         // elevSigma es de una vía
  float kl = dot(lat, circ); kl = kl * kl * c.kc;
  float ke = dot(uElev, circ); ke = ke * ke * c.kc;
  float k = uIfaceK0 * echoFrequency(r);              // el número de onda del eco (decisión 84)
  float al = 2.0 * k * sl * sl * kl;
  float ae = 2.0 * k * sE * sE * ke;
  return inversesqrt(sqrt((1.0 + al * al) * (1.0 + ae * ae)));
}
// Eco de la cara que dibuja la muestra (material m, rayo dir, profundidad r): (especular, amplitud de la difusa).
// La normal y la norma del gradiente son las del mundo: las materiales por la jacobiana de la compresión de la
// sonda (w, decisión 63)
vec2 interfaceEcho(Cls c, vec3 m, vec3 dir, float r, float se, Warp w) {
  if (c.iface == IF_NONE) return vec2(0.0);
  // salida barata sin gradiente: δ = ifd/(|∇|·cosθ) ≥ ifd/|∇|; la norma de un tubo ya está en c.n, la
  // del resto se acota (IFACE_GRAD_MAX); la compresión la multiplica a lo sumo por warpBound
  float gBound = (c.iface <= IF_LAST_TUBE ? length(c.n) : IFACE_GRAD_MAX) * warpBound(w);
  if (c.ifd > (uIface[c.iface].w > 0.5 ? IFACE_REACH : IFACE_SHIFT + IFACE_REACH) * gBound) return vec2(0.0);
  vec4 fg = faceGradient(c, m);
  vec3 nm = fg.xyz; // normal material: la inclinación anclada pertenece a este marco
  vec3 gw = warpNormal(w, fg.xyz * fg.w);
  float gn = length(gw);
  fg = vec4(gw / max(gn, 1e-9), gn);
  // la cara posterior de una costilla ósea solo se alcanza a través del hueso (faceLitFromProbe, decisión 62)
  if (c.iface == IF_RIB && dot(fg.xyz, dir) > 0.0) return vec2(0.0);
  float cosI = abs(dot(fg.xyz, dir));
  if (cosI < IFACE_MIN_COS) return vec2(0.0);
  // tubos y costillas (decisión 62): cilindros con la curvatura de su sección en c.kc y su eje en c.tangent
  float curv = c.iface <= IF_LAST_TUBE || c.iface == IF_RIB || c.iface == IF_PERICHONDRIUM ? tubeCurvature(c, fg.xyz, dir, r, se) : 1.0;
  // las caras de la pared: la variación anclada de su reflectividad a lo largo de la cara (wallTexture.ts)
  float gain = c.iface >= IF_FIRST_WALL && c.iface <= IF_LAST_WALL ? wallFaceGain(m, c.iface) : 1.0;
  // la cara interna de la pared con grasa detrás (fatAcrossWall, decisión 65): dentro del compartimento retroperitoneal y
  // sin hígado, cúpula ni cuadrado lumbar contra la pared, grasa con grasa
  float dB;
  if (c.iface == IF_PERITONEUM && retroFatSdf(m) < 0.0 && liverSdf(m, dB) > IFACE_ACROSS && domeSd(m) > DIAPHRAGM_MM + IFACE_ACROSS && quadratusSdf(m, 0.0, 1e3) > 0.0) gain *= IFACE_RETRO_PERITONEUM;
  // perfil en la distancia por la normal (faceDelta): integra 1 a lo largo del rayo aunque |∇| ≠ 1
  float g = faceShape(c.iface, c.ifd / (fg.w * cosI)) * gain;
  // la faceta (decisión 65): la normal inclinada por el campo anclado, sin su componente normal
  vec4 P = uIface[c.iface];
  vec3 t = facetTilt(m, c.iface, sqrt(max(FACET_TILT2, 0.25 * FACET_RHO2 / P.z)));
  float cosF = facetCosine(nm, dir, t, w);
  // su lóbulo propio (s_f² = s² − σ_t², σ_t = max(tan 5°, ρ·s): kf = (s_f/s)²) en cosF con la rugosidad fina de frente,
  // χ(0); la difusa: κ_d·R_ef = IFACE_DIFFUSE·P.x·2s por √(1 − χ(0)²), la energía que la rugosidad fina saca de la
  // coherente, con Lambert (cosI) y, en la cortical costal, la transmisión de la onda longitudinal en la cara, 0 desde el
  // ángulo crítico (boneDiffuseWindow, decisión 88)
  float ctw = sqrt(max(0.0, 1.0 - (1.0 - cosI * cosI) / BONE_CRITICAL_SIN2));
  float zw = cosI + BONE_Z_RATIO * ctw;
  float wd = c.iface == IF_RIB ? cosI * ctw * (1.0 + BONE_Z_RATIO) * (1.0 + BONE_Z_RATIO) / (zw * zw) : 1.0;
  return vec2(faceEcho(c.iface, cosF, min(1.0 - 4.0 * FACET_TILT2 * P.z, 1.0 - FACET_RHO2), 1.0, curv, g),
              IFACE_DIFFUSE * P.x * inversesqrt(P.z) * sqrt(max(0.0, 1.0 - exp(-P.y * P.y))) * cosI * wd * g);
}
// Pleura: su eco se centra en el cruce exacto del espejo de la pasada A (no sale de classify), una vez
// por línea; el coseno sale de la reflexión (reflectionCosine)
float pleuraEcho(float delta, vec3 d0, vec3 dR) {
  return interfaceProfileEcho(IF_PLEURA, sqrt(max(0.0, 0.5 * (1.0 - dot(d0, dR)))), 1.0, delta);
}
`;
