import { describe, expect, it, vi } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { PwDopplerChain } from '../doppler/pwChain';
import { SpectralProcessor } from '../doppler/spectral';
import { pwGate } from '../app/pwGate';
import { openSession, placeGate, probeAt, PROFILE } from './support/studentChain';

const PRF = 2000;
const N = 128;
const tone = (n: number, offset = 0) => ({
  re: Float32Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 250 * (i + offset)) / PRF)),
  im: Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 250 * (i + offset)) / PRF)),
});
const push = (p: SpectralProcessor, n: number, offset = 0) => {
  const z = tone(n, offset);
  p.push(z.re, z.im, n);
};

describe('continuidad de la adquisición IQ antes de la FFT', () => {
  it('cambiar la PRF reinicia la adquisición sin reinterpretar las columnas anteriores', () => {
    const p = new SpectralProcessor();
    p.sync(0, PRF);
    push(p, N);
    const previous = p.columns[0];
    expect(p.sync(N / PRF, PRF / 2)).toBe(true);
    push(p, N - 1);
    expect(p.columns).toEqual([previous]);
    push(p, 1, N - 1);
    expect(p.columns[1].prfHz).toBe(PRF / 2);
    expect(previous.prfHz).toBe(PRF);
    expect(p.columns[1].t).toBeCloseTo(N / PRF + N / PRF, 12);
  });

  it('cambiar la PRF descarta memoria del filtro, audio y el residuo de la tasa anterior', () => {
    const scene = new AnatomyScene(NORMAL_ADULT);
    const sample = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).sample;
    const audio = { pushIQ: vi.fn(), reset: vi.fn() };
    const chain = new PwDopplerChain(new AnatomyQuery(scene), 17, audio);
    const reset = vi.spyOn(chain.wallFilter, 'reset');
    const generate = vi.spyOn(chain.sampleVolume, 'generate');
    chain.begin(PRF, 2.5e6, 0, 25, 0);
    chain.step(sample, [0, 0, 0], 0.0003); // 0.6 muestras pendientes a 2 kHz.
    chain.begin(PRF / 2, 2.5e6, 0, 25, 0.0003);
    expect(reset).toHaveBeenCalledOnce();
    expect(audio.reset).toHaveBeenCalledOnce();
    chain.step(sample, [0, 0, 0], 0.0004); // 0.4 nuevas: no sumar el residuo de 2 kHz.
    expect(generate).not.toHaveBeenCalled();
    chain.step(sample, [0, 0, 0], 0.0006);
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][2]).toBe(1);
  });

  it.each([1, -1])('no completa una FFT con muestras separadas por un salto a %s s', (resume) => {
    const p = new SpectralProcessor();
    p.sync(0, PRF);
    push(p, N - 1);
    p.sync(resume, PRF);
    push(p, 1);
    expect(p.columns).toHaveLength(0);
    push(p, N - 1, 1);
    expect(p.columns).toHaveLength(1);
    expect(p.columns[0].t).toBeCloseTo(resume + N / (2 * PRF), 12);
  });

  it('conserva exactamente la FFT al dividir un flujo continuo en lotes', () => {
    const whole = new SpectralProcessor();
    const split = new SpectralProcessor();
    whole.sync(0, PRF);
    push(whole, 512);
    for (let i = 0; i < 512; i += 32) {
      split.sync(i / PRF, PRF);
      push(split, 32, i);
    }
    expect(split.columns).toEqual(whole.columns);
  });

  it('tolera el residuo inferior a una muestra entre reloj fisiológico y PRF', () => {
    const p = new SpectralProcessor();
    p.sync(0, PRF);
    push(p, N - 1);
    p.sync((N - 0.2) / PRF, PRF);
    push(p, 1, N - 1);
    expect(p.columns).toHaveLength(1);
  });

  it('conserva columnas completas anteriores sin presentarlas como muestras nuevas', () => {
    const p = new SpectralProcessor();
    p.sync(0, PRF);
    push(p, N);
    const previous = p.columns[0];
    p.sync(1, PRF);
    push(p, N);
    expect(p.columns).toHaveLength(2);
    expect(p.columns[0]).toBe(previous);
    expect(p.columns[1].t).toBeCloseTo(1 + N / (2 * PRF), 12);
    expect(p.columns[1].powerDb).toEqual(previous.powerDb);
  });

  it('la cadena descarta historia, filtro y audio al interrumpirse la adquisición', () => {
    const audio = { pushIQ: vi.fn(), reset: vi.fn() };
    const chain = new PwDopplerChain(new AnatomyQuery(new AnatomyScene(NORMAL_ADULT)), 17, audio);
    const reset = vi.spyOn(chain.wallFilter, 'reset');
    chain.begin(PRF, 2.5e6, 0, 25, 0);
    push(chain.spectral, N);
    chain.begin(PRF, 2.5e6, 0, 25, N / PRF);
    expect(reset).not.toHaveBeenCalled();
    expect(audio.reset).not.toHaveBeenCalled();
    chain.begin(PRF, 2.5e6, 0, 25, 1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(audio.reset).toHaveBeenCalledTimes(1);
    expect(chain.spectral.columns).toHaveLength(0);
    chain.reset();
    reset.mockClear();
    audio.reset.mockClear();
    chain.begin(PRF, 2.5e6, 0, 25, 0);
    expect(reset).not.toHaveBeenCalled();
    expect(audio.reset).not.toHaveBeenCalled();
  });
});

