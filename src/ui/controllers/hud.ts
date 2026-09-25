import { nyquistVelocityCms } from '../../core/units';

/**
 * Textos del HUD de la imagen (esquinas y chip de contexto) como función pura de una vista
 * de solo lectura del simulador: se prueba sin DOM y `main.ts` solo los pinta.
 */
export interface HudInput {
  patientLabel: string;
  frozen: boolean;
  heartRateBpm: number;
  atrialFibrillation: boolean;
  transducerMHz: number;
  f0DopplerHz: number;
  depthMm: number;
  gainDb: number;
  dynamicRangeDb: number;
  /** Composición espacial formándose (decisión 58: `compoundActive`, apagada con el color): «CX». */
  compound: boolean;
  mode: 'B' | 'color' | 'pw';
  color: { prfHz: number; wallFilterHz: number; frameHz: number };
  pw: { prfHz: number; gateMm: number; depthMm: number; sweepMmS: number };
  respVolume: number;
}

export interface HudText {
  topLeft: string[];
  topRight: string[];
  bottomRight: string[];
  chip: string;
}

const mhz = (v: number) => v.toFixed(1).replace('.', ',');

export function hudText(v: HudInput): HudText {
  const nyq = (prf: number) => Math.round(nyquistVelocityCms(prf, v.f0DopplerHz));
  return {
    topLeft: [v.patientLabel + (v.frozen ? ' · congelada' : '')],
    topRight: [
      `FC ${Math.round(v.heartRateBpm)} lpm · ${v.atrialFibrillation ? 'FA' : 'Sinusal'}`,
      `${(v.depthMm / 10).toFixed(0)} cm · ${mhz(v.transducerMHz)} MHz · G ${v.gainDb} dB · RD ${v.dynamicRangeDb}` +
        (v.compound ? ' · CX' : ''),
    ],
    bottomRight: [
      v.mode === 'color'
        ? `Color ±${nyq(v.color.prfHz)} cm/s · WF ${v.color.wallFilterHz} Hz · ${v.color.frameHz.toFixed(0)} Hz`
        : v.mode === 'pw'
          ? `PW ±${nyq(v.pw.prfHz)} cm/s · puerta ${v.pw.gateMm.toFixed(1)} mm`
          : `resp ${v.respVolume.toFixed(2)}`,
    ],
    chip:
      v.mode === 'color'
        ? `±${nyq(v.color.prfHz)} cm/s`
        : v.mode === 'pw'
          ? `Puerta ${(v.pw.depthMm / 10).toFixed(1)} cm · ${v.pw.sweepMmS} mm/s`
          : '',
  };
}

/** FC mostrada como un monitor: media móvil (en FA el RR latido a latido salta). */
export class HeartRateDisplay {
  private value = 0;
  update(rrSeconds: number, dtSeconds: number): number {
    const hr = 60 / rrSeconds;
    this.value = this.value ? this.value + (hr - this.value) * Math.min(1, dtSeconds * 1.5) : hr;
    return this.value;
  }
}

/** Sustituye el contenido de `host` por una línea `<span>` por texto. */
export function renderLines(host: HTMLElement, lines: readonly string[]): void {
  host.replaceChildren(
    ...lines.map((l) => {
      const s = document.createElement('span');
      s.textContent = l;
      return s;
    }),
  );
}
