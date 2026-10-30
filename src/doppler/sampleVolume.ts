import { hannWindow } from '../core/fft';
import { SeededRandom } from '../core/random';
import type { Vec3 } from '../core/vec3';
import { dopplerShiftHz } from '../core/units';
import { shapeMetric, tubeNoise, tubeQuery, type Tube, type TubeHit } from '../anatomy/primitives';
import type { AnatomyQuery } from '../anatomy/query';
import { vesselApScale, wallThicknessMm, type VesselCaliber } from '../anatomy/scene';
import type { DuctDef, VesselDef } from '../anatomy/vesselTree';
import type { PhysiologySample } from '../physiology/engine';
import { TISSUES, Tissue } from '../anatomy/tissues';
import { VESSEL_META, type VesselId } from '../physiology/vessels';

/**
 * Volumen de muestra físico del Doppler pulsado (guía §10; base D.8):
 *
 *   z[n] = Σ_j a_j w_j e^{iφ_j} + z_pared + η ;  φ_j[n+1] − φ_j[n] = 2π f_D,j Δt
 *
 * Dispersores virtuales persistentes en coordenadas MATERIALES dentro de una
 * caja alrededor de la puerta. Los de sangre se advectan con el campo de
 * velocidades; los de tejido siguen la deformación respiratoria. El peso w_j
 * combina la ventana axial de la puerta (convolucionada con el pulso), el
 * ancho lateral y el espesor elevacional del haz; a_j la retrodispersión y
 * la transmisión acumulada. La frecuencia Doppler física usa la velocidad
 * relativa v_rel = v_sangre + v_tejido − v_sonda proyectada sobre el haz.
 *
 * Población (decisión 294): la meta es la de una siembra nueva; con la geometría quieta se mide así (16 semillas), y tras
 * respirar y volver a apnea queda un déficit declarado (`pw-population-after-breathing`). Todo dispersor vive en su punto
 * material verdadero (el de `classifyMaterial`); un mapa local de la llamada (material → mundo, lineal en el centro de la
 * puerta) y el desplazamiento rígido dentro de la llamada lo llevan a la caja. La sangre recorre la línea de corriente de
 * SU tubo (el que eligió la clasificación): segmento, parámetro y desplazamiento de la sección normalizado por el radio
 * del tubo con el calibre de la siembra, así que no sale de la luz en los vasos curvos ni afilados. Su velocidad es la del
 * perfil radial con el radio normalizado de su siembra en la sección del instante (calibre, semieje AP, forma orgánica),
 * como la de `classifyMaterial` en el punto de la siembra; ese radio no cambia a lo largo de la corriente. Dos salidas, dos
 * entradas:
 *  - por flujo (con el desplazamiento del pulso anterior; también la salida de la luz por un casquete y la del dominio de su
 *    tubo en una unión): reentra por su corriente en la entrada aguas arriba de la parte válida, con el sobrepaso (envoltura
 *    periódica a lo largo de la corriente);
 *  - por movimiento (respiración, mapa nuevo): entra otro dispersor por la cara opuesta a lo largo del movimiento, con
 *    la identidad del punto de entrada. El tejido sale y entra en rampa; la sangre, con su amplitud (caras de peso ≈ 0).
 * Más allá de los nodos extremos la corriente sigue recta por el casquete hasta salir de la luz. En una unión, una
 * corriente vale solo donde su tubo gana la clasificación (los socios de unión se buscan por solape real al sembrar). En
 * un tubo afilado la circulación conserva la densidad por arco y no por volumen: cada partícula lleva la importancia
 * (r/r_siembra)², que multiplica su peso en la composición y su raíz, la amplitud (potencia incoherente esperada). La luz
 * que crece o mengua (calibre, semieje AP de la cava) no mueve las corrientes: cambia en dos rampas la identidad de los
 * dispersores que quedan dentro o fuera de ella. La sangre que la luz deja fuera se detiene y empieza a convertirse en el
 * tick lento en que se detecta; el tejido que queda dentro, en la visita de la reclasificación. Al terminar la rampa se
 * enciende la identidad del punto en ese instante.
 *
 * El resultado es una IQ que comparten espectro y audio. El color no la usa:
 * es una emulación analítica por celda (pasada F) que solo comparte con el PW
 * el campo de velocidades, la convención de signo y la respuesta estacionaria del filtro. Ningún elemento aquí
 * consulta «si el cursor está dentro del vaso».
 */
export interface GateGeometry {
  /** Centro de la puerta en el mundo (mm). */
  center: Vec3;
  /** Dirección unitaria del haz desde la sonda hacia el tejido. */
  beamDir: Vec3;
  /** Vectores unitarios lateral (en plano) y elevacional. */
  lateral: Vec3;
  elevation: Vec3;
  /** Longitud de la puerta (mm) a lo largo del haz. */
  lengthMm: number;
  /** Semianchura lateral y elevacional del haz a esa profundidad (σ, mm). */
  lateralSigmaMm: number;
  elevationSigmaMm: number;
  /** Longitud del pulso Doppler (σ axial, mm). */
  pulseSigmaMm: number;
  /** Dispersión angular de la apertura (σ, rad): ensanchamiento espectral intrínseco. */
  apertureAngleSigmaRad?: number;
  /** Transmisión de amplitud de ida y vuelta hasta la puerta (0–1). */
  transmission: number;
}

export interface GateEquipment {
  prfHz: number;
  f0Hz: number;
  /** Ganancia espectral (factor lineal aplicado a señal y ruido antes del mapeo). */
  gain: number;
}

/** Geometría de los segmentos de un tubo (marco material). */
interface TubeGeom {
  a: Vec3[];
  ab: Vec3[];
  len: number[];
  t: Vec3[];
  arc0: number[];
}

/** Sección del instante de un vaso, la de `tubeQuery`: calibre, semieje AP y métrica de la forma orgánica (sin AP). */
interface Section {
  phys: PhysiologySample | null;
  scale: number;
  ap: number;
  wt: Vec3 | null;
  c: number;
}

/** Partícula de sangre sobre la línea de corriente de su tubo (decisión 294). */
interface Stream {
  def: VesselDef;
  geom: TubeGeom;
  seg: number;
  /** Parámetro en el segmento; fuera de [0, 1] solo en los casquetes de los extremos. */
  s: number;
  /** Desplazamiento desde el eje, perpendicular al segmento, dividido por el radio verdadero de la siembra. */
  off: Vec3;
  /** El de la siembra, en el marco de su segmento: fija el radio normalizado de la corriente a lo largo de todo el tubo. */
  off0: Vec3;
  /**
   * Radio normalizado en la sección del instante (calibre, semieje AP, forma) y perfil radial × flowFactor, como
   * `classifyMaterial`. El de la siembra con esa sección: es constante a lo largo de la corriente (si cambiara en cada nodo
   * o casquete, la densidad por arco iría como 1/velocidad y se alejaría de una siembra nueva); en un casquete `rho` es la
   * distancia real, con la parte axial más allá del nodo extremo. Fuera de la luz k = 0: la corriente se detiene. Se
   * recalculan en cada reanclaje; `n`, `ff`: exponente del perfil y flowFactor del vaso.
   */
  rho: number;
  k: number;
  n: number;
  ff: number;
  sec: Section;
  /**
   * Radio de la corriente al último reanclaje (mm): el del tubo en ese punto con el calibre de la siembra. La corriente no
   * se mueve con el calibre del instante: la luz que crece o mengua (calibre, semieje AP de la cava) cambia la identidad
   * de los dispersores por reclasificación. `rel`: ese radio frente al de la siembra (afilamiento a lo largo del tubo).
   */
  r: number;
  rel: number;
  /** Calibre del vaso en la siembra y radio de la siembra sin él; `grow`: calibre del instante sobre el de la siembra. */
  scaleSeed: number;
  rGeoSeed: number;
  grow: number;
  /** Última cuerda válida a lo largo de esta corriente (mm de arco) y época del mapa en que se midió. */
  chord: number;
  chordEpoch: number;
  /** Arco (mm) que aún puede recorrer sin poder dejar el dominio de su tubo en una unión (`domainArc`). */
  domainLeft: number;
}

/** Zona de una unión: otro tubo cuya luz solapa la de este cerca de la caja (caja material). */
interface JunctionZone {
  duct: boolean;
  def: VesselDef | DuctDef;
  lo: Vec3;
  hi: Vec3;
}

