import { CONVEX_BEAM, beamFwhmMm, focalReferenceFwhmMm, type BeamParams } from './beamModel';

/**
 * El eco de la imagen B en TS (decisión 84): la bajada de su frecuencia central y la ganancia focal, gemelos de
 * `echoFrequency` y `focalGain` de `LATERAL_PSF_GLSL`, para el banco de fidelidad y los gemelos de validación. El
 * renderizador no los usa (las fórmulas van en el GLSL, con sus parámetros en `uBeamTx` y `uFocus`), así que viven
 * fuera de `beamModel.ts` y del chunk principal, que tiene presupuesto (`tools/ci/bundle-budget.ts`).
 */

/** f(r)/f0 del eco a la profundidad r (mm): 1/(1 + κ·r). */
export function frequencyRatio(rMm: number, p: BeamParams = CONVEX_BEAM): number {
  return 1 / (1 + p.downshiftRxPerMm * Math.max(0, rMm));
}

/**
 * Ganancia focal (amplitud, decisión 84): cómo cambia con la profundidad el eco de un medio difuso por la concentración
 * de la emisión en el foco. Con haces gaussianos y la potencia fija, la intensidad en el eje va como 1/FWHM
 * (conservación de la energía a través del haz), en la emisión y, por reciprocidad, en la sensibilidad de la
 * recepción; el eco de un medio difuso es ∫|h_tx|²·|h_rx|² a lo ancho del haz, ∝ 1/√(FWHM_tx² + FWHM_rx²), y su
 * amplitud, (FWHM_tx² + FWHM_rx²)^(−¼). En armónica la fuente del armónico es p1²: su intensidad va como la de la
 * emisión al cuadrado, ∝ 1/FWHM_tx² (con la FWHM del haz efectivo, ya /√2 en `txScale`), y la amplitud, como
 * FWHM_tx^(−½)·(FWHM_tx² + FWHM_rx²)^(−¼). Las dos: (FWHM_tx,ref/FWHM_tx)^(n − ½)·√(|FWHM_ref|/|FWHM|), con n
 * (`focalExponent`) ½ y 1 y |FWHM| = √(FWHM_tx² + FWHM_rx²); fuera del foco, donde la emisión es mucho más ancha
 * que la recepción, va como FWHM_tx^(−n) [DERIVADO de haces gaussianos]. La referencia es fija, los haces en el foco
 * con el foco del preajuste (`focalReferenceMm`, el foco por defecto): con él vale 1 en el foco, así que el hígado
 * sigue a media escala en el foco por defecto (decisión 53), y menos por encima y por debajo, la banda algo más clara
 * del foco (Oosterveld, Thijssen y Verhoef 1985, Ultrason Imaging 7:142: la amplitud media del eco culmina en el
 * foco). Con otro foco la banda se mueve con él y su pico cambia con su cintura: más claro con el foco somero y
 * estrecho, más apagado con el hondo y ancho, como la potencia emitida repartida en otra anchura; con un foco hondo el
 * pico se adelanta (a 122 mm con el foco a 140: pasada la apertura máxima la recepción se ensancha con r), con la cima
 * plana (≤ 0,2 dB sobre el valor en el foco). Con la emisión de Hann de la imagen B a F/3,5 da −4,1 dB a 20 mm y −3,9 dB a 150 mm en fundamental, y −5,0 / −4,7 dB en armónica:
 * la emisión a f1 enfoca menos, pero la fuente p1² dobla los dB de la emisión. Contraste: Bottenus 2018 (IEEE TUFFC
 * 65:30) mide 8,2 y 9,6 dB de señal entre la emisión enfocada a 40 mm y la enfocada en cada profundidad, a 10 y 95 mm
 * (sectorial de 19,2 mm a 2,98 MHz); con ese montaje y emisión uniforme el modelo da 10–13 y 7,5 dB (con la de Hann,
 * 7–9 y 3,5 dB). Solo el eco de la imagen B, no el ruido del receptor, el transitorio ni el Doppler.
 */
export function focalGain(rMm: number, focusMm: number, p: BeamParams = CONVEX_BEAM): number {
  const ref = focalReferenceFwhmMm(p);
  const w = beamFwhmMm(rMm, focusMm, p);
  return Math.pow(ref.tx / w.tx, p.focalExponent - 0.5) * Math.sqrt(Math.hypot(ref.tx, ref.rx) / Math.hypot(w.tx, w.rx));
}
