// @tier slow
import { describe, expect, it } from 'vitest';
import { bestGateOnVessel } from '../app/gatePlacement';
import { START_POINTS } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { CAPTURE_BEATS } from '../doppler/measureQuality';
import { PwDopplerChain } from '../doppler/pwChain';
import type { GateGeometry } from '../doppler/sampleVolume';
import { captureNoiseFloorsDb, type SpectralColumn } from '../doppler/spectral';
import { measureObservedHepatic, smoothSpectrum, type MeasureOptions } from '../doppler/spectralMeasure';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient, type PatientState, type RespiratoryPattern } from '../physiology/patientState';
import type { VesselId } from '../physiology/vessels';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame } from '../probe/probe';
import { apertureAngleSigmaRad, lateralSigmaMm } from '../ultrasound/beamModel';
import { FRAG_COLOR, FRAG_SCANCONVERT } from '../ultrasound/shaders/passes.glsl';

/**
 * Invariantes de la guía §21 comprobados sobre la SEÑAL de la cadena completa (puerta real sobre un
 * vaso → IQ → espectro → medición), no sobre tonos sintéticos: los sintéticos están en
 * `doppler.test.ts`, la PF > 100 % en `classification.test.ts`, el aliasing de la VSH en
 * `examChain.test.ts` y el reloj común de ECG y espectro en `sweep.test.ts`.
 */
interface Run {
  columns: SpectralColumn[];
  engine: PhysiologyEngine;
  chain: PwDopplerChain;
}

interface Setup extends Run {
  gate: GateGeometry;
  /** Avanza la cadena `seconds` con la puerta `g` (por defecto la colocada sobre el vaso). */
  advance: (seconds: number, g?: GateGeometry) => void;
  /** La puerta desplazada `mm` a lo largo de la línea lateral del haz. */
  shifted: (mm: number) => GateGeometry;
  anatomy: AnatomyQuery;
}

function setup(opts: {
  base?: PatientState;
  seed?: number;
  respiratoryPattern?: RespiratoryPattern;
  window?: (typeof START_POINTS)[number]['id'];
  vessels?: VesselId[];
  historySeconds?: number;
}): Setup {
  const patient = { ...clonePatient(opts.base ?? NORMAL_ADULT), respiratoryPattern: opts.respiratoryPattern ?? 'apnea-expiratory' };
  if (opts.seed !== undefined) patient.seed = opts.seed;
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: opts.historySeconds ?? 20 });
  const chain = new PwDopplerChain(anatomy, patient.seed);
  for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
  const sp = START_POINTS.find((s) => s.id === (opts.window ?? 'intercostal'))!;
  const frame = probeFrame({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, scene.torso, CONVEX_C35);
  const best = bestGateOnVessel(anatomy, frame, CONVEX_C35, engine.sample, opts.vessels ?? ['hvRight'], 170)!;
  const c = Math.cos(best.theta);
  const sn = Math.sin(best.theta);
  const lateral: Vec3 = [
    frame.lateral[0] * c - frame.axial[0] * sn,
    frame.lateral[1] * c - frame.axial[1] * sn,
    frame.lateral[2] * c - frame.axial[2] * sn,
  ];
  const gate: GateGeometry = {
    center: pointOnLine(frame, CONVEX_C35, best.theta, best.r),
    beamDir: lineDirection(frame, best.theta),
    lateral,
    elevation: frame.elevation,
    lengthMm: Math.min(4, 2 * best.bd),
    lateralSigmaMm: lateralSigmaMm(best.r, 90) * 1.2,
    elevationSigmaMm: 1.6,
    pulseSigmaMm: 0.5,
    apertureAngleSigmaRad: apertureAngleSigmaRad(best.r),
    transmission: 0.3,
  };
  chain.begin(Math.min(6000, Math.floor((0.9 * 1_540_000) / (2 * best.r))), CONVEX_C35.f0Doppler, 0, 25, engine.clock.t + engine.clock.dt);
  const out: Setup = {
    columns: chain.spectral.columns,
    engine,
    chain,
    gate,
    anatomy,
    advance: (seconds, g = gate) => {
      for (let i = 0; i < Math.round(seconds / engine.clock.dt); i++) {
        const s = engine.step();
        if (i % 8 === 0) chain.setGate(g, s);
        chain.step(s, [0, 0, 0], engine.clock.dt);
      }
      chain.flush();
      out.columns = chain.spectral.columns;
    },
    shifted: (mm) => ({
      ...gate,
      center: [gate.center[0] + lateral[0] * mm, gate.center[1] + lateral[1] * mm, gate.center[2] + lateral[2] * mm],
    }),
  };
  return out;
}

function run(opts: Parameters<typeof setup>[0] & { seconds: number }): Run {
  const s = setup({ ...opts, historySeconds: opts.seconds + 4 });
  s.advance(opts.seconds);
  return s;
}

const measureOpts = (r: Run, patch: Partial<MeasureOptions> = {}): MeasureOptions => ({
  f0Hz: CONVEX_C35.f0Doppler,
  angleCorrectionRad: 0,
  invert: false,
  fftSize: r.chain.spectral.fftSize,
  wallFilterHz: 25,
  ...patch,
});

