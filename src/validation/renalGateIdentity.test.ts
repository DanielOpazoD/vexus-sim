import { describe, expect, it } from 'vitest';
import { captureProtocolVessel } from '../doppler/capture';
import { qualityText } from '../doppler/qualityMessages';
import type { SpectralColumn } from '../doppler/spectral';
import type { GateVesselSample } from '../doppler/vesselIdentity';
import type { Beat } from '../physiology/rhythm';

const beats = Array.from(
  { length: 6 },
  (_, i) =>
    ({
      tR: 0.4 + i * 0.8,
      rr: 0.8,
      tX: 0.56 + i * 0.8,
      tV: 0.75 + i * 0.8,
      tY: 0.86 + i * 0.8,
      tAtrialContraction: 0.29 + i * 0.8,
    }) as Beat,
);
const rhythm = { beatsBetween: (a: number, b: number) => beats.filter((x) => x.tR >= a && x.tR + x.rr <= b) };
const opts = { f0Hz: 2.5e6, angleCorrectionRad: 0, invert: false, fftSize: 128, wallFilterHz: 25 };
const spectrum = (edge = false): SpectralColumn[] =>
  Array.from({ length: 878 }, (_, i) => {
    const powerDb = new Float32Array(128).fill(-80);
    for (let k = edge ? 116 : 80; k <= (edge ? 127 : 104); k++) powerDb[k] = -20;
    for (let k = 50; k < 59; k++) powerDb[k] = -50;
    return { t: (i * 16) / 2600, prfHz: 2600, powerDb };
  });
const track = (arterial: (t: number) => boolean): GateVesselSample[] =>
  Array.from({ length: 540 }, (_, i) => {
    const t = i * 0.01,
      a = arterial(t);
    return { t, vessels: { interlobarArtery2: a ? 0.6 : 0.1, interlobarVein2: a ? 0.1 : 0.6 } };
  });

describe('identidad renal: un espectro arterial fuerte no demuestra continuidad venosa', () => {
  it('rechaza la identificación automática ambigua cuando domina la arteria', () => {
    const cols = spectrum(),
      before = cols.map((c) => [...c.powerDb]);
    const m = captureProtocolVessel(
      'renal',
      cols,
      rhythm,
      5.4,
      opts,
      track(() => true),
    )!;
    expect(m.measuredBeats.length).toBeGreaterThanOrEqual(4);
    expect(m.quality.issue).toBe('renal-identity');
    expect(qualityText(m.quality)).toContain('arteria');
    expect(cols.map((c) => [...c.powerDb])).toEqual(before);
  });
  it('conserva una captura cuyo volumen está dominado por la vena', () => {
    const m = captureProtocolVessel(
      'renal',
      spectrum(),
      rhythm,
      5.4,
      opts,
      track(() => false),
    )!;
    expect(m.quality.issue).toBeNull();
  });
  it('considera solo la identidad de los latidos realmente medidos', () => {
    const t = track((v) => v < 2);
    for (const s of t) if (s.t < 2) s.vessels.interlobarArtery2 = 100;
    const m = captureProtocolVessel('renal', spectrum(), rhythm, 5.4, opts, t)!;
    expect(m.measuredBeats[0].tR).toBeGreaterThanOrEqual(2);
    expect(m.quality.issue).toBeNull();
  });
  it('rechaza un latido arterial aunque la media de toda la captura sea venosa', () => {
    const m = captureProtocolVessel(
      'renal',
      spectrum(),
      rhythm,
      5.4,
      opts,
      track((t) => t >= 2 && t < 2.8),
    )!;
    expect(m.quality.issue).toBe('renal-identity');
  });
  it('no oculta un problema físico de aliasing ya detectado', () => {
    const m = captureProtocolVessel(
      'renal',
      spectrum(true),
      rhythm,
      5.4,
      opts,
      track(() => true),
    )!;
    expect(m.quality.issue).toBe('aliasing');
  });
});
