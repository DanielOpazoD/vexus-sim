import { TISSUES, Tissue, attenuationDbPerCm } from '../anatomy/tissues';
import { wallArc, wallDepths } from '../anatomy/organs/wall';
import { torsoDepth } from '../anatomy/primitives';
import type { FaceGeometry } from '../anatomy/scene';
import { dot, type Vec3 } from '../core/vec3';
import { VESSEL_META } from '../physiology/vessels';
import { contactCoupling } from '../probe/contact';
import { lineDirection, pointOnLine } from '../probe/probe';
import { lateralFwhmMm } from '../ultrasound/beamModel';
import { focalGain, frequencyRatio } from '../ultrasound/beamEcho';
import { bmodeBeam } from '../ultrasound/transducerProfile';
import { effectiveLooks, lookCorrelationLaw, lookWeight } from '../ultrasound/compound';
import { lookWavenumber, steerBeta } from '../ultrasound/steering';
import { levelOfGrey } from '../ultrasound/greyMap';
import { CURTAIN_MIN_AIR, elevSigmaMm } from '../ultrasound/pleura';
import { COARSE_DEPTH, nominalTgcDbPerCm, type DisplayFrame } from '../ultrasound/renderer';
import { beamToPixel, pixelToBeam } from '../ultrasound/sectorGeometry';
import { mirrorCrossing } from '../ultrasound/transmission';
import type { EnvelopeFrame } from './speckle';
import type { Simulator } from './simulator';
import {
  lookCorrelations,
  maskedMean,
  seamStats,
  type CompoundBand,
  type CompoundStats,
  type LookFrames,
  type SeamStats,
} from './fidelity/compound';
import { curtainLines } from './fidelity/curtain';
import { depthProfile, displayGrain, displayStats } from './fidelity/display';
import { TEXTURE_PATCH, envelopeTexture, logEnvelopeGrain, type EnvelopeGeometry } from './fidelity/envelope';
import {
  PEAK_AFTER_MM,
  PEAK_BEFORE_MM,
  WALL_SYSTEMS,
  envelopeLine,
  measureFaceLine,
  summarizeFaces,
  type FaceKind,
  type FaceLine,
  type FaceSample,
  type InterfaceSpec,
} from './fidelity/faces';
import {
  AIR,
  BLOOD,
  CAPSULE,
  CLEAR_ERODE_LINES,
  CLEAR_MARGIN_MM,
  CURTAIN_LIVER_MAX_AIR,
  DIAPHRAGM,
  DISPLAY_CLEARANCE_MM,
  ENVELOPE_CLEARANCE_MM,
  FACE_SATURATION_MM,
  FAT,
  GRID_STEP_MM,
  LIVER,
  LUMEN_CLEARANCE_MM,
  LUNG,
  MAX_PATH_EXCESS_DB,
  MAX_PENUMBRA_DB,
  MIN_BEFORE_CELLS,
  MIN_COUPLING,
  MUSCLE,
  PERIRENAL,
  PERITONEUM_REACH_MM,
  PLEURA_BISECTION_STEPS,
  RENAL_CAPSULE,
  TRANSVERSALIS_CLEAR_MM,
  WALL_LINK_MM,
  WALL_TISSUES,
  centralGradient,
  clearanceMask,
  type TransmissionFrame,
} from './fidelity/grid';
import { DEPTH_BANDS_MM, type FidelityStats } from './fidelity/planeStats';
import { UMBRA_SEARCH_MM, umbraEndMm, type ShadowStats } from './fidelity/shadow';
import { medianOf } from './fidelity/statistics';
import { wallStatsOf } from './fidelity/wall';

/**
 * Banco de fidelidad del modo B (decisión 52): métricas reproducibles para comparar la imagen del
 * simulador con la física y con ecografías reales, en dos niveles.
 *
 *  - Envolvente (física del moteado, antes de la compresión): SNR, tamaño del grano (FWHM de la
 *    autocovarianza axial y lateral, comparable con la PSF de `beamModel.ts`), lóbulo secundario
 *    (periodicidad de una retícula), fracción oscura e índice de grietas (topología de los ceros:
 *    en un moteado plenamente desarrollado los ceros son puntos aislados; en una red de grietas,
 *    líneas).
 *  - Imagen mostrada (cadena del equipo: TGC, rango dinámico, curva de grises, persistencia):
 *    gris del hígado y su dispersión, perfil en profundidad (dB/cm) y el banco de interfaces: pared
 *    anterior de VCI, suprahepáticas y porta, cápsula hepática, diafragma con la pleura y su espejo
 *    y Morison, por tramos de incidencia sobre la normal real de cada cara (cociente, huecos,
 *    rosario, anchura del eco, costura y desfase del espejo).
 *
 * Las funciones puras trabajan sobre la envolvente o la imagen con un predicado «dentro» y se
 * prueban con campos sintéticos sin WebGL (`validation/fidelity.test.ts`); `fidelityStats` las
 * aplica al plano actual del simulador.
 *
 * Cada tema vive en su módulo de `fidelity/` (decisión 322, punto 10a): la envolvente, la imagen mostrada, las
 * interfaces y su contorno, la sombra, la composición espacial, la pared, la rejilla, la cortina, el hígado despejado y la
 * pleura; aquí queda `fidelityStats`, que los aplica al plano.
 */

