// @tier slow
import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { Tissue } from '../anatomy/tissues';
import { tubeQuery } from '../anatomy/primitives';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { dopplerShiftHz, velocityFromShiftMmS, wrapToNyquist } from '../core/units';
import type { Vec3 } from '../core/vec3';
import { PwDopplerChain } from '../doppler/pwChain';
import type { GateGeometry } from '../doppler/sampleVolume';
import { SpectralProcessor, peakFrequency } from '../doppler/spectral';
import { measureObservedHepatic, observedTrace } from '../doppler/spectralMeasure';
import { WallFilter } from '../doppler/wallFilter';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame, type ProbePose } from '../probe/probe';

describe('Física Doppler (base 10.1 y 10.2)', () => {
  it('ángulo físico: 20 cm/s a 60° con f0=3 MHz → ≈389,6 Hz; a 0° → ≈779,2 Hz', () => {
    const v = 200; // mm/s
    expect(dopplerShiftHz(v * Math.cos(Math.PI / 3), 3e6)).toBeCloseTo(389.6, 0);
    expect(dopplerShiftHz(v, 3e6)).toBeCloseTo(779.2, 0);
  });

  it('plegamiento: +600 Hz con PRF 1000 aparece como −400 Hz', () => {
    expect(wrapToNyquist(600, 1000)).toBeCloseTo(-400, 9);
    expect(wrapToNyquist(-600, 1000)).toBeCloseTo(400, 9);
  });

  it('la corrección angular cambia la velocidad rotulada, nunca la frecuencia física', () => {
    const fd = dopplerShiftHz(128.3, 3e6); // Nyquist de PRF 1000 a 3 MHz ≈ 12,83 cm/s radial
    expect(fd).toBeCloseTo(500, 0);
    expect(velocityFromShiftMmS(fd, 3e6, 0) / 10).toBeCloseTo(12.83, 1);
    expect(velocityFromShiftMmS(fd, 3e6, Math.PI / 3) / 10).toBeCloseTo(25.67, 1);
  });
});

describe('Filtro de pared y espectro', () => {
  const tone = (fHz: number, prf: number, n: number, amp = 1): { re: Float32Array; im: Float32Array } => {
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = amp * Math.cos((2 * Math.PI * fHz * i) / prf);
      im[i] = amp * Math.sin((2 * Math.PI * fHz * i) / prf);
    }
    return { re, im };
  };
  const rms = (re: Float32Array, im: Float32Array, from: number): number => {
    let s = 0;
    for (let i = from; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i];
    return Math.sqrt(s / (re.length - from));
  };

  it('un filtro de pared alto elimina el flujo venoso lento y respeta el rápido', () => {
    const prf = 2500;
    const wf = new WallFilter(100, prf);
    const slow = tone(20, prf, 4000);
    wf.process(slow.re, slow.im);
    expect(rms(slow.re, slow.im, 1000)).toBeLessThan(0.02);
    const fast = tone(600, prf, 4000);
    wf.reset();
    wf.process(fast.re, fast.im);
    expect(rms(fast.re, fast.im, 1000)).toBeGreaterThan(0.95);
    expect(wf.magnitude(20)).toBeLessThan(0.05);
    expect(wf.magnitude(600)).toBeGreaterThan(0.95);
  });

  it('el espectrograma sitúa un tono en su bin y pliega por encima de Nyquist (aliasing)', () => {
    const prf = 2000;
    const sp = new SpectralProcessor({ fftSize: 128, hop: 16 });
    sp.sync(0, prf);
    const a = tone(400, prf, 1024);
    sp.push(a.re, a.im, 1024);
    const col = sp.columns[sp.columns.length - 1];
    expect(Math.abs(peakFrequency(col, 128) - 400)).toBeLessThan(prf / 128);
    sp.reset();
    sp.sync(0, prf);
    const b = tone(1200, prf, 1024); // > PRF/2 → aparece en −800 Hz
    sp.push(b.re, b.im, 1024);
    const col2 = sp.columns[sp.columns.length - 1];
    expect(Math.abs(peakFrequency(col2, 128) + 800)).toBeLessThan(prf / 128);
  });

  it('invertir la pantalla cambia el signo mostrado y no la dirección anatómica inferida', () => {
    const prf = 2000;
    const sp = new SpectralProcessor({ fftSize: 128, hop: 16 });
    sp.sync(0, prf);
    const a = tone(-300, prf, 2048);
    sp.push(a.re, a.im, 2048);
    const base = { f0Hz: 2.5e6, angleCorrectionRad: 0, fftSize: 128 };
    const normal = observedTrace(sp.columns, { ...base, invert: false });
    const inverted = observedTrace(sp.columns, { ...base, invert: true });
    expect(normal[normal.length - 1].vScreen).toBeLessThan(0);
    expect(inverted[inverted.length - 1].vScreen).toBeGreaterThan(0);
    expect(Math.abs(normal[normal.length - 1].vScreen + inverted[inverted.length - 1].vScreen)).toBeLessThan(1e-6);
  });
});