interface Scatterer {
  /** Punto material verdadero (mm): fijo en el tejido, sobre la corriente en la sangre. */
  m: Vec3;
  /** Coordenadas de puerta (axial, lateral, elevacional) del último pulso. */
  g: Vec3;
  amp: number;
  /** Ángulo (rad) con que la apertura ve a ESTE dispersor respecto al eje del haz (fijo por dispersor). */
  apAngle: number;
  /** Fasor e^{iφ} y rotación por tick e^{i2πfDΔt} (se recalcula cada SLOW_EVERY ticks). */
  cr: number;
  ci: number;
  rotC: number;
  rotS: number;
  /** La frecuencia se inicializa antes del primer pulso tras sembrar el dispersor. */
  fresh: boolean;
  /** Tejido que salió de la caja y se apaga en rampa; entra otro por la cara opuesta cuando la rampa termina. */
  fading: boolean;
  /** Movimiento (mundo) con que salió el tejido que se apaga: dirección de la cara de entrada de su reemplazo. */
  exitMotion: Vec3;
  /**
   * Rampa de amplitud (incremento por tick y ticks restantes, AMP_RAMP_TICKS): el tejido entra y sale en rampa. Un salto
   * brusco de un dispersor de tejido (40 dB sobre la sangre) es un chasquido de banda ancha: con la respiración llenaba
   * todo el espectro de energía «de sangre». La sangre que reentra o entra por una cara lo hace con su amplitud (peso ≈ 0);
   * la que se siembra al azar entra en rampa.
   */
  dAmp: number;
  rampLeft: number;
  vessel: VesselId | null;
  isBlood: boolean;
  /** Velocidad material (mm/s) de la sangre en su posición (sin tejido). */
  vBlood: Vec3;
  /** Base de flujo (tangente·perfil): vBlood = flowBasis·u_ref(t). */
  flowBasis: Vec3;
  tissue: Tissue;
  weightEpoch: number;
  stationaryWeight: number;
  /** Corriente de la sangre en su tubo; null en el tejido y en la sangre sin tubo (fantomas con clasificador sintético). */
  stream: Stream | null;
  /**
   * Cambio de identidad a la espera de que la vieja se apague (decisión 48): el tejido que queda en una luz que creció pasa
   * a sangre y la sangre que la luz deja fuera, a tejido, en dos rampas. La identidad nueva es la del punto al terminar la
   * rampa (la luz pudo seguir cambiando o volver); aquí solo viaja el factor aleatorio de su amplitud. La amplitud nunca
   * viaja con la velocidad de la otra identidad.
   */
  pending: { ampFactor: number } | null;
  /**
   * Tejido que fue sangre en su corriente hasta que la luz lo dejó fuera: esa corriente, quieta en su punto. Cuando la luz
   * del instante vuelve a contenerlo, el cambio de identidad empieza sin esperar a la visita de la reclasificación.
   */
  lumen: Stream | null;
  /** Importancia de la medida (r/r_siembra)² de la sangre en un tubo afilado y su raíz (amplitud); 1 en el resto. */
  imp: number;
  ampImp: number;
}

export interface GateComposition {
  bloodFraction: number;
  /**
   * Peso de haz de la sangre por dispersor (Σ w_sangre / N): cuánta sangre ve de verdad la puerta.
   * Una siembra nueva da la referencia; si la población con historia se va a los bordes de la caja
   * (donde w ≈ 0), la fracción de sangre puede seguir alta y la señal, sin embargo, desaparecer.
   */
  bloodWeight: number;
  arterialFraction: number;
  wallFraction: number;
  vessels: Partial<Record<VesselId, number>>;
}

const N_SCATTERERS = 320;
/** Refining Monte Carlo density must preserve expected incoherent signal power. */
export function particleAmplitudeScale(count: number): number {
  if (!Number.isInteger(count) || count <= 0) throw new RangeError('Invalid PW particle count');
  return Math.sqrt(N_SCATTERERS / count);
}
/** Reclasificación (luz que crece o mengua): cada 96 ticks (≈37 ms a 2,6 kHz) se visita un cuarto de los dispersores, otro
 * en cada turno. La sangre en su corriente que la luz deja fuera no espera a la visita (decisión 294). */
const RECLASSIFY_EVERY = 96;
/** Actualización del campo de velocidad y frecuencia Doppler: cada 8 ticks (≈3 ms).
 * La posición, salida de sangre y sensibilidad espacial se evalúan en CADA pulso. */
const SLOW_EVERY = 8;
/** Duración de toda variación de amplitud (ticks): ~5 ms a 6 kHz, su energía queda junto a la línea de base. */
const AMP_RAMP_TICKS = 32;
/**
 * Suavizado de la transmisión hasta la puerta (fracción por tick hacia el valor nuevo). La app la
 * recalcula cada ~32 ms con la anatomía que respira y cambia a saltos (la marcha clasifica cada
 * milímetro; una sombra costal entra de golpe): aplicada de golpe, cada salto escalaba toda la IQ,
 * clutter del tejido incluido, y era una línea vertical en el espectrograma.
 */
const TRANSMISSION_ALPHA = 1 / AMP_RAMP_TICKS;

/** Lleva la amplitud del dispersor a `target` en AMP_RAMP_TICKS ticks. */
function startAmpRamp(s: Scatterer, target: number): void {
  s.dAmp = (target - s.amp) / AMP_RAMP_TICKS;
  s.rampLeft = AMP_RAMP_TICKS;
}
/** Ruido electrónico relativo a la sangre a transmisión 1 ([EXTRAPOLACIÓN PROPIA]). */
const NOISE_STD = 0.0004;

/**
 * Potencia media por bin (dB) del ruido del receptor en el espectrograma con la ganancia espectral `gainDb`: ruido
 * complejo de desviación NOISE_STD por componente, ventana de Hann de `fftSize` muestras sin normalizar,
 * E|X_k|² = 2σ²·Σw². El equipo conoce su propio ruido; la calidad lo usa para reconocer el aliasing fuerte (decisión 94).
 */
export function receiverNoiseDb(gainDb: number, fftSize: number): number {
  const w = hannWindow(fftSize);
  let sw2 = 0;
  for (const x of w) sw2 += x * x;
  return 10 * Math.log10(2 * NOISE_STD * NOISE_STD * sw2) + gainDb;
}

/**
 * Paso (mm de arco) de la búsqueda de la entrada aguas arriba por la corriente (una cuerda junto a una arista de la caja
 * puede ser más corta) y bisecciones del cruce: 12, con el centro del intervalo final, lo dejan sin sesgo a < 0,1 µm en
 * 0,6 mm, por debajo del desplazamiento respiratorio de un pulso, que decide si la sangre recién reentrada sale después por
 * movimiento.
 */
const WRAP_STEP_MM = 0.05;
const WRAP_BISECT = 12;

const geomCache = new WeakMap<object, TubeGeom>();
/** Segmentos del tubo (origen, vector, longitud, tangente, arco inicial), en caché por la lista de nodos. */
function tubeGeom(tube: Tube): TubeGeom {
  const hit = geomCache.get(tube.nodes);
  if (hit) return hit;
  const g: TubeGeom = { a: [], ab: [], len: [], t: [], arc0: [] };
  let arc = 0;
  for (let i = 0; i < tube.nodes.length - 1; i++) {
    const p = tube.nodes[i].p,
      q = tube.nodes[i + 1].p;
    const d: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    g.a.push(p);
    g.ab.push(d);
    g.len.push(l);
    g.t.push([d[0] / l, d[1] / l, d[2] / l]);
    g.arc0.push(arc);
    arc += l;
  }
  geomCache.set(tube.nodes, g);
  return g;
}

/** Rotación mínima (Rodrigues) que lleva la tangente unitaria a a b, aplicada a v: la sección al pasar un nodo. */
function rotate(v: Vec3, a: Vec3, b: Vec3): Vec3 {
  const kx = a[1] * b[2] - a[2] * b[1],
    ky = a[2] * b[0] - a[0] * b[2],
    kz = a[0] * b[1] - a[1] * b[0];
  const sn = Math.hypot(kx, ky, kz);
  if (sn < 1e-12) return v;
  const cs = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const ux = kx / sn,
    uy = ky / sn,
    uz = kz / sn;
  const dot = (ux * v[0] + uy * v[1] + uz * v[2]) * (1 - cs);
  return [
    v[0] * cs + (uy * v[2] - uz * v[1]) * sn + ux * dot,
    v[1] * cs + (uz * v[0] - ux * v[2]) * sn + uy * dot,
    v[2] * cs + (ux * v[1] - uy * v[0]) * sn + uz * dot,
  ];
}

/** Radio verdadero del tubo en (segmento, s) con su calibre, como `tubeQuery` (en los casquetes, el del nodo extremo). */
function radiusAt(st: Stream, seg: number, s: number, scale: number): number {
  const tube = st.def.tube,
    n = tube.nodes;
  const c = s < 0 ? 0 : s > 1 ? 1 : s;
  const w = tube.smoothRadius ? c * c * (3 - 2 * c) : c;
  const r = (n[seg].r + (n[seg + 1].r - n[seg].r) * w) * scale;
  const amp = tube.shape?.amp ?? 0;
  return amp > 0 ? r * (1 + amp * tubeNoise(tube.shape!.seed, st.geom.arc0[seg] + c * st.geom.len[seg])[0]) : r;
}

/** Velocidad relativa a la media en el radio normalizado `rho` (perfil de exponente `n`), por el flowFactor. */
function radialProfile(rho: number, n: number, ff: number): number {
  return ((n + 2) / n) * (1 - Math.pow(rho, n)) * ff;
}

/** El tubo del vaso con el semieje AP del instante. */
function instantTube(def: VesselDef, caliber: VesselCaliber): Tube {
  const ap = vesselApScale(def.id, def.tube.apScale, caliber);
  return ap === def.tube.apScale ? def.tube : { ...def.tube, apScale: ap };
}

/** ¿Está la corriente más allá del primer o del último nodo (casquete)? */
function inCap(st: Stream): boolean {
  return (st.seg === 0 && st.s < 0) || (st.seg === st.geom.len.length - 1 && st.s > 1);
}

/**
 * Distancia de `tubeQuery` en la sección `sec` del desplazamiento perpendicular al eje (px, py, pz) más `axial` a lo largo
 * de la tangente `t` (casquetes): el semieje AP de la cava divide la componente y; si no, la métrica de la forma orgánica.
 */
function sectionDist(sec: Section, px: number, py: number, pz: number, axial: number, t: Vec3): number {
  if (sec.ap !== 1) {
    const y = py / sec.ap;
    return Math.sqrt(px * px + y * y + pz * pz + axial * axial);
  }
  const dx = px + t[0] * axial,
    dy = py + t[1] * axial,
    dz = pz + t[2] * axial;
  const wt = sec.wt;
  const q = wt ? dx * wt[0] + dy * wt[1] + dz * wt[2] : 0;
  return sec.c * Math.sqrt(dx * dx + dy * dy + dz * dz + q * q);
}

