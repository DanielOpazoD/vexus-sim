import { errorLog, errorMessage } from '../../app/errorLog';
import type { Simulator } from '../../app/simulator';
import type { Banner } from './banner';

/**
 * Pérdida y recuperación del contexto WebGL de la imagen: avisa, registra y reconstruye el
 * renderer al restaurarse (y avisa con `onRestored`: el cine y la franja M eran del renderer viejo). `lost` lo
 * consulta el bucle para no dibujar sin contexto.
 */
export function bindGpuLifecycle(
  canvas: HTMLCanvasElement,
  getSim: () => Simulator,
  banner: Banner,
  onRestored: () => void = () => undefined,
): { readonly lost: boolean } {
  const state = { lost: false };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    state.lost = true;
    errorLog.report('gpu', 'contexto WebGL perdido');
    banner.show('Contexto GPU perdido: recuperando…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      getSim().rebuildRenderer(canvas);
      state.lost = false;
      banner.hide();
      onRestored();
    } catch (e) {
      errorLog.report('gpu', e);
      banner.show(`No se pudo recuperar la GPU: ${errorMessage(e)}`);
    }
  });
  return state;
}