/** Compone la cadena PW sin WebGL para probar puerta, respiración y señal. */
function makeChain(patientPatch: Partial<typeof NORMAL_ADULT> = {}) {
  const patient = { ...clonePatient(NORMAL_ADULT), ...patientPatch };
  const scene = new AnatomyScene(patient);
  const anatomy = new AnatomyQuery(scene);
  const engine = new PhysiologyEngine(patient, scene.vesselAreas());
  const chain = new PwDopplerChain(anatomy, patient.seed);
  const pose: ProbePose = { phi: Math.PI * 0.92, z: 20, lift: 0, yaw: 0, rock: 0, tilt: -0.12 };
  const frame = probeFrame(pose, scene.torso, CONVEX_C35);
  const gateAt = (theta: number, r: number): GateGeometry => {
    const dir = lineDirection(frame, theta);
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const lateral: Vec3 = [
      frame.lateral[0] * c - frame.axial[0] * sn,
      frame.lateral[1] * c - frame.axial[1] * sn,
      frame.lateral[2] * c - frame.axial[2] * sn,
    ];
    return {
      center: pointOnLine(frame, CONVEX_C35, theta, r),
      beamDir: dir,
      lateral,
      elevation: frame.elevation,
      lengthMm: 4,
      lateralSigmaMm: 2.2,
      elevationSigmaMm: 2.0,
      pulseSigmaMm: 0.5,
      transmission: 0.3,
    };
  };
  const runSeconds = (gate: GateGeometry, seconds: number, prf = 2600, wallHz = 25, gainDb = 0) => {
    const steps = Math.round(seconds / engine.clock.dt);
    chain.begin(prf, CONVEX_C35.f0Doppler, gainDb, wallHz, engine.clock.t + engine.clock.dt);
    for (let i = 0; i < steps; i++) {
      const s = engine.step();
      if (i % 8 === 0) chain.setGate(gate, s);
      chain.step(s, [0, 0, 0], engine.clock.dt);
    }
    chain.flush();
  };
  return { patient, scene, anatomy, engine, chain, frame, gateAt, runSeconds };
}

/**
 * Potencia media (dB) de la banda de señal: el 12 % de bins más potentes de cada
 * columna, fuera del clutter residual. Promediar todos los bins diluía la señal
 * de un vaso lento (banda estrecha) entre bins vacíos de ruido.
 */
function meanPowerDb(chain: PwDopplerChain, lastSeconds: number): number {
  const cols = chain.spectral.columns;
  const tEnd = cols[cols.length - 1].t;
  const sel = cols.filter((c) => c.t > tEnd - lastSeconds);
  let acc = 0;
  let n = 0;
  for (const c of sel) {
    const half = c.powerDb.length >> 1;
    const bins: number[] = [];
    for (let k = 0; k < c.powerDb.length; k++) {
      if (Math.abs(k - half) < 3) continue; // fuera del clutter residual
      bins.push(c.powerDb[k]);
    }
    bins.sort((a, b) => b - a);
    const top = Math.max(1, Math.round(bins.length * 0.12));
    for (let i = 0; i < top; i++) {
      acc += Math.pow(10, bins[i] / 10);
      n++;
    }
  }
  return 10 * Math.log10(acc / n);
}

