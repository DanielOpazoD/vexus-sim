import type { AnatomyQuery } from '../anatomy/query';
import { DopplerAudio } from '../audio/dopplerAudio';
import type { Vec3 } from '../core/vec3';
import type { PhysiologySample } from '../physiology/engine';
import { SampleVolumeIQ, type GateGeometry } from './sampleVolume';
import { SpectralProcessor } from './spectral';
import { WallFilter } from './wallFilter';

/**
 * Cadena del Doppler pulsado (guía §11–§12): volumen de muestra → IQ → filtro
 * de pared → (a) espectrograma, (b) audio direccional. Una sola realización de
 * señal alimenta las dos salidas. Es independiente de la UI y del render.
 */
export class PwDopplerChain {
  readonly sampleVolume: SampleVolumeIQ;
  readonly wallFilter: WallFilter;
  readonly spectral: SpectralProcessor;
  readonly audio: DopplerAudio;
  private iqRe = new Float32Array(4096);
  private iqIm = new Float32Array(4096);
  private cursor = 0;
  private pending = 0;
  private prfHz = 2600;

  constructor(anatomy: AnatomyQuery, seed: number, audio?: DopplerAudio) {
    this.sampleVolume = new SampleVolumeIQ(anatomy, seed);
    this.wallFilter = new WallFilter(25, this.prfHz);
    this.spectral = new SpectralProcessor({ fftSize: 128, hop: 16 });
    this.audio = audio ?? new DopplerAudio();
  }

  /** Configura equipo y prepara un lote de generación desde `tStart`. */
  begin(prfHz: number, f0Hz: number, gainDb: number, wallFilterHz: number, tStart: number): void {
    this.prfHz = prfHz;
    this.wallFilter.design(wallFilterHz, prfHz);
    this.sampleVolume.setEquipment({ prfHz, f0Hz, gain: Math.pow(10, gainDb / 20) });
    this.spectral.sync(tStart, prfHz);
    this.cursor = 0;
  }

  setGate(g: GateGeometry, s: PhysiologySample): void {
    this.sampleVolume.setGate(g, s);
  }

  /** Genera las muestras IQ correspondientes a un paso fisiológico de `dt` s. */
  step(s: PhysiologySample, probeVelocity: Vec3, dt: number): void {
    this.pending += this.prfHz * dt;
    const n = Math.floor(this.pending);
    this.pending -= n;
    if (n === 0) return;
    if (this.cursor + n > this.iqRe.length) {
      const re = new Float32Array(this.iqRe.length * 2);
      re.set(this.iqRe);
      this.iqRe = re;
      const im = new Float32Array(this.iqIm.length * 2);
      im.set(this.iqIm);
      this.iqIm = im;
    }
    this.sampleVolume.generate(s, probeVelocity, n, this.iqRe, this.iqIm, this.cursor);
    this.cursor += n;
  }

  /** Filtra, espectraliza y envía a audio el lote acumulado. */
  flush(): void {
    if (this.cursor === 0) return;
    this.wallFilter.process(this.iqRe, this.iqIm, this.cursor);
    this.spectral.push(this.iqRe, this.iqIm, this.cursor);
    this.audio.pushIQ(this.iqRe, this.iqIm, this.cursor, this.prfHz);
    this.cursor = 0;
  }

  reset(): void {
    this.spectral.reset();
    this.wallFilter.reset();
    this.audio.reset();
    this.cursor = 0;
    this.pending = 0;
  }
}