function capture(r: Run, patch: Partial<MeasureOptions> = {}) {
  const tNow = r.engine.clock.t;
  const beats = r.engine.rhythm.beatsBetween(tNow - 7, tNow).slice(-CAPTURE_BEATS);
  return measureObservedHepatic(
    r.columns.filter((c) => c.t > tNow - 7),
    beats,
    measureOpts(r, patch),
  )!;
}

describe('Invariantes de la guía §21 sobre la señal de la cadena completa', () => {
  it('mismo estado del paciente y semilla → espectro y medición idénticos bit a bit; otra semilla, otro espectro', () => {
    const a = run({ seconds: 6 });
    const b = run({ seconds: 6 });
    expect(b.columns.length).toBe(a.columns.length);
    for (let i = 0; i < a.columns.length; i++) {
      expect(b.columns[i].t).toBe(a.columns[i].t);
      expect(Array.from(b.columns[i].powerDb)).toEqual(Array.from(a.columns[i].powerDb));
    }
    const ma = capture(a);
    const mb = capture(b);
    expect([mb.sPeak, mb.dPeak, mb.aPeak, mb.pattern, mb.quality.issue]).toEqual([
      ma.sPeak,
      ma.dPeak,
      ma.aPeak,
      ma.pattern,
      ma.quality.issue,
    ]);
    // la prueba no es vacía: otra semilla da otros dispersores (otro moteado espectral)
    const c = run({ seconds: 6, seed: NORMAL_ADULT.seed + 1 });
    const differs = c.columns.some((col, i) => col.powerDb.some((v, k) => v !== a.columns[i].powerDb[k]));
    expect(differs).toBe(true);
  });

  it('invertir la pantalla y corregir el ángulo no cambian el patrón medido de una captura real', () => {
    const r = run({ seconds: 8 });
    const base = capture(r);
    const inverted = capture(r, { invert: true });
    // la inversión cambia el signo de pantalla, nunca la dirección anatómica ni los picos orientados
    expect(inverted.anterogradeSign).toBe(-base.anterogradeSign);
    expect([inverted.sPeak, inverted.dPeak, inverted.pattern]).toEqual([base.sPeak, base.dPeak, base.pattern]);
    // la corrección de 60° reescala las velocidades rotuladas (1 / cos 60° = 2), no la física ni el patrón
    const corrected = capture(r, { angleCorrectionRad: Math.PI / 3 });
    expect(corrected.sPeak / base.sPeak).toBeCloseTo(2, 6);
    expect(corrected.dPeak / base.dPeak).toBeCloseTo(2, 6);
    expect(corrected.pattern).toBe(base.pattern);
    expect(corrected.quality.issue).toBe(base.quality.issue);
  });

  it('un vaso que sale de la puerta pierde la señal y la recupera al volver', () => {
    // Apnea y puerta sobre la VSH; luego desplazada 10 mm al parénquima y de vuelta. Sangre en una
    // columna: ≥ 2 bins contiguos a suelo + 12 dB con |f| ≥ 150 Hz. Con respiración, el clutter del
    // tejido que se mueve (60–70 dB sobre el ruido, por encima de un filtro de pared de 25 Hz) llena
    // la banda del flujo venoso lento y no deja juzgar la sangre en el espectro, como en un equipo
    // real (limitación `respiratory-clutter-masks-slow-flow`); la coherencia entre respiración y
    // volumen de muestra se prueba sobre su composición en `sampleVolume.test.ts`.
    const s = setup({});
    const off = s.shifted(10);
    expect(s.anatomy.classifyWorld(off.center, s.engine.sample).vessel).toBeNull();
    const presence = (from: number) => {
      const cols = smoothSpectrum(s.columns.filter((c) => c.t > from));
      const floors = captureNoiseFloorsDb(cols);
      const withBlood = cols.filter((c, i) => {
        const N = c.powerDb.length;
        let run = 0;
        for (let k = 0; k < N; k++) {
          const f = ((k - N / 2) / N) * c.prfHz;
          run = Math.abs(f) >= 150 && c.powerDb[k] > floors[i] + 12 ? run + 1 : 0;
          if (run >= 2) return true;
        }
        return false;
      });
      return withBlood.length / cols.length;
    };
    const segment = (g: GateGeometry) => {
      const t0 = s.engine.clock.t + 0.5; // tras el cambio de puerta (y el FFT que lo cruza)
      s.advance(3, g);
      return presence(t0);
    };
    const on = segment(s.gate);
    const away = segment(off);
    const back = segment(s.gate);
    const tag = JSON.stringify({ on, away, back });
    expect(on, tag).toBeGreaterThan(0.9);
    expect(away, tag).toBeLessThan(0.05);
    expect(back, tag).toBeGreaterThan(0.9);
  });

  it('la inversión del mapa de color es solo presentación: el estimador no la conoce', () => {
    expect(FRAG_COLOR).not.toMatch(/invert/i);
    expect(FRAG_SCANCONVERT).toContain('uColorInvert');
  });
});