describe('Volumen de muestra físico (guía §10, §21)', () => {
  it('la puerta sobre la suprahepática produce señal; 30 mm dentro del hígado solo ruido', () => {
    const { gateAt, runSeconds, chain, anatomy, engine, scene } = makeChain({ respiratoryPattern: 'apnea-expiratory' });
    // Localizar la suprahepática derecha en el plano
    let best: { theta: number; r: number; bd: number } | null = null;
    // Referencia de parénquima: el punto de hígado MÁS lejano de cualquier interfaz
    // (más que la caja del volumen de muestra, ±2,6 × ±5,5 × ±5 mm), en el mismo plano
    let quiet: { theta: number; r: number; bd: number } | null = null;
    for (let th = -0.5; th <= 0.5; th += 0.02) {
      for (let r = 20; r <= 150; r += 2) {
        const q = anatomy.classifyWorld(gateAt(th, r).center, engine.sample);
        if (q.vessel === 'hvRight' && (!best || q.boundaryDistance > best.bd)) best = { theta: th, r, bd: q.boundaryDistance };
        // «lejos de toda interfaz» incluye los vasos: la clasificación de hígado no mide la
        // distancia a un vaso vecino, así que se comprueba contra todos los tubos (árbol incluido)
        if (q.tissue === Tissue.Liver && q.boundaryDistance > 8) {
          const dVessel = Math.min(...scene.vessels.map((v) => tubeQuery(q.material, v.tube).d));
          const bd = Math.min(q.boundaryDistance, dVessel);
          if (!quiet || bd > quiet.bd) quiet = { theta: th, r, bd };
        }
      }
    }
    expect(best).not.toBeNull();
    expect(quiet).not.toBeNull();
    expect(quiet!.bd).toBeGreaterThan(8);
    runSeconds(gateAt(best!.theta, best!.r), 3);
    const onVessel = meanPowerDb(chain, 1.5);
    chain.reset();
    runSeconds(gateAt(quiet!.theta, quiet!.r), 3);
    const inLiver = meanPowerDb(chain, 1.5);
    // La banda de señal del vaso frente a la cola alta del ruido del parénquima
    // (mismo estadístico): ≥ 9 dB, es decir, ≥ 8× la potencia de los picos de ruido.
    expect(onVessel - inLiver).toBeGreaterThan(9);
  });

  it('la dirección del espectro coincide con la proyección física del flujo sobre el haz', () => {
    const { gateAt, runSeconds, chain, anatomy, engine } = makeChain({ respiratoryPattern: 'apnea-expiratory' });
    let best: { theta: number; r: number; bd: number } | null = null;
    for (let th = -0.5; th <= 0.5; th += 0.02) {
      for (let r = 20; r <= 150; r += 2) {
        const q = anatomy.classifyWorld(gateAt(th, r).center, engine.sample);
        if (q.vessel === 'hvRight' && (!best || q.boundaryDistance > best.bd)) best = { theta: th, r, bd: q.boundaryDistance };
      }
    }
    const gate = gateAt(best!.theta, best!.r);
    // PRF 3200 Hz (escala ±49 cm/s): la envolvente del pico S normal (~40 cm/s con
    // perfil n = 3) no debe plegarse; en el equipo el operador sube la escala igual.
    runSeconds(gate, 4, 3200);
    const q = anatomy.classifyWorld(gate.center, engine.sample);
    const v = q.bloodVelocity!;
    const meanAlong = -(v[0] * gate.beamDir[0] + v[1] * gate.beamDir[1] + v[2] * gate.beamDir[2]);
    const trace = observedTrace(chain.spectral.columns.slice(-150), {
      f0Hz: CONVEX_C35.f0Doppler,
      angleCorrectionRad: 0,
      invert: false,
      fftSize: 128,
    });
    const meanScreen = trace.reduce((a, p) => a + p.vScreen, 0) / trace.length;
    expect(Math.sign(meanScreen)).toBe(Math.sign(meanAlong));
    // y la medición observada reproduce el patrón fisiológico normal (S > D)
    const tNow = engine.clock.t;
    const beats = engine.rhythm.beatsAround(tNow - 2).filter((b) => b.tR > tNow - 3.5 && b.tR + b.rr < tNow);
    const m = measureObservedHepatic(chain.spectral.columns, beats, {
      f0Hz: CONVEX_C35.f0Doppler,
      angleCorrectionRad: 0,
      invert: false,
      fftSize: 128,
    });
    expect(m).not.toBeNull();
    expect(m!.pattern).toBe('normal');
  });

  it('un filtro de pared muy alto borra el flujo venoso lento de la misma puerta', () => {
    const { gateAt, runSeconds, chain, anatomy, engine } = makeChain({ respiratoryPattern: 'apnea-expiratory' });
    let best: { theta: number; r: number; bd: number } | null = null;
    for (let th = -0.5; th <= 0.5; th += 0.02) {
      for (let r = 20; r <= 150; r += 2) {
        const q = anatomy.classifyWorld(gateAt(th, r).center, engine.sample);
        if (q.vessel === 'hvRight' && (!best || q.boundaryDistance > best.bd)) best = { theta: th, r, bd: q.boundaryDistance };
      }
    }
    const gate = gateAt(best!.theta, best!.r);
    runSeconds(gate, 3, 2600, 25);
    const low = meanPowerDb(chain, 1.5);
    chain.reset();
    runSeconds(gate, 3, 2600, 1000);
    const high = meanPowerDb(chain, 1.5);
    expect(low - high).toBeGreaterThan(6);
  });

  it('la respiración desplaza anatomía y volumen de muestra coherentemente: un vaso puede salir de la puerta', () => {
    const { anatomy, engine } = makeChain({ respiratoryPattern: 'deep' });
    // Punto del eje de la rama portal derecha (transversal al desplazamiento caudal)
    const edge: Vec3 = [-69, 3, -32]; // sobre el eje de pvRight (nodos (−58,2,−37) → (−80,4,−31))
    expect(anatomy.classifyWorld(edge, engine.sample).vessel).toBe('pvRight');
    // avanzar hasta inspiración máxima: el vaso baja ~28 mm y el punto fijo queda fuera
    while (engine.sample.resp.volume < 0.95) engine.step();
    const inInsp = anatomy.classifyWorld(edge, engine.sample);
    expect(inInsp.vessel).not.toBe('pvRight');
    // y un punto 28 mm caudal ahora sí está en la rama
    const moved = anatomy.deformation.toWorld(edge, engine.sample.resp);
    expect(anatomy.classifyWorld(moved, engine.sample).vessel).toBe('pvRight');
    // el punto material del tejido no se mueve: solo su posición en el mundo
    const m = anatomy.deformation.toMaterial(moved, engine.sample.resp);
    expect(Math.hypot(m[0] - edge[0], m[1] - edge[1], m[2] - edge[2])).toBeLessThan(0.05);
    expect(engine.sample.resp.diaphragmCaudalMm).toBeGreaterThan(25);
  });

  it('la línea de base es solo presentación: no existe ruta desde baselineShift a la cadena de señal', async () => {
    const src = await import('../doppler/pwChain?raw');
    expect(String(src.default).includes('baseline')).toBe(false);
    const sv = await import('../doppler/sampleVolume?raw');
    expect(String(sv.default).includes('baseline')).toBe(false);
    expect(String(sv.default).includes('angleCorrection')).toBe(false);
  });
});
