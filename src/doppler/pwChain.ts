import type { AnatomyQuery } from '../anatomy/query';
import type { Vec3 } from '../core/vec3';
import type { PhysiologySample } from '../physiology/engine';
import { SampleVolumeIQ, type GateGeometry } from './sampleVolume';
import { SpectralProcessor, WALL_SETTLE_S, type SpectralColumn } from './spectral';
import type { MeasureOptions } from './spectralMeasure';
import { effectiveWallFilterCutoff, WallFilter } from './wallFilter';

/** Audio y espectro consumen la misma IQ; el núcleo no conoce Web Audio. */
export interface AudioSink {
  pushIQ(re: Float32Array, im: Float32Array, n: number, prfHz: number): void;
  reset(): void;
}

export const SILENT_AUDIO: AudioSink = { pushIQ: () => undefined, reset: () => undefined };
export type PwProcessing = Readonly<Required<Pick<MeasureOptions, 'f0Hz' | 'gainDb' | 'wallFilterHz'>> & { prfHz: number }>;
export type PwAcquiredEquipment = Readonly<PwProcessing & Pick<MeasureOptions, 'fftSize'>>;
export type PwPresentation = Readonly<Pick<MeasureOptions, 'angleCorrectionRad' | 'invert'>>;
export type PwCaptureSource =
  | { readonly kind: 'waiting'; readonly revision: number; readonly reason: 'samples' | 'settling' }
  | {
      readonly kind: 'ready';
      readonly revision: number;
      readonly acquiredEquipment: PwAcquiredEquipment;
      readonly columns: readonly SpectralColumn[];
    };

type CaptureCut = { kind: 'none' } | { kind: 'pending' } | { kind: 'after'; t: number };

/** Volumen de muestra → IQ → filtro de pared → espectrograma y audio. */
export class PwDopplerChain {
  readonly sampleVolume: SampleVolumeIQ;
  readonly wallFilter: WallFilter;
  readonly spectral: SpectralProcessor;
  readonly audio: AudioSink;
  #iqRe = new Float32Array(4096);
  #iqIm = new Float32Array(4096);
  #cursor = 0;
  #pending = 0;
  #prfHz = 2600;
  #processing: PwProcessing | null = null;
  #currentRevision = 0;
  #hadIq = false;
  #captureCut: CaptureCut = { kind: 'none' };

  constructor(anatomy: AnatomyQuery, seed: number, audio: AudioSink = SILENT_AUDIO, history: { maxColumns?: number } = {}) {
    this.sampleVolume = new SampleVolumeIQ(anatomy, seed);
    this.wallFilter = new WallFilter(25, this.#prfHz);
    this.spectral = new SpectralProcessor({ fftSize: 128, hop: 16, ...history });
    this.audio = audio;
  }

  get revision(): number {
    return this.#currentRevision;
  }

  /** Adopta equipo efectivo incluso sin avanzar el reloj; una petición equivalente no invalida. */
  configure(next: PwProcessing): void {
    const { prfHz, f0Hz, gainDb, wallFilterHz } = next;
    if (![prfHz, f0Hz, gainDb, wallFilterHz].every(Number.isFinite) || prfHz <= 0 || f0Hz <= 0)
      throw new RangeError('Invalid PW acquisition settings');
    const cutoffHz = effectiveWallFilterCutoff(wallFilterHz, prfHz);
    const previous = this.#processing;
    if (previous) {
      if (previous.prfHz === prfHz && previous.f0Hz === f0Hz && previous.gainDb === gainDb && previous.wallFilterHz === cutoffHz) return;
      this.#discard();
    }
    this.#processing = Object.freeze({ prfHz, f0Hz, gainDb, wallFilterHz: cutoffHz });
    this.#prfHz = prfHz;
    this.wallFilter.design(cutoffHz, prfHz);
    this.sampleVolume.setEquipment({ prfHz, f0Hz, gain: Math.pow(10, gainDb / 20) });
  }

  /** Configura equipo y prepara un lote de generación desde `tStart`. */
  begin(prfHz: number, f0Hz: number, gainDb: number, wallFilterHz: number, tStart: number): void {
    this.configure({ prfHz, f0Hz, gainDb, wallFilterHz });
    if (this.spectral.sync(tStart, prfHz)) {
      this.#discard();
      this.spectral.sync(tStart, prfHz);
    }
    this.#cursor = 0;
  }

  setGate(g: GateGeometry, s: PhysiologySample): void {
    this.sampleVolume.setGate(g, s);
  }

  /** Genera las muestras IQ correspondientes a un paso fisiológico de `dt` s. */
  step(s: PhysiologySample, probeVelocity: Vec3, dt: number): void {
    this.#pending += this.#prfHz * dt;
    const n = Math.floor(this.#pending);
    this.#pending -= n;
    if (n === 0) return;
    if (this.#cursor + n > this.#iqRe.length) {
      const re = new Float32Array(this.#iqRe.length * 2);
      re.set(this.#iqRe);
      this.#iqRe = re;
      const im = new Float32Array(this.#iqIm.length * 2);
      im.set(this.#iqIm);
      this.#iqIm = im;
    }
    this.sampleVolume.generate(s, probeVelocity, n, this.#iqRe, this.#iqIm, this.#cursor, this.#pending);
    this.#cursor += n;
    this.#hadIq = true;
  }

  /** Filtra, espectraliza y envía a audio el lote acumulado. */
  flush(): void {
    if (this.#cursor === 0) return;
    this.wallFilter.process(this.#iqRe, this.#iqIm, this.#cursor);
    const firstCenter = this.spectral.push(this.#iqRe, this.#iqIm, this.#cursor);
    if (this.#captureCut.kind === 'pending' && firstCenter !== null) this.#captureCut = { kind: 'after', t: firstCenter + WALL_SETTLE_S };
    this.audio.pushIQ(this.#iqRe, this.#iqIm, this.#cursor, this.#prfHz);
    this.#cursor = 0;
  }

  /** Fuente síncrona del clic: señal elegible y sus ajustes adquiridos, nunca mandos ajenos. */
  readCapture(): PwCaptureSource {
    if (!this.#processing || !this.spectral.columns.length) return { kind: 'waiting', revision: this.revision, reason: 'samples' };
    const cut = this.#captureCut;
    const columns = cut.kind === 'after' ? this.spectral.columns.filter((c) => c.t > cut.t) : this.spectral.columns.slice();
    if (cut.kind === 'pending' || !columns.length) return { kind: 'waiting', revision: this.revision, reason: 'settling' };
    return { kind: 'ready', revision: this.revision, acquiredEquipment: { ...this.#processing, fftSize: this.spectral.fftSize }, columns };
  }

  #discard(settle = this.#hadIq || this.#captureCut.kind !== 'none'): void {
    this.spectral.reset();
    this.wallFilter.reset();
    this.audio.reset();
    this.#cursor = 0;
    this.#pending = 0;
    this.#hadIq = false;
    this.#captureCut = settle ? { kind: 'pending' } : { kind: 'none' };
    this.#currentRevision++;
  }

  reset(): void {
    this.#discard(false);
    this.#processing = null;
  }
}
