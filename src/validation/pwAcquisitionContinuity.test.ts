import { describe, expect, it, vi } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { PwDopplerChain } from '../doppler/pwChain';
import { SpectralProcessor } from '../doppler/spectral';

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

  it('la cadena descarta memoria del filtro y audio únicamente al interrumpirse la adquisición', () => {
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
    expect(chain.spectral.columns).toHaveLength(1);
    chain.reset();
    reset.mockClear();
    audio.reset.mockClear();
    chain.begin(PRF, 2.5e6, 0, 25, 0);
    expect(reset).not.toHaveBeenCalled();
    expect(audio.reset).not.toHaveBeenCalled();
  });
});