/**
 * Avanza `dArc` mm por el eje. Al pasar un nodo, la sección gira con la tangente. Más allá de los extremos sigue recta
 * por el casquete hasta dos radios (del instante si la luz creció); false si sale del tubo por un extremo.
 */
function advanceStream(st: Stream, dArc: number): boolean {
  const g = st.geom;
  let s = st.s + dArc / g.len[st.seg];
  const capMax = (2 * st.r * Math.max(1, st.grow)) / g.len[st.seg];
  while (s > 1) {
    if (st.seg >= g.len.length - 1) {
      st.s = Math.min(s, 1 + capMax);
      return s <= 1 + capMax;
    }
    const rem = (s - 1) * g.len[st.seg];
    st.off = rotate(st.off, g.t[st.seg], g.t[st.seg + 1]);
    st.seg++;
    s = rem / g.len[st.seg];
  }
  while (s < 0) {
    if (st.seg <= 0) {
      st.s = Math.max(s, -capMax);
      return s >= -capMax;
    }
    const rem = s * g.len[st.seg];
    st.off = rotate(st.off, g.t[st.seg], g.t[st.seg - 1]);
    st.seg--;
    s = 1 + rem / g.len[st.seg];
  }
  st.s = s;
  return true;
}

function cloneStream(st: Stream): Stream {
  return { ...st, off: [st.off[0], st.off[1], st.off[2]] };
}

function segPointDist(a: Vec3, b: Vec3, p: Vec3): number {
  const ab0 = b[0] - a[0],
    ab1 = b[1] - a[1],
    ab2 = b[2] - a[2];
  const l2 = ab0 * ab0 + ab1 * ab1 + ab2 * ab2 || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab0 + (p[1] - a[1]) * ab1 + (p[2] - a[2]) * ab2) / l2));
  return Math.hypot(a[0] + ab0 * t - p[0], a[1] + ab1 * t - p[1], a[2] + ab2 * t - p[2]);
}

/** Distancia mínima entre dos segmentos (muestreo fino del primero contra la distancia exacta al segundo). */
function segSegDist(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  let best = Infinity;
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    best = Math.min(best, segPointDist(c, d, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]));
  }
  return best;
}

