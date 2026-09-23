import { describe, expect, it } from 'vitest';
import { ecgX, SweepTimeline } from '../ui/sweep';

/**
 * El espectrograma y el ECG comparten eje temporal (guía §4 y §21: «ECG y ondas con el mismo
 * reloj»). Se simula el mapa de bits del espectro como una fila de instantes por píxel, con cuadros
 * de duración irregular, y se exige que cada píxel muestre el instante que el ECG pone en esa x.
 * Con el desplazamiento anterior (cada columna ocupaba round(dtCol·px/s) píxeles) el espectro
 * avanzaba al doble del ECG a 25 mm/s y PRF 2600.
 */
function simulate(prfHz: number, hop: number, W: number, secondsVisible: number, seed: number) {
  let state = seed >>> 0;
  const rnd = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const pxPerSec = W / secondsVisible;
  const dtCol = hop / prfHz;
  const labels = new Float64Array(W).fill(Number.NaN);
  const tl = new SweepTimeline();
  let lastDrawn = -Infinity;
  let t = 1;
  // columnas centradas en k·dtCol, disponibles medio intervalo después (retardo de la ventana)
  for (let frame = 0; frame < 600; frame++) {
    t += 0.01 + 0.03 * rnd();
    const { shiftPx, cleared } = tl.advance(t, pxPerSec);
    if (cleared) {
      labels.fill(Number.NaN);
      lastDrawn = t - secondsVisible;
    } else if (shiftPx > 0) {
      labels.copyWithin(0, shiftPx);
      labels.fill(Number.NaN, W - shiftPx);
    }
    for (let k = Math.floor(lastDrawn / dtCol) + 1; (k + 0.5) * dtCol <= t; k++) {
      const tc = k * dtCol;
      if (tc <= lastDrawn) continue;
      if (!tl.ready(tc, dtCol)) break;
      const [x0, x1] = tl.span(tc, dtCol, pxPerSec, W);
      for (let x = x0; x < x1; x++) labels[x] = tc;
      lastDrawn = tc;
    }
  }
  // error máximo entre el instante mostrado y el del ECG en esa x (en píxeles)
  let worst = 0;
  let filled = 0;
  for (let x = 0; x < W; x++) {
    if (!Number.isFinite(labels[x])) continue;
    filled++;
    const xEcg = ecgX(labels[x], t, secondsVisible, W);
    worst = Math.max(worst, Math.abs(xEcg - (x + 0.5)));
  }
  return { worst, filled, colPx: dtCol * pxPerSec };
}

describe('Espectrograma en el eje temporal del ECG', () => {
  // main.ts: segundos visibles = ancho CSS / (barrido · 3,2 px/mm); W = píxeles del lienzo (× dpr)
  for (const prf of [500, 1500, 2600, 4000, 7000])
    for (const dpr of [1, 2])
      for (const sweepMmS of [25, 50, 100]) {
        it(`PRF ${prf} Hz, dpr ${dpr}, ${sweepMmS} mm/s: cada píxel muestra el instante del ECG`, () => {
          const cssWidth = 860;
          const W = cssWidth * dpr;
          const secondsVisible = cssWidth / (sweepMmS * 3.2);
          const { worst, filled, colPx } = simulate(prf, 16, W, secondsVisible, prf + W + sweepMmS);
          expect(filled).toBeGreaterThan(W * 0.8);
          // a menos de media columna más un píxel (también cuando una columna ocupa < 1 px)
          expect(worst).toBeLessThanOrEqual(Math.max(colPx, 1) / 2 + 1);
        });
      }
});