/**
 * Métricas del plano actual sobre una rejilla de clasificación en CPU (líneas × 0,5 mm, ~1–3 s).
 * La textura se mide en hígado «despejado»: en líneas bien acopladas, antes de cualquier tejido que
 * haga sombra (gas o hueso, como la pasada A) en la línea y en sus dos vecinas, fuera de la penumbra
 * de la apertura (con `transmission`: ≤ 0,5 dB bajo la de un solo rayo), y a ≥ 6 mm de
 * cualquier tejido que no sea hígado en el plano (≥ 3 mm en la imagen mostrada; los vasos cuentan,
 * aunque la `boundaryDistance` del hígado no los incluya, y lo de fuera del sector cuenta como otro
 * tejido). El gris y el perfil en profundidad, además, solo en hígado «puro»: sin más de 0,5 dB de
 * atenuación distinta de la del hígado en el camino (el refuerzo tras un vaso es física correcta, no
 * un defecto de la TGC). Con `img`, también el banco de interfaces por tramos de incidencia sobre la
 * normal real de cada cara (`FaceSummary`), sobre la envolvente con la compensación nominal
 * (`envelopeLine`), y la saturación junto a las caras; con `samples`, además, un registro por línea y
 * pared (`faceSamples`) para agregar varios planos con `summarizeFaces`.
 *
 * Con `looks` (composición espacial, decisión 58), `env` es la envolvente compuesta y el hígado puro es el
 * de las tres miradas: cada dirigida con su peso entero y con su transmisión con apertura a ≤ 0,5 dB del
 * rayo de la mirada 0 (ni su sombra, ni su penumbra, ni otro tejido en su camino: el AND de las penumbras);
 * la costura (la 0 y una sola dirigida) se mide aparte (`seamStats`), y `compound` da por banda la
 * composición (`CompoundBand`) y la umbra de las costillas del compuesto.
 */
