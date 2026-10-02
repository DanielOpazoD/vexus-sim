import { velocityFromShiftMmS } from '../core/units';
import type { CaptureMark, MeasureOptions, ObservedHepatic, ObservedPortal, ObservedRenal } from '../doppler/spectralMeasure';

/**
 * Lo medido a la vista (decisión 94): tras «Capturar», la traza automática, las marcas (S/D/A de la suprahepática,
 * Vmáx/Vmín de la porta, S/D/mín de la interlobar) y los latidos analizados se dibujan sobre el espectro. Antes el alumno
 * solo veía los números: una PF de 111 % leída sobre el clutter de la línea de base no se podía reconocer. Todo se guarda
 * en frecuencia Doppler física (Hz, + hacia la sonda) con la PRF de sus columnas. El historial y el trazado se presentan
 * con la misma línea de base, inversión y barrido actuales: al cambiarlos se reconstruye el bitmap desde las columnas,
 * incluso congelado. La corrección angular no mueve la señal; en el cine ambos comparten el eje temporal. Deja de dibujarse cuando su espectro ya no está (el PW se apagó o se vació).
 */
export interface CaptureOverlay {
  /** La captura pasó la calidad (y la identidad del vaso): solo entonces se dibujan las marcas. */
  accepted: boolean;
  /** PRF de la captura: la de sus columnas en el espectrograma. */
  prfHz: number;
  /** Traza en Hz físicos; NaN = hueco. */
  trace: { t: number; fHz: number }[];
  marks: { t: number; fHz: number; label: CaptureMark['label'] }[];
  /** Latidos analizados [inicio, fin] (s). */
  beats: [number, number][];
}

/** Hz físicos por cm/s rotulado con los ajustes de la captura (el signo de pantalla incluye la inversión). */
function hzPerScreenCms(opts: Pick<MeasureOptions, 'f0Hz' | 'angleCorrectionRad' | 'invert'>): number {
  const cmsPerHz = velocityFromShiftMmS(1, opts.f0Hz, opts.angleCorrectionRad) / 10;
  return (opts.invert ? -1 : 1) / cmsPerHz;
}

export function captureOverlay(
  m: ObservedHepatic | ObservedPortal | ObservedRenal,
  opts: Pick<MeasureOptions, 'f0Hz' | 'angleCorrectionRad' | 'invert'>,
  prfHz: number,
): CaptureOverlay {
  const k = hzPerScreenCms(opts);
  return {
    accepted: m.quality.issue === null,
    prfHz,
    trace: m.trace.map((p) => ({ t: p.t, fHz: p.vScreen * k })),
    marks: m.marks.map((q) => ({ t: q.t, fHz: q.vScreen * k, label: q.label })),
    beats: m.measuredBeats.map((b) => [b.tR, b.tR + b.rr]),
  };
}

/**
 * Fila (px) del espectrograma de alto H para una frecuencia física, con la misma fórmula con que `SpectrogramView`
 * pinta cada columna: banda [−PRF/2, PRF/2] desplazada por la línea de base (lo que sale de ella se pliega, como el
 * espectro: `wrapToNyquist`) e invertida con la inversión.
 */
export function spectrumRowOf(fHz: number, prfHz: number, display: { baselineShift: number; invert: boolean }, H: number): number {
  let frac = fHz / prfHz + 0.5 - display.baselineShift;
  frac -= Math.floor(frac);
  return display.invert ? frac * H : (1 - frac) * H;
}

/** ¿Sigue a la vista el espectro de la captura? (el PW apagado o reiniciado vacía las columnas). */
export function overlayOnSpectrum(o: CaptureOverlay, columns: readonly { t: number }[]): boolean {
  const last = o.trace[o.trace.length - 1];
  return columns.length > 0 && last !== undefined && columns[0].t <= last.t;
}
