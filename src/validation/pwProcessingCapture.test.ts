import { describe, expect, it, vi } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { PwDopplerChain } from '../doppler/pwChain';
import { WALL_SETTLE_S } from '../doppler/spectral';
import { captureProtocolVessel } from '../doppler/capture';

const equipment = { prfHz: 4000, f0Hz: 2.5e6, gainDb: 0, wallFilterHz: 25 };
function setup(maxColumns?: number) {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const sample = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).sample;
  const audio = { pushIQ: vi.fn(), reset: vi.fn() };
  const chain = new PwDopplerChain(new AnatomyQuery(scene), 17, audio, { maxColumns });
  const add = (n: number) => {
    chain.step(sample, [0, 0, 0], n / equipment.prfHz);
    chain.flush();
  };
  return { chain, audio, sample, add };
}

// La puerta vacía aísla el procesamiento de ventanas y produce IQ cero; la prueba
// con porta real y señal no nula vive en pwAcquisitionContinuity.test.ts.
describe('captura ligada a la adquisición PW', () => {
  it('invalida de inmediato incluso sin begin posterior y no recupera A al pasar A→B→A', () => {
    const { chain, add } = setup();
    chain.begin(4000, 2.5e6, 0, 25, 0);
    add(128);
    expect(chain.readCapture().kind).toBe('ready');
    chain.configure({ ...equipment, gainDb: 12 });
    chain.configure(equipment);
    expect(chain.readCapture()).toMatchObject({ kind: 'waiting', reason: 'samples' });
    expect(
      captureProtocolVessel('portal', chain.readCapture(), { beatsBetween: () => [] }, 0.032, { angleCorrectionRad: 0, invert: false }, []),
    ).toBeNull();
    chain.begin(4000, 2.5e6, 0, 25, 0.032);
    add(128);
    expect(chain.readCapture()).toMatchObject({ kind: 'waiting', reason: 'settling' });
  });

  it('el margen se ancla al primer centro nuevo, con corte estricto y sin moverse entre lotes', () => {
    const { chain, add } = setup();
    chain.begin(4000, 2.5e6, 0, 25, 0);
    add(128);
    chain.begin(4000, 2.5e6, 12, 25, 0.032);
    add(128);
    const cut = chain.spectral.columns[0].t + WALL_SETTLE_S;
    chain.begin(4000, 2.5e6, 12, 25, 0.064);
    add(400);
    // Los centros se calculan por índices de muestra; el redondeo decimal difiere en ~3e-17 s.
    expect(chain.spectral.columns.at(-1)?.t).toBeCloseTo(cut, 12);
    expect(chain.readCapture().kind).toBe('waiting');
    chain.begin(4000, 2.5e6, 12, 25, 0.164);
    add(16);
    const source = chain.readCapture();
    expect(source.kind).toBe('ready');
    if (source.kind !== 'ready') throw new Error('Falta la primera columna elegible');
    expect(source.columns).toHaveLength(1);
    expect(source.columns[0].t).toBeGreaterThan(cut);
    expect(source.acquiredEquipment).toEqual({ ...equipment, gainDb: 12, fftSize: 128 });
    expect(source.columns).not.toBe(chain.spectral.columns);
  });

  it('podar incluso dentro del primer lote no desplaza la espera', () => {
    const { chain, add } = setup(3);
    chain.begin(4000, 2.5e6, 0, 25, 0);
    add(128);
    chain.begin(4000, 2.5e6, 12, 25, 0.032);
    add(1000);
    const source = chain.readCapture();
    expect(source.kind).toBe('ready');
    if (source.kind !== 'ready') throw new Error('La poda no debe rearmar el margen');
    expect(source.columns).toHaveLength(3);
    expect(source.columns.every((c) => c.t > 0.048 + WALL_SETTLE_S)).toBe(true);
    expect(chain.spectral.columns).toHaveLength(3);
  });

  it('ajustar antes de IQ y resetear una serie no añade demora de arranque', () => {
    const { chain, add } = setup();
    chain.configure(equipment);
    chain.configure({ ...equipment, gainDb: 12 });
    chain.begin(4000, 2.5e6, 12, 25, 0);
    add(128);
    expect(chain.readCapture().kind).toBe('ready');
    chain.configure(equipment);
    chain.reset();
    chain.begin(4000, 2.5e6, 0, 25, 0);
    add(128);
    expect(chain.readCapture().kind).toBe('ready');
  });

  it('descarta lote sin flush, memoria IIR y residuo sin enviar audio viejo ni resetear dos veces', () => {
    const { chain, audio, sample, add } = setup();
    chain.begin(4000, 2.5e6, 0, 25, 0);
    chain.step(sample, [0, 0, 0], 127.6 / 4000);
    const re = new Float32Array(20).fill(1),
      im = new Float32Array(20).fill(1);
    chain.wallFilter.process(re, im);
    chain.configure({ ...equipment, gainDb: 12 });
    expect(audio.reset).toHaveBeenCalledOnce();
    chain.flush();
    expect(audio.pushIQ).not.toHaveBeenCalled();
    chain.begin(4000, 2.5e6, 12, 25, 127.6 / 4000);
    expect(audio.reset).toHaveBeenCalledOnce();
    const zerosRe = new Float32Array(20),
      zerosIm = new Float32Array(20);
    chain.wallFilter.process(zerosRe, zerosIm);
    expect([...zerosRe, ...zerosIm].every((x) => x === 0)).toBe(true);
    add(0.4);
    expect(audio.pushIQ).not.toHaveBeenCalled();
    add(0.6);
    expect(audio.pushIQ).toHaveBeenCalledOnce();
    expect(audio.pushIQ.mock.calls[0][2]).toBe(1);
    expect(chain.spectral.columns).toHaveLength(0);
  });

  it('normalizaciones equivalentes conservan la FFT parcial y la revisión', () => {
    const { chain, audio, add } = setup();
    chain.begin(4000, 2.5e6, 0, 1900, 0); // Ambos cortes se limitan a 0.45 PRF = 1800 Hz.
    add(127);
    const revision = chain.revision;
    chain.begin(4000, 2.5e6, 0, 2000, 127 / 4000);
    add(1);
    expect(chain.spectral.columns).toHaveLength(1);
    expect(chain.revision).toBe(revision);
    expect(audio.reset).not.toHaveBeenCalled();
    expect(chain.readCapture()).toMatchObject({ kind: 'ready', acquiredEquipment: { wallFilterHz: 1800 } });
  });

  it('una configuración inválida no borra la adquisición válida', () => {
    const { chain, audio, add } = setup();
    chain.begin(4000, 2.5e6, 0, 25, 0);
    add(128);
    const before = chain.readCapture();
    expect(() => chain.configure({ ...equipment, gainDb: NaN })).toThrow(RangeError);
    expect(chain.readCapture()).toEqual(before);
    expect(audio.reset).not.toHaveBeenCalled();
  });
});