describe('fronteras efectivas del procesamiento PW', () => {
  it.each([
    { name: 'filtro', f0Hz: 2.5e6, gainDb: 0, wallFilterHz: 100 },
    { name: 'ganancia', f0Hz: 2.5e6, gainDb: 12, wallFilterHz: 25 },
    { name: 'frecuencia', f0Hz: 3.5e6, gainDb: 0, wallFilterHz: 25 },
  ])('no completa una FFT mezclada tras cambiar $name con PRF constante', (next) => {
    const session = openSession(NORMAL_ADULT, 'apnea-expiratory');
    const contact = probeAt(session, 'portalTrunk');
    const placement = placeGate(session, contact, ['pvTrunk']);
    expect(placement).not.toBeNull();
    if (!placement) throw new Error('La ventana debe contener la porta');
    const { gate } = pwGate(
      session.anatomy,
      contact.frame,
      contact,
      PROFILE,
      90,
      { theta: placement.theta, depthMm: placement.r, gateMm: 4 },
      session.engine.sample,
    );
    const chain = session.chain;
    chain.begin(PRF, 2.5e6, 0, 25, 0);
    chain.setGate(gate, session.engine.sample);
    chain.step(session.engine.sample, [0, 0, 0], (N - 1) / PRF);
    chain.flush();
    expect(chain.spectral.columns).toHaveLength(0);
    const particles = chain.sampleVolume.particleCount;
    expect(particles).toBeGreaterThan(0);
    chain.begin(PRF, next.f0Hz, next.gainDb, next.wallFilterHz, (N - 1) / PRF);
    chain.step(session.engine.sample, [0, 0, 0], 1 / PRF);
    chain.flush();
    // La ventana de 128 muestras debe contener sólo el equipo nuevo; ninguna de las 127 antiguas.
    expect(chain.spectral.columns).toHaveLength(0);
    chain.begin(PRF, next.f0Hz, next.gainDb, next.wallFilterHz, N / PRF);
    chain.step(session.engine.sample, [0, 0, 0], (N - 1) / PRF);
    chain.flush();
    expect(chain.spectral.columns).toHaveLength(1);
    expect(Math.max(...chain.spectral.columns[0].powerDb)).toBeGreaterThan(-190);
    expect(chain.sampleVolume.particleCount).toBe(particles);
  });
});