export function fidelityStats(
  sim: Simulator,
  env: EnvelopeFrame,
  img: DisplayFrame | null = null,
  opts: { colorOn?: boolean; transmission?: TransmissionFrame; samples?: boolean; looks?: LookFrames } = {},
): FidelityStats {
  const tr = sim.transducer;
  const depth = sim.bmode.depthMm;
  const geom: EnvelopeGeometry = { depthMm: depth, halfSector: tr.halfSector, curvatureRadius: tr.curvatureRadius };
  const lines = env.lines;
  const dTheta = (2 * tr.halfSector) / lines;
  const thetaOf = (u: number): number => -tr.halfSector + dTheta * (u + 0.5);
  const fB = sim.profile.bEffectiveMHz;
  const alphaLiver = attenuationDbPerCm(Tissue.Liver, fB);

  // Rejilla: tejido, sistema de la sangre (1 + índice en WALL_SYSTEMS), primera sombra, primer gas,
  // primer hueso y primer desvío de atenuación.
  const nr = Math.floor(depth / GRID_STEP_MM);
  const tissue = new Uint8Array(lines * nr);
  const system = new Uint8Array(lines * nr);
  const bloodDepth = new Float32Array(lines * nr);
  const shadowAt = new Float32Array(lines).fill(Infinity);
  const gasAt = new Float32Array(lines).fill(Infinity);
  const boneAt = new Float32Array(lines).fill(Infinity);
  const impureAt = new Float32Array(lines).fill(Infinity);
  const coupled = new Uint8Array(lines);
  for (let u = 0; u < lines; u++) {
    const theta = thetaOf(u);
    coupled[u] = contactCoupling(sim.contact, theta) >= MIN_COUPLING ? 1 : 0;
    let entered = false;
    let inLiver = false;
    let excessDb = 0;
    for (let k = 0; k < nr; k++) {
      const r = (k + 0.5) * GRID_STEP_MM;
      const q = sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, theta, r), sim.sample);
      const i = u * nr + k;
      tissue[i] = q.tissue;
      if (q.tissue === Tissue.Blood && q.vessel) system[i] = 1 + (WALL_SYSTEMS as readonly string[]).indexOf(VESSEL_META[q.vessel].system);
      if (q.tissue === Tissue.Blood) bloodDepth[i] = q.boundaryDistance;
      // el aire antes de la piel es el gel de acoplamiento (la pasada A también lo salta)
      if (q.tissue !== Tissue.Air) entered = true;
      if (entered && r < shadowAt[u] && (TISSUES[q.tissue].gas || TISSUES[q.tissue].bone)) shadowAt[u] = r;
      if (entered && r < gasAt[u] && TISSUES[q.tissue].gas) gasAt[u] = r;
      if (entered && r < boneAt[u] && TISSUES[q.tissue].bone) boneAt[u] = r;
      if (q.tissue === Tissue.Liver) inLiver = true;
      else if (inLiver) {
        excessDb += 2 * (alphaLiver - attenuationDbPerCm(q.tissue, fB)) * (GRID_STEP_MM / 10);
        if (Math.abs(excessDb) > MAX_PATH_EXCESS_DB && r < impureAt[u]) impureAt[u] = r;
      }
    }
  }
  // la pleura de la cortina y su borde blando (decisión 61): bajo ella la línea es pulmón en la fracción fAir
  const curtain = curtainLines(sim, lines);
  const curtainFrom = Float32Array.from(curtain, (c) => (c && c.fAir >= CURTAIN_MIN_AIR ? c.D : Infinity));
  for (let u = 0; u < lines; u++) {
    const c = curtain[u];
    if (!c || c.fAir < CURTAIN_LIVER_MAX_AIR) continue;
    shadowAt[u] = Math.min(shadowAt[u], c.D);
    gasAt[u] = Math.min(gasAt[u], c.D);
  }
  // profundidad despejada (y pura) de cada línea: la menor de ella y de sus vecinas, con margen
  const erode = (at: Float32Array, needCoupling: boolean): Float32Array => {
    const out = new Float32Array(lines);
    for (let u = 0; u < lines; u++) {
      let c = Infinity;
      for (let du = -CLEAR_ERODE_LINES; du <= CLEAR_ERODE_LINES; du++) {
        const uu = u + du;
        if (uu < 0 || uu >= lines) continue;
        c = Math.min(c, needCoupling && !coupled[uu] ? 0 : at[uu]);
      }
      out[u] = c - CLEAR_MARGIN_MM;
    }
    return out;
  };
  const clearUntil = erode(shadowAt, true);
  const pureUntil = erode(impureAt, false);
  // la cara del diafragma llega hasta su propio pulmón: solo el hueso (en la línea y sus vecinas) la tapa
  const boneClearUntil = erode(boneAt, true);
  // celdas de `kind` a ≥ `mm` de cualquier celda de otro tejido (distancia euclídea en la rejilla)
  const spacingAt = (k: number): number => (tr.curvatureRadius + (k + 0.5) * GRID_STEP_MM) * dTheta;
  const clearance = (mm: number, kind: number = LIVER): Uint8Array => clearanceMask(tissue, lines, nr, GRID_STEP_MM, spacingAt, mm, kind);
  // penumbra de la apertura (solo con la transmisión de la GPU; la imagen pintada en CPU no la tiene)
  const looks = opts.looks;
  const tx = opts.transmission ?? looks?.transmissions[0];
  if (looks && !tx) throw new Error('fidelityStats: las miradas del anillo exigen la transmisión de la mirada 0');
  const penumbraMin = Math.pow(10, -MAX_PENUMBRA_DB / 20);
  const txAt = (t: TransmissionFrame, field: 'single' | 'aperture', u: number, r: number): number => {
    const k = Math.min(t.samples - 1, Math.max(0, Math.floor((r / depth) * t.samples)));
    return t[field][k * t.lines + u];
  };
  const outOfPenumbra = (u: number, r: number): boolean => {
    if (!tx) return true;
    const s = txAt(tx, 'single', u, r);
    return s > 1e-6 && txAt(tx, 'aperture', u, r) >= penumbraMin * s;
  };
  const envClear = clearance(ENVELOPE_CLEARANCE_MM);
  const cellOf = (u: number, r: number): number => {
    const k = Math.floor(r / GRID_STEP_MM);
    return k < 0 || k >= nr ? -1 : u * nr + k;
  };
  // Miradas limpias de cada celda de la rejilla (decisión 58): la 0 (su penumbra la mira `outOfPenumbra`)
  // y las dirigidas con peso entero y transmisión a ≤ 0,5 dB del rayo de la mirada 0; una dirigida a medias
  // o sucia deja la celda fuera. Sin miradas, todas son «de tres».
  const nLooks = looks ? looks.thetas.length : 1;
  const lookRegion = new Uint8Array(lines * nr).fill(nLooks);
  if (looks && tx) {
    const wGeom = { curvatureRadius: tr.curvatureRadius, halfSector: tr.halfSector, lines };
    for (let u = 0; u < lines; u++)
      for (let k = 0; k < nr; k++) {
        const r = (k + 0.5) * GRID_STEP_MM;
        const ref = penumbraMin * txAt(tx, 'single', u, r);
        let clean = 1;
        let absent = 0;
        for (let j = 1; j < nLooks; j++) {
          const w = lookWeight(thetaOf(u), tr.curvatureRadius + r, looks.thetas[j], wGeom);
          if (w <= 0) absent++;
          else if (w >= 1 && txAt(looks.transmissions[j], 'aperture', u, r) >= ref) clean++;
        }
        lookRegion[u * nr + k] = clean + absent === nLooks ? clean : 0;
      }
  }

  const inBandWith =
    (looksWanted: number) =>
    (r0: number, r1: number) =>
    (u: number, v: number): boolean => {
      const r = ((v + 0.5) / env.samples) * depth;
      if (r < r0 || r >= r1 || r >= clearUntil[u] || !outOfPenumbra(u, r)) return false;
      const i = cellOf(u, r);
      return i >= 0 && envClear[i] === 1 && lookRegion[i] === looksWanted;
    };
  const inBand = inBandWith(nLooks);
  const inSeam = inBandWith(nLooks - 1);
  const tgcNominal = nominalTgcDbPerCm(fB);

  /** Composición espacial por banda y en la costura (`CompoundBand`, `SeamStats`). */
  function compoundOf(lf: LookFrames): CompoundStats {
    const k2 = lookWavenumber(sim.profile.beam);
    const beam = bmodeBeam(sim.profile, sim.bmode);
    const R = tr.curvatureRadius;
    const n = lf.thetas.length;
    const out: CompoundBand[] = [];
    const seam: SeamStats[] = [];
    for (const [r0, r1] of DEPTH_BANDS_MM) {
      if (r0 >= depth) continue;
      const mask = inBand(r0, r1);
      const c = envelopeTexture(env, mask, geom);
      const per = lf.envelopes.map((e) => envelopeTexture(e, mask, geom));
      const m0 = maskedMean(lf.envelopes[0], mask);
      const corr = lookCorrelations(lf.envelopes, mask, depth, tgcNominal, TEXTURE_PATCH, (r) => focalGain(r, sim.bmode.focusMm, beam));
      // la ley de cada par con la diferencia de dirección de sus haces en el punto (β de cada mirada), la σ del grano
      // lateral medido de la mirada 0 y k2 a la frecuencia del eco en la banda (la de la fase de la pasada B, decisión 84)
      const sigma = per[0].fwhmLateralMm / 2.3548;
      const rMid = Number.isFinite(per[0].depthMm) ? per[0].depthMm : (r0 + r1) / 2;
      const rho = R + rMid;
      const beta = lf.thetas.map((th) => steerBeta(rho, th, R));
      const k2r = k2 * frequencyRatio(rMid, beam);
      const laws: number[] = [];
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) laws.push(lookCorrelationLaw(beta[a] - beta[b], sigma, k2r));
      out.push({
        r0,
        r1,
        compound: c,
        look0: per[0],
        perLook: per.map((t, i) => ({ ...t, meanRatio: maskedMean(lf.envelopes[i], mask) / m0 })),
        snrGain: c.snr / per[0].snr,
        grainRatioLateral: c.fwhmLateralMm / per[0].fwhmLateralMm,
        grainRatioAxial: c.fwhmAxialMm / per[0].fwhmAxialMm,
        correlationPatches: corr.patches,
        rho0p: corr.pairs[0],
        rho0m: corr.pairs[1],
        rhoPm: corr.pairs[2],
        law1: laws[0],
        law2: laws[2],
        nEff: effectiveLooks(n, corr.pairs),
        nEffLaw: effectiveLooks(n, laws),
      });
      seam.push(seamStats(env, inSeam(r0, r1), mask, geom, { r0, r1 }));
    }
    return { thetas: [...lf.thetas], bands: out, seam };
  }
  const envelope = envelopeTexture(env, inBand(0, Infinity), geom);
  const bands = DEPTH_BANDS_MM.filter(([r0]) => r0 < depth).map(([r0, r1]) => {
    const t = envelopeTexture(env, inBand(r0, r1), geom);
    const rMid = Number.isFinite(t.depthMm) ? t.depthMm : (r0 + r1) / 2;
    return {
      ...t,
      r0,
      r1,
      beamFwhmMm: lateralFwhmMm(rMid, sim.bmode.focusMm, bmodeBeam(sim.profile, sim.bmode)),
      logGrain: logEnvelopeGrain(env, inBand(r0, r1), geom),
    };
  });
  const compound = looks ? compoundOf(looks) : undefined;
  if (!img || img.width === 0) return { envelope, bands, ...(compound ? { compound } : {}), display: null };

  const dispClear = clearance(DISPLAY_CLEARANCE_MM);
  const layout = sim.renderer.display;
  /** Profundidad del píxel si cae en hígado despejado y puro; null si no. */
  const pureLiverDepth = (x: number, y: number): number | null => {
    const b = pixelToBeam(layout, tr, depth, x, y);
    if (!b) return null;
    const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
    if (u < 0 || u >= lines || b.r >= clearUntil[u] || b.r >= pureUntil[u] || !outOfPenumbra(u, b.r)) return null;
    const i = cellOf(u, b.r);
    return i >= 0 && dispClear[i] === 1 && lookRegion[i] === nLooks ? b.r : null;
  };
  /**
   * Profundidad del píxel si cae en hígado despejado, aunque no sea puro: el grano (`displayGrain`) no depende del
   * nivel, que la ventana normaliza, y el hígado puro no llega a lo hondo (tras cada vaso el camino ya no lo es).
   */
  const clearLiverDepth = (x: number, y: number): number | null => {
    const b = pixelToBeam(layout, tr, depth, x, y);
    if (!b) return null;
    const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
    if (u < 0 || u >= lines || b.r >= clearUntil[u] || !outOfPenumbra(u, b.r)) return null;
    const i = cellOf(u, b.r);
    return i >= 0 && dispClear[i] === 1 && lookRegion[i] === nLooks ? b.r : null;
  };
  const liver = displayStats(img, (x, y) => pureLiverDepth(x, y) !== null, 2);
  const liverBands = DEPTH_BANDS_MM.filter(([r0]) => r0 < depth).map(([r0, r1]) => {
    const within = (at: (x: number, y: number) => number | null) => (x: number, y: number) => {
      const r = at(x, y);
      return r !== null && r >= r0 && r < r1;
    };
    return { r0, r1, ...displayStats(img, within(pureLiverDepth), 2), grain: displayGrain(img, within(clearLiverDepth), layout) };
  });
  const profile = depthProfile(img, pureLiverDepth, sim.bmode.dynamicRangeDb);
  // centro de la luz: sangre de las venas del banco (VCI, suprahepáticas y porta) a ≥ 1,5 mm de su pared en el
  // plano y, en 3D, a ≥ 1,5 mm + la σ elevacional del haz, sin sombra delante (decisión 62). La rodaja entera es
  // sangre: una vena fina u oblicua al plano tiene su pared y el hígado dentro del grosor de corte y su «luz» es
  // gris (en la intercostal por el 8.º espacio las suprahepáticas, a 1,2–1,9 mm de su pared en 3D, daban una
  // mediana de 45–52). La aorta y los vasos renales no cuentan: la aorta asoma al fondo de alguna vista, donde
  // manda el ruido del receptor.
  const lumenClear = clearance(LUMEN_CLEARANCE_MM, BLOOD);
  const cellAt = (x: number, y: number): number => {
    const b = pixelToBeam(layout, tr, depth, x, y);
    if (!b) return -1;
    const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
    if (u < 0 || u >= lines || b.r >= clearUntil[u]) return -1;
    return cellOf(u, b.r);
  };
  const lumen = displayStats(
    img,
    (x, y) => {
      const i = cellAt(x, y);
      if (i < 0 || lumenClear[i] !== 1 || system[i] === 0) return false;
      const r = ((i % nr) + 0.5) * GRID_STEP_MM;
      return bloodDepth[i] >= LUMEN_CLEARANCE_MM + elevSigmaMm(r, tr.elevationFocusMm, sim.bmode.harmonic);
    },
    2,
  );
  // diafragma saturado: fracción de sus píxeles en el blanco (≥ 250)
  let diaphragmPx = 0;
  let diaphragmSat = 0;
  for (let y = 0; y < img.height; y += 2)
    for (let x = 0; x < img.width; x += 2) {
      const i = cellAt(x, y);
      if (i < 0 || tissue[i] !== DIAPHRAGM) continue;
      diaphragmPx++;
      if (img.gray[y * img.width + x] >= 250) diaphragmSat++;
    }
  const diaphragmSaturated = diaphragmPx ? diaphragmSat / diaphragmPx : Number.NaN;

  // Sombra ósea: nivel por línea del tejido blando 10–40 mm detrás del hueso (el de la línea o, fuera
  // de la sombra, el de la línea con hueso más cercana a ±6 para comparar a la misma profundidad).
  const levelDb = (g: number): number => (levelOfGrey(g / 255) - 1) * sim.bmode.dynamicRangeDb;
  const refBone = new Float32Array(lines).fill(Infinity);
  for (let u = 0; u < lines; u++)
    for (let d = 0; d <= 6 && !Number.isFinite(refBone[u]); d++)
      for (const uu of [u - d, u + d]) if (uu >= 0 && uu < lines && Number.isFinite(boneAt[uu])) refBone[u] = boneAt[uu];
  const perLine: number[][] = Array.from({ length: lines }, () => []);
  const perLineGray: number[][] = Array.from({ length: lines }, () => []);
  for (let y = 0; y < img.height; y += 2)
    for (let x = 0; x < img.width; x += 2) {
      const b = pixelToBeam(layout, tr, depth, x, y);
      if (!b) continue;
      const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
      if (u < 0 || u >= lines || !Number.isFinite(refBone[u]) || b.r < refBone[u] + 10 || b.r > refBone[u] + 40) continue;
      const i = cellOf(u, b.r);
      if (i < 0) continue;
      const t = TISSUES[tissue[i]];
      if (t.gas || t.bone || tissue[i] === AIR) continue;
      const g = img.gray[y * img.width + x];
      perLine[u].push(levelDb(g));
      perLineGray[u].push(g);
    }
  const lineLevel = perLine.map((a) => medianOf(a));
  const hit = (u: number): boolean => u >= 0 && u < lines && Number.isFinite(boneAt[u]);
  const isCore = (u: number): boolean => {
    for (let du = -3; du <= 3; du++) if (!hit(u + du)) return false;
    return true;
  };
  const core: number[] = [];
  const coreGray: number[] = [];
  let coreLines = 0;
  for (let u = 0; u < lines; u++) {
    if (isCore(u) && perLine[u].length) {
      coreLines++;
      core.push(...perLine[u]);
      coreGray.push(...perLineGray[u]);
    }
  }
  const edgeAcc = Array.from({ length: 9 }, () => [] as number[]);
  for (let u = 0; u < lines; u++) {
    if (!hit(u)) continue;
    let v = u;
    while (hit(v + 1)) v++;
    if (v - u + 1 >= 7)
      for (let o = -4; o <= 4; o++) {
        for (const line of [u + o, v - o]) {
          const lvl = line >= 0 && line < lines ? lineLevel[line] : Number.NaN;
          if (Number.isFinite(lvl)) edgeAcc[o + 4].push(lvl);
        }
      }
    u = v;
  }
  // Umbra en la transmisión de la pasada A (sin ruido: la umbra a −40 dB queda bajo el suelo de la imagen)
  // en las líneas del núcleo, cada 1 mm tras la cara del hueso, respecto al hígado: el rayo de la mirada 0
  // justo antes del hueso con la atenuación del hígado desde ahí (decisión 58)
  const txLerp = (t: TransmissionFrame, field: 'single' | 'aperture', u: number, r: number): number => {
    const x = Math.min(t.samples - 1, Math.max(0, (r / depth) * t.samples - 0.5));
    const k = Math.min(t.samples - 2, Math.floor(x));
    const f = x - k;
    return t[field][k * t.lines + u] * (1 - f) + t[field][(k + 1) * t.lines + u] * f;
  };
  const umbraProfile = (T: (u: number, r: number) => number): number[] => {
    const prof: number[] = [];
    for (let d = 0; d <= UMBRA_SEARCH_MM; d++) {
      const vals: number[] = [];
      for (let u = 0; u < lines; u++) {
        if (!tx || !isCore(u)) continue;
        const rRef = Math.max(0, boneAt[u] - 1);
        const r = boneAt[u] + d;
        if (r >= depth) continue;
        const ref = txLerp(tx, 'single', u, rRef) * Math.pow(10, (-tgcNominal * (r - rRef)) / 200);
        if (ref > 0) vals.push(20 * Math.log10(Math.max(T(u, r), 1e-12) / ref));
      }
      prof.push(vals.length ? medianOf(vals) : Number.NaN);
    }
    return prof;
  };
  const umbraEndLook0Mm = tx ? umbraEndMm(umbraProfile((u, r) => txLerp(tx, 'aperture', u, r))) : Number.NaN;
  let umbraEndCompoundMm = Number.NaN;
  if (looks) {
    const wGeom = { curvatureRadius: tr.curvatureRadius, halfSector: tr.halfSector, lines };
    umbraEndCompoundMm = umbraEndMm(
      umbraProfile((u, r) => {
        let sum = 0;
        let wsum = 0;
        looks.thetas.forEach((th, j) => {
          const w = lookWeight(thetaOf(u), tr.curvatureRadius + r, th, wGeom);
          sum += w * txLerp(looks.transmissions[j], 'aperture', u, r);
          wsum += w;
        });
        return sum / wsum;
      }),
    );
  }
  const shadow: ShadowStats = {
    coreLines,
    coreDbBelowLiver: liver.pixels && core.length ? levelDb(liver.p50) - medianOf(core) : Number.NaN,
    coreGray: medianOf(coreGray),
    edgeProfileDb: edgeAcc.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : Number.NaN)),
    umbraEndLook0Mm,
    umbraEndCompoundMm,
    umbraShiftMm: umbraEndLook0Mm - umbraEndCompoundMm,
  };

  // Banco de interfaces. Cada línea que pasa de ≥ 3 mm de tejido previo a su objetivo (con, a lo sumo,
  // los tejidos admitidos en medio) da un registro: pico de gris y de envolvente en [rb − 1,5;
  // rObjetivo + 0,5] frente a la mediana del hígado de referencia de la misma línea, con la incidencia
  // sobre la normal real de la cara (gradiente de `faceSdf`, la cantidad que decide la clasificación).
  const grayAt = (u: number, r: number): number => {
    const p = beamToPixel(layout, tr, thetaOf(u), r);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return Number.NaN;
    return img.gray[y * img.width + x];
  };
  // la envolvente sin la atenuación del hígado ni la ganancia focal: la cara y su referencia, a la misma escala
  const beam = bmodeBeam(sim.profile, sim.bmode);
  const envAt = envelopeLine(env, depth, nominalTgcDbPerCm(fB), (r) => focalGain(r, sim.bmode.focusMm, beam));
  const faceLine = (u: number): FaceLine => ({
    env: (r) => envAt(u, r),
    gray: (r) => grayAt(u, r),
    liver: (r) => {
      const i = cellOf(u, r);
      return i >= 0 && tissue[i] === LIVER;
    },
  });
  const faceCosine = (u: number, r: number, face: FaceGeometry): number | null => {
    const theta = thetaOf(u);
    const g = centralGradient((p) => sim.anatomy.faceSdfWorld(p, sim.sample, face), pointOnLine(sim.frame, tr, theta, r));
    const len = g ? Math.hypot(g[0], g[1], g[2]) : 0;
    return g && len > 0 ? Math.abs(dot(g, lineDirection(sim.frame, theta))) / len : null;
  };
  // Espejo de la pasada A (A0, `FRAG_TRANS_HITS`): la marcha de paso profundidad/COARSE_DEPTH halla el
  // primer segmento cuyo punto medio es pulmón, sobre la línea recta (antes del espejo no se refleja), y la
  // bisección (`mirrorCrossing`) lo lleva al cruce. La GPU lo publica en `mirrorHit`; es el suelo de
  // `mirrorOffsetMm` con esa colocación.
  const coarseStep = depth / COARSE_DEPTH;
  const passAMirror = new Map<number, number>();
  const passAMirrorAt = (u: number): number => {
    let hit = passAMirror.get(u);
    if (hit === undefined) {
      hit = -1;
      const isLung = (r: number) => sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, thetaOf(u), r), sim.sample).tissue === Tissue.Lung;
      for (let s = 0; s < COARSE_DEPTH && hit < 0; s++) {
        const r = (s + 0.5) * coarseStep;
        if (isLung(r)) hit = mirrorCrossing(isLung, r, coarseStep);
      }
      passAMirror.set(u, hit);
    }
    return hit;
  };
  /** Grosor (mm, hasta `coarseStep`) del pulmón que empieza en la profundidad r de la línea u. */
  const lungRunMm = (u: number, r: number): number => {
    const isLung = (q: number) => sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, thetaOf(u), q), sim.sample).tissue === Tissue.Lung;
    let d = 0.05;
    while (d < coarseStep && isLung(r + d)) d += 0.05;
    return d;
  };
  /** Cruce exacto con el pulmón entre dos profundidades de la línea recta (bisección). */
  const pleuraCrossing = (u: number, rOut: number, rIn: number): number => {
    let lo = rOut;
    let hi = rIn;
    for (let it = 0; it < PLEURA_BISECTION_STEPS; it++) {
      const mid = 0.5 * (lo + hi);
      if (sim.anatomy.classifyWorld(pointOnLine(sim.frame, tr, thetaOf(u), mid), sim.sample).tissue === Tissue.Lung) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  };
  // Cruce exacto de la línea u con la cara interna de la pared (el peritoneo parietal, −torsoDepth = pared)
  // entre r0 (dentro de la pared) y r1 (fuera), o null; y cuánto más honda que la transversalis está la
  // muestra r (mm de profundidad bajo la piel)
  const torso = sim.anatomy.scene.torso;
  const innerWallMm = torso.skinMm + torso.fatMm + torso.muscleMm;
  const materialAt = (u: number, r: number): Vec3 =>
    sim.anatomy.deformation.toMaterial(pointOnLine(sim.frame, tr, thetaOf(u), r), sim.sample.resp);
  const wallDepthAt = (u: number, r: number): number => -torsoDepth(materialAt(u, r), torso);
  const peritoneumCrossing = (u: number, r0: number, r1: number): number | null => {
    if (!(wallDepthAt(u, r0) < innerWallMm && wallDepthAt(u, r1) >= innerWallMm)) return null;
    let lo = r0;
    let hi = r1;
    for (let it = 0; it < PLEURA_BISECTION_STEPS; it++) {
      const mid = 0.5 * (lo + hi);
      if (wallDepthAt(u, mid) >= innerWallMm) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  };
  const belowTransversalisMm = (u: number, r: number): number => {
    const m = materialAt(u, r);
    return -torsoDepth(m, torso) - wallDepths(torso, wallArc(m, torso), m[2]).transversalis;
  };
  const tissueIn =
    (...ts: number[]) =>
    (i: number): boolean =>
      ts.includes(tissue[i]);
  const specs: InterfaceSpec[] = [
    ...WALL_SYSTEMS.map((sys, j): InterfaceSpec => ({
      kind: sys,
      before: tissueIn(LIVER),
      target: (i) => tissue[i] === BLOOD && system[i] === j + 1,
      between: (i) => WALL_TISSUES.has(tissue[i]),
      maxCells: 4,
      minBetween: 0,
      ref: 'above',
      face: 'tube',
    })),
    // cápsula bajo la pared: la referencia es el hígado de debajo
    {
      kind: 'capsule',
      before: tissueIn(MUSCLE, FAT),
      target: tissueIn(CAPSULE),
      between: () => true,
      maxCells: 4,
      minBetween: 0,
      ref: 'below',
      face: 'liverSurface',
    },
    // hígado → diafragma → pulmón: el objetivo es el cruce exacto con la pleura
    {
      kind: 'diaphragm',
      before: tissueIn(LIVER, CAPSULE),
      target: tissueIn(LUNG),
      between: tissueIn(DIAPHRAGM),
      maxCells: 10,
      minBetween: 1,
      ref: 'above',
      face: 'dome',
    },
    // Morison: hígado → grasa perirrenal → cápsula renal
    {
      kind: 'renalCapsule',
      before: tissueIn(LIVER, CAPSULE),
      target: tissueIn(RENAL_CAPSULE),
      between: tissueIn(PERIRENAL),
      maxCells: 12,
      minBetween: 1,
      ref: 'above',
      face: 'kidneyOuter',
    },
  ];
  const faceSamples: FaceSample[] = [];
  let nextWall = 0;
  let prevLine = new Map<FaceKind, { rb: number; wall: number; used: boolean }[]>();
  for (let u = 0; u < lines; u++) {
    const curLine = new Map<FaceKind, { rb: number; wall: number; used: boolean }[]>();
    const pitchMm = (rb: number): number => (tr.curvatureRadius + rb) * dTheta;
    const mirrorGpu = tx ? tx.mirrorHit[(tx.samples - 1) * tx.lines + u] : -1;
    for (const spec of specs) {
      let run = 0;
      for (let k = 0; k < nr - spec.maxCells; k++) {
        const i = u * nr + k;
        if (spec.before(i)) {
          run++;
          continue;
        }
        const prior = run;
        run = 0;
        if (prior < MIN_BEFORE_CELLS) continue;
        let hit = -1;
        for (let j = 0; j < spec.maxCells && hit < 0; j++) if (spec.target(i + j)) hit = j;
        for (let j = 0; j < hit; j++) if (!spec.between(i + j)) hit = -1;
        if (hit < spec.minBetween) continue;
        const rb = k * GRID_STEP_MM;
        const rCell = (k + hit + 0.5) * GRID_STEP_MM;
        const pleura = spec.kind === 'diaphragm';
        // la pleura es el primer gas de su línea (si no, el espejo de la GPU está en otro sitio)
        if (pleura ? rb >= boneClearUntil[u] || gasAt[u] < rCell - 1e-6 : rb >= clearUntil[u]) continue;
        // pared de la línea: la de la línea anterior con el borde más cercano (≤ 3 mm), o una nueva
        const prev = (prevLine.get(spec.kind) ?? []).filter((c) => !c.used && Math.abs(c.rb - rb) <= WALL_LINK_MM);
        prev.sort((a, b) => Math.abs(a.rb - rb) - Math.abs(b.rb - rb));
        const link = prev[0];
        if (link) link.used = true;
        const wall = link ? link.wall : nextWall++;
        curLine.set(spec.kind, [...(curLine.get(spec.kind) ?? []), { rb, wall, used: false }]);
        const rTarget = pleura ? pleuraCrossing(u, rCell - GRID_STEP_MM, rCell) : (k + hit) * GRID_STEP_MM;
        // una lámina de pulmón más fina que el paso de la marcha de A0 no la ve la GPU: su espejo está en otro sitio (la que
        // quedaba entre el diafragma y la VCI supradiafragmática desapareció con el mediastino de la decisión 85)
        if (pleura && lungRunMm(u, rTarget) < coarseStep) continue;
        const cos = faceCosine(u, pleura ? rTarget : rCell, spec.face);
        if (cos === null) continue;
        // la cápsula con el peritoneo en su ventana es la línea de los dos (decisión 62): ventana desde el
        // alcance del eco del peritoneo, sin la transversalis
        let kind: FaceKind = spec.kind;
        let peakFrom: number | undefined;
        if (spec.kind === 'capsule') {
          const rP = peritoneumCrossing(u, rb - PEAK_BEFORE_MM - PERITONEUM_REACH_MM, rTarget + PEAK_AFTER_MM + PERITONEUM_REACH_MM);
          if (rP !== null) {
            peakFrom = rP - PERITONEUM_REACH_MM;
            if (belowTransversalisMm(u, peakFrom) < TRANSVERSALIS_CLEAR_MM) continue;
            kind = 'peritoneum';
          }
        }
        const m = measureFaceLine(faceLine(u), { rb, rTarget, ref: spec.ref, pleura, peakFrom }, sim.bmode.dynamicRangeDb);
        if (!m) continue;
        faceSamples.push({
          ...m,
          kind,
          wall,
          u,
          rb,
          pitchMm: pitchMm(rb),
          incidenceDeg: (Math.acos(Math.min(1, cos)) * 180) / Math.PI,
          ...(pleura
            ? {
                mirrorOffsetMm: mirrorGpu >= 0 ? Math.abs(mirrorGpu - rTarget) : Number.NaN,
                mirrorFloorMm: passAMirrorAt(u) >= 0 ? Math.abs(passAMirrorAt(u) - rTarget) : Number.NaN,
              }
            : {}),
        });
      }
    }
    prevLine = curLine;
  }
  const summary = summarizeFaces([faceSamples]);

  // Pared (decisión 62): el perfil de la envolvente compensada en profundidad bajo la piel, mediana lateral de
  // las líneas casi normales a la piel; las capas en toda la imagen, con la geometría de la textura en CPU
  // (`wallTexture.ts`: los septos y las estrías están en el mismo sitio del material que en la GPU)
  const liverEnv: number[] = [];
  {
    const mask = inBand(0, Infinity);
    for (let u = 0; u < lines; u++)
      for (let v = 0; v < env.samples; v++)
        if (mask(u, v)) liverEnv.push(20 * Math.log10(Math.max(envAt(u, ((v + 0.5) / env.samples) * depth), 1e-12)));
  }
  const wall = wallStatsOf(sim, envAt, grayAt, thetaOf, lines, medianOf(liverEnv), liver.p50);

  // Caras saturadas: píxeles ≥ 250 a ≤ 1 mm de la cúpula, del contorno renal y de la vesícula, entre los
  // tejidos a ambos lados de cada cara (distancia de `faceSdf` en el punto del píxel).
  const saturatedNear = (face: FaceGeometry, near: readonly number[]): number => {
    let px = 0;
    let sat = 0;
    for (let y = 0; y < img.height; y += 2)
      for (let x = 0; x < img.width; x += 2) {
        const b = pixelToBeam(layout, tr, depth, x, y);
        if (!b) continue;
        const u = Math.round((b.theta + tr.halfSector) / dTheta - 0.5);
        const i = u >= 0 && u < lines ? cellOf(u, b.r) : -1;
        if (i < 0 || !near.includes(tissue[i])) continue;
        // la línea pleural de la cortina (decisión 61) satura por diseño: no es la cara de un órgano
        if (b.r >= curtainFrom[u] - 1) continue;
        const d = sim.anatomy.faceSdfWorld(pointOnLine(sim.frame, tr, b.theta, b.r), sim.sample, face);
        if (d === null || Math.abs(d) > FACE_SATURATION_MM) continue;
        px++;
        if (img.gray[y * img.width + x] >= 250) sat++;
      }
    return px ? sat / px : Number.NaN;
  };
  const faceSaturated = {
    diaphragm: saturatedNear('dome', [DIAPHRAGM, LUNG]),
    morison: saturatedNear('kidneyOuter', [RENAL_CAPSULE, PERIRENAL, Tissue.RenalCortex, Tissue.RenalMedulla]),
    gallbladder: saturatedNear('gallbladder', [Tissue.Fluid, Tissue.BileDuctWall]),
  };
  return {
    envelope,
    bands,
    ...(compound ? { compound } : {}),
    display: {
      liver,
      liverBands,
      lumen,
      diaphragmSaturated,
      shadow,
      profile,
      ...summary,
      faceSaturated,
      wall,
      colorOn: opts.colorOn ?? false,
    },
    ...(opts.samples ? { faceSamples } : {}),
  };
}