/** Inversa de una matriz 3×3 (fila mayor). */
function inv3(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

export class SampleVolumeIQ {
  private scatterers: Scatterer[] = [];
  private particleAmplitudeScale = 1;
  private rng: SeededRandom;
  private tick = 0;
  private weightEpoch = 0;
  private gate: GateGeometry | null = null;
  /** Transmisión aplicada (suavizada hacia la de la puerta); NaN hasta la primera puerta. */
  private transmissionNow = Number.NaN;
  private equipment: GateEquipment = { prfHz: 2500, f0Hz: 2.5e6, gain: 1 };
  private halfAxial = 4;
  private halfLateral = 5;
  private halfElev = 6;
  private composition: GateComposition = { bloodFraction: 0, bloodWeight: 0, arterialFraction: 0, wallFraction: 0, vessels: {} };
  /**
   * Mapa de la llamada, material → mundo lineal en el centro de la puerta: mundo = w0 + J·(m − tc) + Δk, con Δk el
   * desplazamiento rígido del pulso k respecto del final de la llamada; puerta = A·m + b + G·Δk. Se recalcula solo si
   * cambian la respiración, la compresión o la puerta (época nueva).
   */
  private tc: Vec3 = [0, 0, 0];
  private w0: Vec3 = [0, 0, 0];
  private Jinv: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private A: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private b: Vec3 = [0, 0, 0];
  private mapKey: readonly unknown[] = [];
  private mapEpoch = 0;
  /** Δ del pulso en curso (mundo): el de las entradas y siembras que se crean en él. */
  private delta: Vec3 = [0, 0, 0];
  private phys: PhysiologySample | null = null;
  /** Zonas de unión por definición de vaso (solape real de luces cerca de la caja). */
  private junctions = new Map<VesselDef, JunctionZone[]>();
  /** Sección del instante por vaso, de la fisiología de la llamada. */
  private sections = new Map<VesselDef, Section>();
  private scratch: Vec3 = [0, 0, 0];

  constructor(
    private readonly anatomy: AnatomyQuery,
    seed: number,
    /** Uncached reference path for exact IQ parity tests. */
    private readonly cacheStationaryTissue = true,
  ) {
    this.rng = new SeededRandom(seed ^ 0xd0991e);
  }

  /** Numerical population only; not a physiological blood-cell count. */
  get particleCount(): number {
    return this.scatterers.length;
  }

  get lastComposition(): GateComposition {
    return this.composition;
  }

  setEquipment(e: Partial<GateEquipment>): void {
    this.equipment = { ...this.equipment, ...e };
  }

  /** Cambia la geometría de la puerta; si se movió mucho, resiembra los dispersores. */
  setGate(g: GateGeometry, phys: PhysiologySample): void {
    const moved =
      !this.gate ||
      Math.hypot(g.center[0] - this.gate.center[0], g.center[1] - this.gate.center[1], g.center[2] - this.gate.center[2]) >
        0.5 * this.halfAxial ||
      Math.abs(g.lengthMm - this.gate.lengthMm) > 0.5;
    this.gate = g;
    if (!Number.isFinite(this.transmissionNow)) this.transmissionNow = g.transmission;
    this.halfAxial = g.lengthMm / 2 + 2.5 * g.pulseSigmaMm;
    this.halfLateral = 2.5 * g.lateralSigmaMm;
    this.halfElev = 2.5 * g.elevationSigmaMm;
    if (moved || this.scatterers.length === 0) {
      this.delta = [0, 0, 0];
      this.prepareMap(phys);
      this.reseed(phys);
    }
  }

  /** Mapa material → mundo de la llamada (cuatro evaluaciones de la deformación), solo si cambió su entrada. */
  private prepareMap(phys: PhysiologySample): void {
    this.phys = phys;
    const d = this.anatomy.deformation;
    const g = this.gate!;
    const c = g.center;
    const key = [phys.resp.diaphragmCaudalMm, d.compression, c[0], c[1], c[2], ...g.beamDir, ...g.lateral, ...g.elevation];
    if (key.length === this.mapKey.length && key.every((v, i) => v === this.mapKey[i])) return;
    this.mapKey = key;
    this.mapEpoch++;
    const tc = d.toMaterial(c, phys.resp);
    const w0 = d.toWorld(tc, phys.resp);
    const h = 0.5;
    const J: number[] = new Array<number>(9);
    for (let j = 0; j < 3; j++) {
      const q: Vec3 = [tc[0], tc[1], tc[2]];
      q[j] += h;
      const w = d.toWorld(q, phys.resp);
      for (let i = 0; i < 3; i++) J[i * 3 + j] = (w[i] - w0[i]) / h;
    }
    const G = [g.beamDir, g.lateral, g.elevation];
    const v: Vec3 = [
      w0[0] - (J[0] * tc[0] + J[1] * tc[1] + J[2] * tc[2]) - c[0],
      w0[1] - (J[3] * tc[0] + J[4] * tc[1] + J[5] * tc[2]) - c[1],
      w0[2] - (J[6] * tc[0] + J[7] * tc[1] + J[8] * tc[2]) - c[2],
    ];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) this.A[i * 3 + j] = G[i][0] * J[j] + G[i][1] * J[3 + j] + G[i][2] * J[6 + j];
      this.b[i] = G[i][0] * v[0] + G[i][1] * v[1] + G[i][2] * v[2];
    }
    this.tc = tc;
    this.w0 = w0;
    this.Jinv = inv3(J);
  }

  /** Coordenadas de puerta del punto material `m` con el desplazamiento `delta` (mundo) del pulso. */
  private gateOf(m: Vec3, delta: Vec3, out: Vec3): void {
    const A = this.A,
      b = this.b,
      g = this.gate!;
    const G0 = g.beamDir,
      G1 = g.lateral,
      G2 = g.elevation;
    out[0] = A[0] * m[0] + A[1] * m[1] + A[2] * m[2] + b[0] + G0[0] * delta[0] + G0[1] * delta[1] + G0[2] * delta[2];
    out[1] = A[3] * m[0] + A[4] * m[1] + A[5] * m[2] + b[1] + G1[0] * delta[0] + G1[1] * delta[1] + G1[2] * delta[2];
    out[2] = A[6] * m[0] + A[7] * m[1] + A[8] * m[2] + b[2] + G2[0] * delta[0] + G2[1] * delta[1] + G2[2] * delta[2];
  }

  private inside(c: Vec3): boolean {
    return Math.abs(c[0]) <= this.halfAxial && Math.abs(c[1]) <= this.halfLateral && Math.abs(c[2]) <= this.halfElev;
  }

  /** Posición uniforme en la caja, en coordenadas de la puerta. */
  private randomInBox(): Vec3 {
    return [
      this.rng.range(-this.halfAxial, this.halfAxial),
      this.rng.range(-this.halfLateral, this.halfLateral),
      this.rng.range(-this.halfElev, this.halfElev),
    ];
  }

  private gateToWorld(c: Vec3): Vec3 {
    const g = this.gate!;
    return [
      g.center[0] + g.beamDir[0] * c[0] + g.lateral[0] * c[1] + g.elevation[0] * c[2],
      g.center[1] + g.beamDir[1] * c[0] + g.lateral[1] * c[1] + g.elevation[1] * c[2],
      g.center[2] + g.beamDir[2] * c[0] + g.lateral[2] * c[1] + g.elevation[2] * c[2],
    ];
  }

  private worldToGate(w: Vec3): Vec3 {
    const g = this.gate!;
    const dx = w[0] - g.center[0];
    const dy = w[1] - g.center[1];
    const dz = w[2] - g.center[2];
    return [
      dx * g.beamDir[0] + dy * g.beamDir[1] + dz * g.beamDir[2],
      dx * g.lateral[0] + dy * g.lateral[1] + dz * g.lateral[2],
      dx * g.elevation[0] + dy * g.elevation[1] + dz * g.elevation[2],
    ];
  }

  /** Dirección (mundo) de un desplazamiento en coordenadas de puerta. */
  private gateVectorToWorld(c: Vec3): Vec3 {
    const g = this.gate!;
    return [
      g.beamDir[0] * c[0] + g.lateral[0] * c[1] + g.elevation[0] * c[2],
      g.beamDir[1] * c[0] + g.lateral[1] * c[1] + g.elevation[1] * c[2],
      g.beamDir[2] * c[0] + g.lateral[2] * c[1] + g.elevation[2] * c[2],
    ];
  }

  /** Punto material del mapa lineal (su mundo es exactamente `world`) en el pulso de `delta`. */
  private materialOf(world: Vec3, delta: Vec3): Vec3 {
    const J = this.Jinv;
    const x = world[0] - delta[0] - this.w0[0],
      y = world[1] - delta[1] - this.w0[1],
      z = world[2] - delta[2] - this.w0[2];
    return [
      this.tc[0] + J[0] * x + J[1] * y + J[2] * z,
      this.tc[1] + J[3] * x + J[4] * y + J[5] * z,
      this.tc[2] + J[6] * x + J[7] * y + J[8] * z,
    ];
  }

  private caliber(): VesselCaliber {
    return this.anatomy.caliberFor(this.phys!);
  }

  /** Sección del instante del vaso (calibre, semieje AP, forma), una vez por fisiología. */
  private sectionOf(def: VesselDef): Section {
    const known = this.sections.get(def);
    if (known && known.phys === this.phys) return known;
    const caliber = this.caliber();
    const scale = caliber.radiusScale(def.id);
    const ap = vesselApScale(def.id, def.tube.apScale, caliber);
    const shape = ap === 1 && def.tube.shape ? shapeMetric(def.tube.shape, scale) : null;
    const sec: Section = { phys: this.phys, scale, ap, wt: shape ? shape.wt : null, c: shape ? shape.c : 1 };
    this.sections.set(def, sec);
    return sec;
  }

  /**
   * Punto material de la corriente con el radio del tubo en él y el calibre de la siembra (reancla `r` y la importancia),
   * y su radio normalizado en la sección del instante con el perfil que le toca (`Stream.rho`).
   */
  private streamPoint(st: Stream, out: Vec3): void {
    const g = st.geom,
      i = st.seg,
      s = st.s;
    const r = radiusAt(st, i, s, st.scaleSeed);
    st.r = r;
    st.rel = r / (st.rGeoSeed * st.scaleSeed);
    const ox = st.off[0] * r,
      oy = st.off[1] * r,
      oz = st.off[2] * r;
    out[0] = g.a[i][0] + g.ab[i][0] * s + ox;
    out[1] = g.a[i][1] + g.ab[i][1] * s + oy;
    out[2] = g.a[i][2] + g.ab[i][2] * s + oz;
    let sec = st.sec;
    if (sec.phys !== this.phys) sec = st.sec = this.sectionOf(st.def);
    st.grow = sec.scale / st.scaleSeed;
    const o = st.off0;
    const rhoK = sectionDist(sec, o[0], o[1], o[2], 0, g.t[i]) / st.grow;
    st.rho = s < 0 || s > 1 ? sectionDist(sec, ox, oy, oz, s < 0 ? s * g.len[i] : (s - 1) * g.len[i], g.t[i]) / (r * st.grow) : rhoK;
    st.k = st.rho < 1 && rhoK < 1 ? radialProfile(rhoK, st.n, st.ff) : 0;
  }

  /**
   * Corriente del tubo que la clasificación eligió para la sangre del punto material `m`. Solo si la escena resuelve ese
   * tubo y su base de flujo es la de la clasificación: la sangre de un clasificador sintético (fantomas analíticos)
   * conserva el transporte recto.
   */
  private streamAt(m: Vec3, flowBasis: Vec3 | null): Stream | null {
    const scene = this.anatomy.scene;
    if (!flowBasis || typeof scene.vesselTubeAt !== 'function') return null;
    const caliber = this.caliber();
    const found = scene.vesselTubeAt(m, caliber);
    if (!found || found.hit.d >= 0) return null;
    const { def, hit } = found;
    const n = (scene.vesselById.get(def.id) ?? def).profileN;
    const ff = def.flowFactor ?? 1;
    const k = radialProfile(Math.min(1, hit.rho), n, ff);
    const tg = hit.tangent;
    if (Math.abs(tg[0] * k - flowBasis[0]) + Math.abs(tg[1] * k - flowBasis[1]) + Math.abs(tg[2] * k - flowBasis[2]) > 1e-9) return null;
    const geom = tubeGeom(def.tube);
    const i = hit.segment;
    const r = hit.r;
    const t = geom.t[i];
    const off: Vec3 = [
      (m[0] - geom.a[i][0] - geom.ab[i][0] * hit.s) / r,
      (m[1] - geom.a[i][1] - geom.ab[i][1] * hit.s) / r,
      (m[2] - geom.a[i][2] - geom.ab[i][2] * hit.s) / r,
    ];
    // En un casquete el punto queda fuera del segmento: esa parte axial es arco (s fuera de [0, 1]).
    const along = off[0] * t[0] + off[1] * t[1] + off[2] * t[2];
    const perp: Vec3 = [off[0] - along * t[0], off[1] - along * t[1], off[2] - along * t[2]];
    const scale = caliber.radiusScale(def.id);
    return {
      def,
      geom,
      seg: i,
      s: hit.s + (along * r) / geom.len[i],
      off: perp,
      off0: [perp[0], perp[1], perp[2]],
      rho: hit.rho,
      k,
      n,
      ff,
      sec: this.sectionOf(def),
      r,
      rel: 1,
      scaleSeed: scale,
      rGeoSeed: r / scale,
      grow: 1,
      chord: -1,
      chordEpoch: -1,
      domainLeft: 0,
    };
  }

  /**
   * Dispersor nuevo en el punto del mundo `world` del pulso en curso (`this.delta`), con la identidad del punto. Su punto
   * material es el del mapa lineal (su mundo es `world`); la sangre recibe la corriente del tubo que eligió la
   * clasificación. `ramp`: entra en rampa (siembra al azar, tejido); si no, con su amplitud (sangre por una cara).
   */
  private makeScatterer(world: Vec3, phys: PhysiologySample, ramp: boolean): Scatterer {
    const d = this.delta;
    // La identidad es la del punto material del mapa (el que tendrá el dispersor): con la cizalla respiratoria junto a la
    // columna, el mapa lineal y la deformación exacta difieren hasta ~1 mm en la caja y clasificar `world` dejaría
    // identidad y posición incoherentes.
    const m = this.materialOf(world, d);
    const q = this.anatomy.classifyMaterial(m, phys);
    const isBlood = q.tissue === Tissue.Blood && q.bloodVelocity !== null;
    const stream = isBlood ? this.streamAt(m, q.flowBasis) : null;
    const phase = this.rng.float() * 2 * Math.PI;
    const amp = TISSUES[q.tissue].backscatter * (0.7 + 0.6 * this.rng.float());
    if (stream) this.streamPoint(stream, m);
    const s: Scatterer = {
      m,
      g: [0, 0, 0],
      amp: 0,
      apAngle: this.rng.gaussian(),
      cr: Math.cos(phase),
      ci: Math.sin(phase),
      rotC: 1,
      rotS: 0,
      fresh: true,
      fading: false,
      exitMotion: [0, 0, 0],
      dAmp: 0,
      rampLeft: 0,
      vessel: q.vessel,
      isBlood,
      vBlood: q.bloodVelocity ?? [0, 0, 0],
      flowBasis: q.flowBasis ?? [0, 0, 0],
      tissue: q.tissue,
      weightEpoch: -1,
      stationaryWeight: 0,
      stream,
      pending: null,
      lumen: null,
      imp: 1,
      ampImp: 1,
    };
    this.gateOf(m, d, s.g);
    // Todo dispersor sembrado al azar entra en rampa: el tejido (40 dB sobre la sangre) y también la sangre, que puede
    // aparecer en el centro de la puerta; de golpe era una línea vertical en el espectrograma.
    if (ramp || !isBlood) startAmpRamp(s, amp);
    else s.amp = amp;
    return s;
  }

  private randomScatterer(phys: PhysiologySample): Scatterer {
    return this.makeScatterer(this.gateToWorld(this.randomInBox()), phys, true);
  }

  private reseed(phys: PhysiologySample): void {
    this.findJunctions();
    this.scatterers.length = 0;
    for (let i = 0; i < N_SCATTERERS; i++) this.scatterers.push(this.randomScatterer(phys));
    this.updateComposition();
    // Numerical refinement for a small lumen relative to the lateral beam.
    // Geometry and observable sample-volume weight only; never case or grade.
    const refine = Object.entries(this.composition.vessels).some(([id, weight]) => {
      const vessel = this.anatomy.scene.vesselById.get(id as VesselId);
      return weight >= 0.02 && vessel && Math.max(...vessel.tube.nodes.map((n) => n.r)) <= 2 * this.gate!.lateralSigmaMm;
    });
    if (refine) {
      for (let i = N_SCATTERERS; i < 4 * N_SCATTERERS; i++)
        this.scatterers.push(this.randomScatterer(phys));
      this.updateComposition();
    }
    this.particleAmplitudeScale = particleAmplitudeScale(this.scatterers.length);
  }

  /**
   * Uniones cerca de la caja: para cada vaso, los tubos cuya luz puede solapar la suya y la caja material de ese solape, la
   * intersección de las cajas de los segmentos que están más cerca que la suma de sus radios. Fuera de esas cajas una corriente no
   * necesita consultar a nadie: en ellas vale solo donde su tubo gana la clasificación. Los radios llevan el calibre del instante
   * (hasta ×1,25 si crece después de sembrar, sin volver a buscar) y 0,5 mm. Estimarlas con muestras dejaba fuera parte del solape:
   * hasta un 3,7 % del peso sonaba con la corriente de otro tubo.
   */
  private findJunctions(): void {
    this.junctions.clear();
    const scene = this.anatomy.scene;
    if (typeof scene.vesselTubeAt !== 'function') return;
    const center = this.tc;
    const reach = Math.hypot(this.halfAxial, this.halfLateral, this.halfElev) + 20;
    type Near = { duct: boolean; def: VesselDef | DuctDef; segs: Array<[Vec3, Vec3, number]> };
    const near: Near[] = [];
    const caliber = this.caliber();
    const collect = (duct: boolean, def: VesselDef | DuctDef, bound: { center: Vec3; r: number }) => {
      const b = bound.center;
      if (Math.hypot(b[0] - center[0], b[1] - center[1], b[2] - center[2]) > bound.r + reach) return;
      const segs: Array<[Vec3, Vec3, number]> = [];
      const n = def.tube.nodes;
      const scale = 1.25 * (duct ? 1 : Math.max(1, caliber.radiusScale((def as VesselDef).id)));
      for (let i = 0; i < n.length - 1; i++) {
        const r = Math.max(n[i].r, n[i + 1].r);
        if (segPointDist(n[i].p, n[i + 1].p, center) <= reach + r) segs.push([n[i].p, n[i + 1].p, scale * r + 0.5]);
      }
      if (segs.length) near.push({ duct, def, segs });
    };
    scene.vessels.forEach((def, i) => collect(false, def, scene.tubeBounds[i]));
    scene.ducts.forEach((def, i) => collect(true, def, scene.tubeBounds[scene.vessels.length + i]));
    for (const x of near) {
      if (x.duct) continue;
      const zones: JunctionZone[] = [];
      for (const y of near) {
        if (y === x) continue;
        const lo: Vec3 = [Infinity, Infinity, Infinity],
          hi: Vec3 = [-Infinity, -Infinity, -Infinity];
        for (const [a, b, ra] of x.segs)
          for (const [c, d, rb] of y.segs) {
            if (segSegDist(a, b, c, d) >= ra + rb) continue;
            for (let i = 0; i < 3; i++) {
              lo[i] = Math.min(lo[i], Math.max(Math.min(a[i], b[i]) - ra, Math.min(c[i], d[i]) - rb));
              hi[i] = Math.max(hi[i], Math.min(Math.max(a[i], b[i]) + ra, Math.max(c[i], d[i]) + rb));
            }
          }
        if (lo[0] < Infinity) zones.push({ duct: y.duct, def: y.def, lo, hi });
      }
      if (zones.length) this.junctions.set(x.def as VesselDef, zones);
    }
  }

  /** ¿Gana la clasificación el tubo de la corriente en el punto material `m`? (la búsqueda de `bestTube`, con sus socios). */
  private ownsPoint(st: Stream, m: Vec3): boolean {
    return this.domainArc(st, m) >= 0;
  }

  /**
   * Arco (mm) que la corriente puede recorrer desde `m` sin dejar de ganar la clasificación, o negativo si ya no la gana. Evita
   * consultar los tubos en cada pulso: basta con hacerlo cerca del reparto. Es la distancia a la caja de cada zona, a la pared del
   * socio o, dentro de ella, lo que su distancia a la luz le saca a la propia, dividido por lo rápido que puede acercarse: la del socio
   * cambia hasta 1 mm/mm, y hasta 1/AP con el semieje AP de la cava (AP 0,3: 3,33 mm/mm); la propia casi no cambia a lo largo de la
   * corriente, que conserva su radio normalizado, salvo en un casquete. El ×0,8 cubre la métrica de la forma orgánica (hasta
   * 1,17 mm/mm), el ruido del radio y el afilamiento, que no se miden aquí.
   */
  private domainArc(st: Stream, m: Vec3): number {
    const zones = this.junctions.get(st.def);
    if (!zones) return Infinity;
    let caliber: VesselCaliber | null = null;
    let own = Number.NaN;
    let arc = Infinity;
    for (const z of zones) {
      const outside = Math.max(z.lo[0] - m[0], m[0] - z.hi[0], z.lo[1] - m[1], m[1] - z.hi[1], z.lo[2] - m[2], m[2] - z.hi[2]);
      if (outside > 0) {
        arc = Math.min(arc, outside);
        continue;
      }
      caliber ??= this.caliber();
      const tube = z.duct ? z.def.tube : instantTube(z.def as VesselDef, caliber);
      const hit = tubeQuery(m, tube, z.duct ? 1 : caliber.radiusScale(z.def.id as VesselId));
      const wall = z.duct ? (z.def as DuctDef).wallMm : wallThicknessMm(z.def as VesselDef, hit.r);
      const rate = 1 / Math.min(1, tube.apScale);
      if (!(hit.d < wall)) {
        arc = Math.min(arc, (hit.d - wall) / rate);
        continue;
      }
      // la distancia propia exacta (forma orgánica, semieje AP, casquetes): una aproximación por |off| erraba ~1 mm en la
      // confluencia portal y dejaba un 6 % del peso sanguíneo en la rama equivocada
      if (Number.isNaN(own)) own = tubeQuery(m, instantTube(st.def, caliber), caliber.radiusScale(st.def.id)).d;
      if (hit.d < own) return -1;
      arc = Math.min(arc, (hit.d - own) / (rate + (inCap(st) ? 1 : 0)));
    }
    return 0.8 * arc;
  }

  /**
   * Imagen periódica del punto de puerta `c` en la caja a lo largo de `along` (mundo, sentido de la salida): la envoltura de
   * su cuerda, por la cara opuesta. null si `along` es nulo o la recta no cruza la caja.
   */
  private chordImage(c: Vec3, along: Vec3): Vec3 | null {
    const g = this.gate!;
    const dv = this.worldToGate([g.center[0] - along[0], g.center[1] - along[1], g.center[2] - along[2]]);
    const speed = Math.hypot(dv[0], dv[1], dv[2]);
    if (speed <= 1e-12) return null;
    const h = [this.halfAxial, this.halfLateral, this.halfElev];
    let tIn = -Infinity;
    let tOut = Infinity;
    for (let i = 0; i < 3; i++) {
      dv[i] /= speed;
      // con dv = 0 los dos cortes son ±∞: dentro de esa franja no limitan; fuera, dejan la cuerda vacía
      const t1 = (-h[i] - c[i]) / dv[i];
      const t2 = (h[i] - c[i]) / dv[i];
      tIn = Math.max(tIn, Math.min(t1, t2));
      tOut = Math.min(tOut, Math.max(t1, t2));
    }
    if (!(tIn < tOut)) return null;
    const chord = tOut - tIn;
    const t = (Math.floor(tIn / chord) + 1) * chord;
    return [c[0] + dv[0] * t, c[1] + dv[1] * t, c[2] + dv[2] * t];
  }

  /** Entrada por movimiento: por la cara opuesta a lo largo de `motion` (mundo), envoltura periódica de la cuerda. */
  private motionEntry(exitGate: Vec3, motion: Vec3, phys: PhysiologySample): Scatterer {
    const entry = this.chordImage(exitGate, motion);
    return this.makeScatterer(this.gateToWorld(entry ?? this.randomInBox()), phys, !entry);
  }

  /**
   * ¿Es válido el punto de la corriente: en la caja (con `delta`), en la luz del instante de su tubo (también en un
   * casquete) y en su dominio? Una reentrada no legitima una corriente que la luz dejó fuera.
   */
  private validOnStream(st: Stream, delta: Vec3, m: Vec3, c: Vec3): boolean {
    this.streamPoint(st, m);
    this.gateOf(m, delta, c);
    return this.inside(c) && st.rho < 1 && this.ownsPoint(st, m);
  }

  /**
   * Reentrada aguas arriba por la propia corriente (sangre que salió de la caja, de la luz o de su dominio por el flujo),
   * conservando el sobrepaso: retrocede la cuerda válida de la corriente. Con el mismo mapa se reutiliza la cuerda medida si el
   * punto de llegada es válido. Con el mapa cambiado (la caja se mueve respecto del material) la cuerda anterior solo orienta la
   * búsqueda de los dos cruces: reutilizarla tal cual (50 ms) dejaba la porta respirando en 0,905 de una siembra nueva frente a
   * 0,933 midiéndola (16 semillas). `step`: arco (mm) en que pudo cruzar la salida, 0 si no se sabe (sangre que ya estaba fuera).
   */
  private wrapUpstream(p: Scatterer, delta: Vec3, dir: number, step: number): boolean {
    const st = p.stream!;
    const m: Vec3 = [0, 0, 0],
      c: Vec3 = [0, 0, 0];
    const at = (d: number): boolean => {
      const x = cloneStream(st);
      return advanceStream(x, -dir * d) && this.validOnStream(x, delta, m, c);
    };
    // con el mismo mapa la cuerda medida sigue valiendo si la llegada es válida y un paso más allá ya no: una luz que cambió en un
    // casquete con el mismo mapa la alarga
    if (st.chord > 0 && st.chordEpoch === this.mapEpoch && at(st.chord) && !(step > 0 && at(st.chord + step)) && this.placeUpstream(p, dir, st.chord))
      return true;
    if (st.chord > 0 && step > 0) {
      // La salida está dentro del último paso y la entrada, cerca de donde la dejaba la cuerda anterior. Los dos cruces son de
      // la caja o, dentro de ella, de la luz o del dominio de la unión.
      const inBox = (d: number): boolean => {
        const x = cloneStream(st);
        if (!advanceStream(x, -dir * d)) return false;
        this.streamPoint(x, m);
        this.gateOf(m, delta, c);
        return this.inside(c) && x.rho < 1;
      };
      const cross = (inner: number, outer: number): number => {
        const d = this.boxCrossing(st, delta, dir, inner, outer);
        return d >= 0 ? d : inner < outer ? this.bisect(inBox, inner, outer, false) : this.bisect(inBox, outer, inner, true);
      };
      const in0 = inBox(0);
      if (in0 ? !at(0) && at(step) : inBox(step)) {
        const dOut = in0 ? this.bisect(at, 0, step, true) : cross(step, 0);
        const lo = dOut + st.chord - 0.3,
          hi = dOut + st.chord + 0.3;
        if (at(lo) && !at(hi)) {
          const chord = (inBox(hi) ? this.bisect(at, lo, hi, false) : cross(lo, hi)) - dOut;
          if (chord > 0 && at(chord) && this.placeUpstream(p, dir, chord)) return true;
        }
      }
    }
    const maxMm = 4 * Math.hypot(this.halfAxial, this.halfLateral, this.halfElev);
    let prevValid = at(0);
    // dOut: distancia aguas arriba hasta volver a lo válido (0 si sigue en la caja: llegó al extremo del tubo dentro de
    // ella); dIn: hasta dejarlo otra vez (borde de la caja, del casquete o de la unión aguas arriba)
    let dOut = prevValid ? 0 : -1;
    let dIn = -1;
    let prevD = 0;
    for (let d = WRAP_STEP_MM; d <= maxMm + 1e-9; d += WRAP_STEP_MM) {
      const valid = at(d);
      if (dOut < 0 && valid) dOut = this.bisect(at, prevD, d, true);
      if (dOut >= 0 && !valid && prevValid) {
        dIn = this.bisect(at, prevD, d, false);
        break;
      }
      prevValid = valid;
      prevD = d;
    }
    if (dOut < 0 || dIn < 0) return false;
    // la imagen periódica dentro de la parte válida: un sobrepaso mayor que la cuerda (al respirar, la unión entra en la caja
    // y acorta la del tronco) da más de una vuelta. Con una sola, la sangre volvía a caer en el dominio de la otra rama y
    // quedaba allí
    // (a una decena de nanómetros, el error de la bisección, del cruce de entrada: si no, la llegada podía caer justo fuera de la luz
    // de un casquete y convertirse en tejido)
    const chord = dIn - dOut;
    return chord > 0 && this.placeUpstream(p, dir, chord, Math.min(chord * (Math.floor(dOut / chord) + 1), dIn - 1e-5));
  }

  /**
   * Retrocede `shift` mm por la corriente (envoltura periódica con el sobrepaso: un múltiplo de la cuerda) y guarda la
   * cuerda.
   */
  private placeUpstream(p: Scatterer, dir: number, chord: number, shift = chord): boolean {
    const st = p.stream!;
    const x = cloneStream(st);
    if (!advanceStream(x, -dir * shift)) return false;
    Object.assign(st, x);
    st.chord = chord;
    st.chordEpoch = this.mapEpoch;
    this.renewBlood(p);
    return true;
  }

  /**
   * Cruce de la cara de la caja entre `inner` (dentro) y `outer` (fuera), a esas distancias aguas arriba: a esta escala la
   * corriente es recta y basta cortar la cara con la recta. −1 si no se corta (limita la luz de un casquete) o hay un nodo por
   * medio.
   */
  private boxCrossing(st: Stream, delta: Vec3, dir: number, inner: number, outer: number): number {
    const m: Vec3 = [0, 0, 0],
      a: Vec3 = [0, 0, 0],
      b: Vec3 = [0, 0, 0];
    const x = cloneStream(st),
      y = cloneStream(st);
    if (!advanceStream(x, -dir * inner) || !advanceStream(y, -dir * outer) || x.seg !== y.seg || inCap(x) || inCap(y)) return -1;
    this.streamPoint(x, m);
    this.gateOf(m, delta, a);
    this.streamPoint(y, m);
    this.gateOf(m, delta, b);
    const h = [this.halfAxial, this.halfLateral, this.halfElev];
    let t = Infinity;
    for (let i = 0; i < 3; i++) if (Math.abs(b[i]) > h[i]) t = Math.min(t, ((b[i] > 0 ? h[i] : -h[i]) - a[i]) / (b[i] - a[i]));
    return t >= 0 && t <= 1 ? inner + (outer - inner) * t : -1;
  }

  /** Cruce entre lo (lado contrario) y hi (lado `toValid`) a lo largo de la corriente: el centro del intervalo final, sin sesgo. */
  private bisect(at: (d: number) => boolean, lo: number, hi: number, toValid: boolean): number {
    for (let i = 0; i < WRAP_BISECT; i++) {
      const mid = 0.5 * (lo + hi);
      if (at(mid) === toValid) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Otro hematíe en la misma corriente: fase, amplitud y ángulo de apertura nuevos, en su punto y con su importancia. */
  private renewBlood(p: Scatterer): void {
    // otro hematíe en un punto que la reentrada validó en la luz del instante: un cambio de identidad pendiente era del
    // anterior
    p.pending = null;
    const phase = this.rng.float() * 2 * Math.PI;
    p.cr = Math.cos(phase);
    p.ci = Math.sin(phase);
    p.amp = TISSUES[Tissue.Blood].backscatter * (0.7 + 0.6 * this.rng.float());
    p.apAngle = this.rng.gaussian();
    p.rampLeft = 0;
    p.dAmp = 0;
    p.fresh = true;
    p.stream!.domainLeft = 0;
    this.streamPoint(p.stream!, p.m);
    p.ampImp = p.stream!.rel;
    p.imp = p.ampImp * p.ampImp;
  }

  private updateComposition(): void {
    let blood = 0;
    let art = 0;
    let wall = 0;
    const vessels: Partial<Record<VesselId, number>> = {};
    let wsum = 0;
    for (const s of this.scatterers) {
      const w = this.weightAt(s.g) * s.imp;
      wsum += w;
      if (s.isBlood) {
        blood += w;
        if (s.vessel && VESSEL_META[s.vessel].kind === 'artery') art += w;
        if (s.vessel) vessels[s.vessel] = (vessels[s.vessel] ?? 0) + w;
      } else if (s.tissue === Tissue.VesselWallPortal || s.tissue === Tissue.VesselWallThin || s.tissue === Tissue.ArteryWall) {
        wall += w;
      }
    }
    if (wsum > 0) {
      for (const k of Object.keys(vessels) as VesselId[]) vessels[k] = vessels[k]! / wsum;
    }
    this.composition = {
      bloodFraction: wsum > 0 ? blood / wsum : 0,
      bloodWeight: this.scatterers.length > 0 ? blood / this.scatterers.length : 0,
      arterialFraction: wsum > 0 ? art / wsum : 0,
      wallFraction: wsum > 0 ? wall / wsum : 0,
      vessels,
    };
  }

  /** Peso del haz/puerta en unas coordenadas de puerta: ventana de puerta suavizada por el pulso, lateral y elevación. */
  private weightAt(c: Vec3): number {
    const g = this.gate!;
    const half = g.lengthMm / 2;
    const ps = Math.max(0.2, g.pulseSigmaMm);
    const axialW = 0.5 * (pulseErf((half - c[0]) / (ps * Math.SQRT2)) + pulseErf((half + c[0]) / (ps * Math.SQRT2)));
    return axialW * Math.exp(-0.5 * ((c[1] / g.lateralSigmaMm) ** 2 + (c[2] / g.elevationSigmaMm) ** 2));
  }

  /** Sangre sin tubo (clasificador sintético): reentra por el extremo opuesto de su recta, con su identidad (decisión 48). */
  private chordReenter(exited: Scatterer, phys: PhysiologySample): Scatterer {
    const v = exited.vBlood;
    const entry = Math.hypot(v[0], v[1], v[2]) > 1e-6 ? this.chordImage(exited.g, v) : null;
    if (!entry) return this.randomScatterer(phys);
    const phase = this.rng.float() * 2 * Math.PI;
    return {
      ...exited,
      m: this.materialOf(this.gateToWorld(entry), this.delta),
      g: entry,
      amp: TISSUES[exited.tissue].backscatter * (0.7 + 0.6 * this.rng.float()),
      apAngle: this.rng.gaussian(),
      cr: Math.cos(phase),
      ci: Math.sin(phase),
      rotC: 1,
      rotS: 0,
      fresh: true,
      fading: false,
      dAmp: 0,
      rampLeft: 0,
      weightEpoch: -1,
    };
  }

  /**
   * Genera `n` muestras IQ a la PRF actual con la muestra fisiológica dada y la
   * velocidad de la sonda (mm/s, mundo). Escribe en `re`/`im` desde `offset`.
   */
  generate(phys: PhysiologySample, probeVelocity: Vec3, n: number, re: Float32Array, im: Float32Array, offset = 0): void {
    const g = this.gate;
    if (!g) {
      re.fill(0, offset, offset + n);
      im.fill(0, offset, offset + n);
      return;
    }
    const dt = 1 / this.equipment.prfHz;
    const f0 = this.equipment.f0Hz;
    const bHat: Vec3 = [-g.beamDir[0], -g.beamDir[1], -g.beamDir[2]];
    const apSigma = g.apertureAngleSigmaRad ?? 0;
    // La deformación se evalúa en el centro de la puerta (varía lentamente): el desplazamiento dentro de la llamada es
    // el rígido de ese punto, Δk = −v·(tiempo hasta el final), y el mapa es el del final de la llamada.
    const tissueVel = this.anatomy.deformation.tissueVelocity(g.center, phys.resp);
    const epoch = this.mapEpoch;
    this.prepareMap(phys);
    const deltaPrev: Vec3 = [-tissueVel[0] * n * dt, -tissueVel[1] * n * dt, -tissueVel[2] * n * dt];
    // Paso de movimiento del mapa nuevo (respiración, compresión): quien sale de la caja cede su sitio a otro que entra
    // por la cara opuesta a lo largo de su movimiento; el tejido sale en rampa. Con el mapa de antes no se mueve nada.
    const c: Vec3 = [0, 0, 0];
    for (let j = 0; this.mapEpoch !== epoch && j < this.scatterers.length; j++) {
      const s = this.scatterers[j];
      const was = !s.fading && this.inside(s.g);
      const o0 = s.g[0],
        o1 = s.g[1],
        o2 = s.g[2];
      this.gateOf(s.m, deltaPrev, c);
      if (was && !this.inside(c)) {
        const motion = this.gateVectorToWorld([c[0] - o0, c[1] - o1, c[2] - o2]);
        if (s.isBlood) {
          this.delta = deltaPrev;
          this.scatterers[j] = this.motionEntry([c[0], c[1], c[2]], motion, phys);
          continue;
        }
        s.fading = true;
        s.exitMotion = motion;
        startAmpRamp(s, 0);
      }
      s.g[0] = c[0];
      s.g[1] = c[1];
      s.g[2] = c[2];
    }
    const twoPiDt = 2 * Math.PI * dt;
    const weightEpoch = ++this.weightEpoch;
    const stationaryTissue = this.cacheStationaryTissue && tissueVel.every((v) => v === 0);
    const A = this.A,
      B = this.b;
    const G0 = g.beamDir,
      G1 = g.lateral,
      G2 = g.elevation;
    const hA = this.halfAxial,
      hL = this.halfLateral,
      hE = this.halfElev;
    const half = g.lengthMm / 2;
    const invPs = 1 / (Math.max(0.2, g.pulseSigmaMm) * Math.SQRT2);
    const invLat2 = 1 / (g.lateralSigmaMm * g.lateralSigmaMm);
    const invEl2 = 1 / (g.elevationSigmaMm * g.elevationSigmaMm);
    const vel = phys.velocities;
    const prev: Vec3 = [deltaPrev[0], deltaPrev[1], deltaPrev[2]];
    const delta: Vec3 = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      // Respiration is sampled on the physiology clock. Reconstruct its smooth
      // displacement at each emitted pulse instead of stepping tissue at 250 Hz.
      const untilEnd = (n - 1 - k) * dt;
      if (k > 0) {
        prev[0] = delta[0];
        prev[1] = delta[1];
        prev[2] = delta[2];
      }
      delta[0] = -tissueVel[0] * untilEnd;
      delta[1] = -tissueVel[1] * untilEnd;
      delta[2] = -tissueVel[2] * untilEnd;
      this.delta = delta;
      // puerta = A·m + b + G·Δ, en este pulso (bk) y en el anterior (bp)
      const bk0 = B[0] + G0[0] * delta[0] + G0[1] * delta[1] + G0[2] * delta[2];
      const bk1 = B[1] + G1[0] * delta[0] + G1[1] * delta[1] + G1[2] * delta[2];
      const bk2 = B[2] + G2[0] * delta[0] + G2[1] * delta[1] + G2[2] * delta[2];
      const bp0 = B[0] + G0[0] * prev[0] + G0[1] * prev[1] + G0[2] * prev[2];
      const bp1 = B[1] + G1[0] * prev[0] + G1[1] * prev[1] + G1[2] * prev[2];
      const bp2 = B[2] + G2[0] * prev[0] + G2[1] * prev[1] + G2[2] * prev[2];
      let sr = 0;
      let si = 0;
      const slow = this.tick % SLOW_EVERY === 0;
      const reclass = this.tick % RECLASSIFY_EVERY === 0;
      for (let j = 0; j < this.scatterers.length; j++) {
        let s = this.scatterers[j];
        const m = s.m;
        if (s.fading) {
          this.gateOf(m, delta, s.g);
          if (s.rampLeft <= 0) {
            // ya se apagó fuera: entra otro por la cara opuesta a lo largo de su salida
            s = this.motionEntry([s.g[0], s.g[1], s.g[2]], s.exitMotion, phys);
            this.scatterers[j] = s;
          }
        } else if (s.stream) {
          // Sangre: avanza por su corriente (paso de flujo, con el desplazamiento del pulso anterior)
          const st = s.stream;
          s.weightEpoch = -1;
          const wasInside = Math.abs(s.g[0]) <= hA && Math.abs(s.g[1]) <= hL && Math.abs(s.g[2]) <= hE;
          // en un casquete, con la sección de este instante ANTES de avanzar: si ya está fuera de la luz, la contrajo el calibre
          // (no la sacó el flujo) y no reentra; queda quieta (k = 0) y se convierte en el tick lento
          const m0 = m[0],
            m1 = m[1],
            m2 = m[2];
          let outBefore = false;
          if (inCap(st)) {
            if (st.sec.phys !== phys) this.streamPoint(st, m);
            outBefore = st.rho >= 1;
          }
          const dArc = st.k * (s.vessel ? vel[s.vessel] : 0) * dt;
          const segBefore = st.seg;
          const inTube = advanceStream(st, dArc);
          // el flujo la llevó a un casquete (donde cuenta su distancia al nodo extremo), a otro segmento o fuera del tubo
          const moved = inCap(st) || !inTube || st.seg !== segBefore;
          if (slow || moved) {
            this.streamPoint(st, m);
            s.ampImp = st.rel;
            s.imp = st.rel * st.rel;
          } else {
            // centro exacto y radio del último reanclaje
            const ga = st.geom.a[st.seg],
              gb = st.geom.ab[st.seg],
              of = st.off,
              r = st.r,
              t = st.s;
            m[0] = ga[0] + gb[0] * t + of[0] * r;
            m[1] = ga[1] + gb[1] * t + of[1] * r;
            m[2] = ga[2] + gb[2] * t + of[2] * r;
          }
          let f0x = A[0] * m[0] + A[1] * m[1] + A[2] * m[2] + bp0;
          let f1x = A[3] * m[0] + A[4] * m[1] + A[5] * m[2] + bp1;
          let f2x = A[6] * m[0] + A[7] * m[1] + A[8] * m[2] + bp2;
          let flowIn = Math.abs(f0x) <= hA && Math.abs(f1x) <= hL && Math.abs(f2x) <= hE;
          // Salida por flujo (caja, extremo del tubo o la luz en un casquete), o sangre que quedó fuera de la caja al entrar por
          // una cara (el mapa lineal la deja a centésimas): vuelve por su corriente en la caja del pulso anterior. Flujo y
          // movimiento se componen como dos mapas periódicos que conservan la medida (la reentrada por la corriente y después la
          // del movimiento por la cara opuesta), así que la llegada debe ser exacta: con un error mayor que el desplazamiento
          // respiratorio del pulso (~0,3 µm), la sangre recién reentrada no salía por movimiento cuando le tocaba y la población
          // se acumulaba junto a una cara. La que la luz deja fuera sin que el flujo la mueva (calibre, semieje AP) no reentra:
          // queda quieta (k = 0) y se convierte en el tick lento.
          const stray = !wasInside && !flowIn;
          const leftLumen = moved && st.rho >= 1 && !s.pending && !outBefore;
          // La salida del dominio de su tubo en una unión también es por flujo y se atiende aquí, antes del movimiento: atendida
          // después, la franja junto a la cara de entrada estaba vacía cuando esa cara avanzaba y el movimiento no sacaba a nadie
          // por ella, pero en la fase contraria sí entraba sangre. La porta respirando quedaba en ≈ 0,89 de una siembra nueva.
          st.domainLeft -= Math.abs(dArc);
          let leftDomain = false;
          if ((slow || st.domainLeft <= 0) && wasInside && flowIn && inTube && st.rho < 1 && !s.pending) {
            st.domainLeft = this.domainArc(st, m);
            if (st.domainLeft < 0) {
              // Si su punto anterior ya estaba fuera, no la sacó el flujo: lo movió la geometría (calibre, semieje AP). No reentra:
              // cambia de identidad en dos rampas, como la luz que crece o mengua, sin saltar aguas arriba. (El punto real, no
              // retroceder el arco: con otro radio caía a micras y tomaba por geometría los cruces por flujo.)
              leftDomain = this.ownsPoint(st, [m0, m1, m2]);
              if (!leftDomain) {
                s.pending = { ampFactor: 0.7 + 0.6 * this.rng.float() };
                startAmpRamp(s, 0);
              }
            }
          }
          if ((wasInside && (!inTube || !flowIn || leftLumen || leftDomain)) || stray) {
            if (!this.wrapUpstream(s, prev, dArc >= 0 ? 1 : -1, stray ? 0 : Math.abs(dArc) * 1.001 + 1e-9)) {
              this.delta = prev;
              s = this.randomScatterer(phys);
              this.delta = delta;
              this.scatterers[j] = s;
            }
            const mm = s.m;
            f0x = A[0] * mm[0] + A[1] * mm[1] + A[2] * mm[2] + bp0;
            f1x = A[3] * mm[0] + A[4] * mm[1] + A[5] * mm[2] + bp1;
            f2x = A[6] * mm[0] + A[7] * mm[1] + A[8] * mm[2] + bp2;
            flowIn = Math.abs(f0x) <= hA && Math.abs(f1x) <= hL && Math.abs(f2x) <= hE;
          }
          // paso de movimiento: este pulso es el anterior más G·(Δk − Δk−1)
          const g0 = f0x + (bk0 - bp0),
            g1 = f1x + (bk1 - bp1),
            g2 = f2x + (bk2 - bp2);
          s.g[0] = g0;
          s.g[1] = g1;
          s.g[2] = g2;
          if (s.isBlood && flowIn && !(Math.abs(g0) <= hA && Math.abs(g1) <= hL && Math.abs(g2) <= hE)) {
            s = this.motionEntry([g0, g1, g2], this.gateVectorToWorld([g0 - f0x, g1 - f1x, g2 - f2x]), phys);
            this.scatterers[j] = s;
          }
        } else if (s.isBlood) {
          // Sangre sin tubo (clasificador sintético): advección recta en coordenadas materiales
          s.weightEpoch = -1;
          m[0] += s.vBlood[0] * dt;
          m[1] += s.vBlood[1] * dt;
          m[2] += s.vBlood[2] * dt;
          this.gateOf(m, delta, s.g);
          // Transport at every emitted pulse, with periodic overshoot preserved: no density clumps at PRF/8.
          // The replacement already occupies this pulse's position: its echo is evaluated in this same pulse.
          if (!(Math.abs(s.g[0]) <= hA && Math.abs(s.g[1]) <= hL && Math.abs(s.g[2]) <= hE)) {
            s = this.chordReenter(s, phys);
            this.scatterers[j] = s;
          }
        } else if (!(stationaryTissue && s.weightEpoch === weightEpoch)) {
          // Tejido: punto material fijo; sale en rampa y su reemplazo entra por la cara opuesta
          const g0 = A[0] * m[0] + A[1] * m[1] + A[2] * m[2] + bk0,
            g1 = A[3] * m[0] + A[4] * m[1] + A[5] * m[2] + bk1,
            g2 = A[6] * m[0] + A[7] * m[1] + A[8] * m[2] + bk2;
          s.g[0] = g0;
          s.g[1] = g1;
          s.g[2] = g2;
          if (!(Math.abs(g0) <= hA && Math.abs(g1) <= hL && Math.abs(g2) <= hE)) {
            s.fading = true;
            s.exitMotion = [delta[0] - prev[0], delta[1] - prev[1], delta[2] - prev[2]];
            startAmpRamp(s, 0);
          }
        }
        if (slow && !s.fading && !s.pending) {
          // la luz del instante (calibre, semieje AP) dejó fuera a la corriente sin que el flujo la moviera, o vuelve a
          // contener al tejido que fue sangre en ella: la identidad cambia en dos rampas sin esperar a la visita de la
          // reclasificación (la sangre fuera queda quieta, k = 0)
          let change = s.stream !== null && s.stream.rho >= 1;
          if (s.lumen) {
            this.streamPoint(s.lumen, this.scratch);
            change = s.lumen.rho < 1;
          }
          if (change) {
            s.pending = { ampFactor: 0.7 + 0.6 * this.rng.float() };
            startAmpRamp(s, 0);
          }
        }
        if (slow && !s.fading && s.pending && s.rampLeft <= 0) {
          // la identidad vieja ya se apagó: se enciende la del punto material en este instante, no la de la visita (la luz
          // pudo seguir cambiando o volver durante la rampa); la sangre recibe la corriente de esa misma clasificación
          const ampFactor = s.pending.ampFactor;
          s.pending = null;
          const q = this.anatomy.classifyMaterial(s.m, phys);
          const blood = q.tissue === Tissue.Blood && q.bloodVelocity !== null;
          const stream = blood ? this.streamAt(s.m, q.flowBasis) : null;
          if (stream) this.streamPoint(stream, s.m);
          // el tejido que deja la sangre de una corriente la recuerda, quieta en su punto, para cuando la luz vuelva
          s.lumen = !blood && s.stream ? s.stream : null;
          s.isBlood = blood;
          s.stream = stream;
          s.vessel = q.vessel;
          s.tissue = q.tissue;
          s.flowBasis = q.flowBasis ? [q.flowBasis[0], q.flowBasis[1], q.flowBasis[2]] : [0, 0, 0];
          s.imp = 1;
          s.ampImp = 1;
          s.weightEpoch = -1;
          s.fresh = true;
          startAmpRamp(s, TISSUES[q.tissue].backscatter * ampFactor);
        }
        if ((slow || s.fresh) && !s.fading) {
          if (reclass && !s.pending && (j + this.tick / RECLASSIFY_EVERY) % 4 === 0) {
            // La luz que crece o mengua (calibre, semieje AP de la cava) cambia la identidad del punto: el tejido que queda
            // en una luz pasa a sangre con su corriente y la sangre en su corriente donde la clasificación ya no ve sangre,
            // a tejido, en dos rampas. Cada turno visita otro cuarto; con la sangre en su corriente la reclasificación ya no
            // vacía la población (208). La sangre sin tubo (fantomas con clasificador sintético) no se reclasifica.
            const q = this.anatomy.classifyMaterial(s.m, phys);
            const nowBlood = q.tissue === Tissue.Blood && q.bloodVelocity !== null;
            if (nowBlood !== s.isBlood && (nowBlood || s.stream)) {
              s.pending = { ampFactor: 0.7 + 0.6 * this.rng.float() };
              startAmpRamp(s, 0);
            }
          }
          if (s.isBlood && s.vessel) {
            const u = vel[s.vessel];
            if (s.stream) {
              const tg = s.stream.geom.t[s.stream.seg],
                kk = s.stream.k;
              s.flowBasis[0] = tg[0] * kk;
              s.flowBasis[1] = tg[1] * kk;
              s.flowBasis[2] = tg[2] * kk;
            }
            s.vBlood[0] = s.flowBasis[0] * u;
            s.vBlood[1] = s.flowBasis[1] * u;
            s.vBlood[2] = s.flowBasis[2] * u;
          }
          // Velocidad relativa: sangre + tejido − sonda, proyectada sobre b̂ → fD → rotación por tick.
          const vx = (s.isBlood ? s.vBlood[0] : 0) + tissueVel[0] - probeVelocity[0];
          const vy = (s.isBlood ? s.vBlood[1] : 0) + tissueVel[1] - probeVelocity[1];
          const vz = (s.isBlood ? s.vBlood[2] : 0) + tissueVel[2] - probeVelocity[2];
          // Ensanchamiento intrínseco: cada dispersor es visto por la apertura con un
          // ángulo propio (σ = D/4r) respecto al eje del haz, dentro del plano de imagen
          const da = s.apAngle * apSigma;
          const bx = bHat[0] + G1[0] * da;
          const by = bHat[1] + G1[1] * da;
          const bz = bHat[2] + G1[2] * da;
          const bn = 1 / Math.hypot(bx, by, bz);
          const dphi = twoPiDt * dopplerShiftHz((vx * bx + vy * by + vz * bz) * bn, f0);
          s.rotC = Math.cos(dphi);
          s.rotS = Math.sin(dphi);
          s.fresh = false;
        }
        // Avance de fase por multiplicación compleja: e^{iφ} · e^{i2πfDΔt}
        const cr = s.cr * s.rotC - s.ci * s.rotS;
        const ci = s.cr * s.rotS + s.ci * s.rotC;
        s.cr = cr;
        s.ci = ci;
        // Sample the existing pulse-convolved spatial sensitivity at this pulse, not a delayed 8-pulse ramp.
        // Exact reuse only for stationary tissue within this generate call.
        let weight: number;
        if (stationaryTissue && !s.isBlood && !s.fading && s.weightEpoch === weightEpoch) weight = s.stationaryWeight;
        else {
          const sg = s.g;
          const axialW = 0.5 * (pulseErf((half - sg[0]) * invPs) + pulseErf((half + sg[0]) * invPs));
          weight = axialW * Math.exp(-0.5 * (sg[1] * sg[1] * invLat2 + sg[2] * sg[2] * invEl2));
          if (stationaryTissue && !s.isBlood && !s.fading) {
            s.weightEpoch = weightEpoch;
            s.stationaryWeight = weight;
          }
        }
        if (s.rampLeft > 0) {
          s.amp += s.dAmp;
          s.rampLeft--;
        }
        const a = s.amp * weight * s.ampImp;
        sr += a * cr;
        si += a * ci;
      }
      // Ruido electrónico: independiente de la transmisión (no se atenúa con la profundidad).
      const nr = this.rng.gaussian() * NOISE_STD;
      const ni = this.rng.gaussian() * NOISE_STD;
      this.transmissionNow += (g.transmission - this.transmissionNow) * TRANSMISSION_ALPHA;
      re[offset + k] = (sr * this.particleAmplitudeScale * this.transmissionNow + nr) * this.equipment.gain;
      im[offset + k] = (si * this.particleAmplitudeScale * this.transmissionNow + ni) * this.equipment.gain;
      this.tick++;
      if (this.tick % (RECLASSIFY_EVERY * 4) === 0) this.updateComposition();
    }
  }
}

/** Función error (aproximación de Abramowitz–Stegun 7.1.26, |ε| < 1,5e−7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  if (ax > 4) return sign; // Tail error < 1.6e-8, below the approximation error below.
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Positive erf table, 32 KiB shared by all sample volumes. Linear interpolation
 * adds <1.2e-7 absolute error (h=1/1024, max |erf''|<0.968), avoiding two
 * exponentials per scatterer per pulse without reducing pulse sampling. */
const ERF_TABLE = Float64Array.from({ length: 4097 }, (_, i) => erf(i / 1024));
export function pulseErf(x: number): number {
  const a = Math.abs(x);
  if (a >= 4) return x < 0 ? -1 : 1;
  const u = a * 1024,
    i = Math.floor(u);
  const y = ERF_TABLE[i] + (ERF_TABLE[i + 1] - ERF_TABLE[i]) * (u - i);
  return x < 0 ? -y : y;
}
