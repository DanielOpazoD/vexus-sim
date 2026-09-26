import { modeHasColor, modeHasPw, type ImagingMode } from '../../app/equipment';
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
  /** Armónica tisular (decisión 77): «THI» delante de la frecuencia de la imagen. */
  harmonic: boolean;
  mode: ImagingMode;
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
      `${(v.depthMm / 10).toFixed(0)} cm · ${v.harmonic ? 'THI ' : ''}${mhz(v.transducerMHz)} MHz · G ${v.gainDb} dB · RD ${v.dynamicRangeDb}` +
        (v.compound ? ' · CX' : ''),
    ],
    // en tríplex (decisión 66) las dos líneas: la del color y la del PW
    bottomRight:
      v.mode === 'B'
        ? [`resp ${v.respVolume.toFixed(2)}`]
        : [
            ...(modeHasColor(v.mode)
              ? [`Color ±${nyq(v.color.prfHz)} cm/s · WF ${v.color.wallFilterHz} Hz · ${v.color.frameHz.toFixed(0)} Hz`]
              : []),
            ...(modeHasPw(v.mode) ? [`PW ±${nyq(v.pw.prfHz)} cm/s · puerta ${v.pw.gateMm.toFixed(1)} mm`] : []),
          ],
    chip: [
      ...(modeHasColor(v.mode) ? [`±${nyq(v.color.prfHz)} cm/s`] : []),
      ...(modeHasPw(v.mode) ? [`Puerta ${(v.pw.depthMm / 10).toFixed(1)} cm · ${v.pw.sweepMmS} mm/s`] : []),
    ].join(' · '),
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
