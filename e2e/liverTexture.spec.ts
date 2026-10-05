import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach } from './support';

// Guardas originales, ejecutables antes de invertir en las capturas de un candidato.
checkAfterEach();

test('el banco de fidelidad mide el moteado del hígado despejado: el de un campo ideal con la textura del hígado', async ({ page }) => {
  // Banco de fidelidad (decisión 52). Con GPU real (M4) la subxifoidea del sano daba SNR 1,77,
  // fracción oscura 0,07, grietas 0,05, grano axial 0,77 mm (0,70 antes del pulso que se alarga con la profundidad,
  // decisión 84), lateral 0,94–1,08 × la PSF y lóbulos < 0,03; la imagen mostrada, hígado en 92 de gris (mediana). Un
  // defecto del moteado (intensidad,
  // magnitudes antes del haz, retícula periódica), una sombra dentro de la máscara o una lectura de
  // la imagen al revés lo sacan de estas bandas (src/validation/fidelity*.test.ts). Desde la decisión 89 el hígado lleva
  // su textura (dispersores fuertes y densidad de 4 mm) y las bandas se desplazan con lo que predice el gemelo
  // (`parenchymaTextureTwin.test.ts`): SNR ×0,84–0,88 (1,69–1,75), oscuros +0,01, grietas +0,03–0,06 y un grano medido
  // +11–13 % en profundidad y +6–15 % a lo ancho (el pedestal de la densidad en la autocovarianza). Con SwiftShader la
  // subxifoidea da SNR 1,58–1,61, oscuros 0,087–0,089, grietas 0,14–0,15, grano axial 0,83–0,85 mm y lateral 1,10–1,17 × la
  // PSF. Los defectos, con la textura en el gemelo: la intensidad da SNR 0,78–0,87, |Re f| 1,24–1,29 con oscuros 0,19–0,20
  // y grietas 0,29–0,41, y suavizar la envolvente 2,09–2,20 (binomial [¼ ½ ¼]²) o 2,42–2,59 (caja de 3 × 5): SNR 1,45–1,9
  // (antes 1,75–2,1), oscuros 0,05–0,11 y grietas < 0,25 los dejan fuera.
  budget(240_000);
  const errors = await bootWithoutErrors(page);
  // guarda de una mirada (decisión 58): compuesto apagado, umbrales de siempre
  const s = await page.evaluate(() => window.__vexusTest!.fidelity({ startPoint: 'subxiphoid', display: true, compound: false }));
  const e = s.envelope;
  const tag = JSON.stringify(e);
  // con la compresión (decisión 63) la subxifoidea deja menos hígado despejado en el plano (16–17 parches
  // en local, 15 en el CI de GitHub; antes, > 15): 12 parches de 16 × 8 bastan para la SNR y la fracción oscura
  expect(e.patches, tag).toBeGreaterThanOrEqual(12);
  expect(e.snr, tag).toBeGreaterThan(1.45);
  expect(e.snr, tag).toBeLessThan(1.9);
  expect(e.darkFraction, tag).toBeGreaterThan(0.05);
  expect(e.darkFraction, tag).toBeLessThan(0.11);
  expect(e.crackIndex, tag).toBeLessThan(0.25);
  expect(e.secondaryLobeAxial, tag).toBeLessThan(0.15);
  expect(e.secondaryLobeLateral, tag).toBeLessThan(0.15);
  expect(e.fwhmAxialMm, tag).toBeGreaterThan(0.5);
  expect(e.fwhmAxialMm, tag).toBeLessThan(1.0);
  const bands = s.bands.filter((b) => b.patches >= 5);
  expect(bands.length, JSON.stringify(s.bands)).toBeGreaterThan(0);
  for (const b of bands) {
    expect(b.fwhmLateralMm / b.beamFwhmMm, JSON.stringify(b)).toBeGreaterThan(0.8);
    expect(b.fwhmLateralMm / b.beamFwhmMm, JSON.stringify(b)).toBeLessThan(1.4);
  }
  // la imagen mostrada se lee con la orientación correcta (la máscara del hígado cae en hígado) y el
  // preajuste abdominal (decisión 53) deja el hígado a media escala: mediana 92, desviación 16 con GPU real (97
  // antes de la banda del foco de la decisión 84, que deja algo más oscuro el hígado somero de la subxifoidea; con la
  // textura de la decisión 89 la desviación del log de la envolvente crece ×1,08–1,10 en el gemelo, así que el techo pasa
  // de 19 a 19 × 1,10 ≈ 21; la de la imagen es 18,3 con SwiftShader); la luz, casi negra
  const d = s.display!;
  const dtag = JSON.stringify({ liver: d.liver, lumen: d.lumen });
  expect(d.liver.pixels, dtag).toBeGreaterThan(1000);
  expect(d.liver.p50, dtag).toBeGreaterThan(85);
  expect(d.liver.p50, dtag).toBeLessThan(120);
  expect(d.liver.sd, dtag).toBeLessThan(21);
  expect(d.lumen.p50, dtag).toBeLessThan(30);
  expect(d.colorOn).toBe(false);
  expect(errors).toEqual([]);
});

test('composición espacial: más SNR con el mismo grano, sin huecos, y la mirada dirigida de la GPU igual a su gemelo', async ({ page }) => {
  // Decisión 58 con SwiftShader (misma aritmética float32 que la GPU; el banco repite G1–G8 con GPU real y
  // calibra θ en 6–8°). Tres miradas intercaladas (0, ±θ) formadas en la rejilla común y promediadas en
  // lineal: la SNR de la envolvente sube como √N_eff (Burckhardt 1978) sin agrandar el grano (no es un
  // filtro, §23), y la fracción oscura y las grietas del moteado casi desaparecen. Gemelo B→C→D a ±7°
  // (subxifoidea, compoundSpeckle.test.ts): SNR 1,99 → 3,10 / 2,81 / 2,45 / 2,91 a 20 / 45 / 90 / 150 mm,
  // fracción oscura 0,06 → 0,003–0,012, grano compuesto/mirada 0 0,92–1,05. La mirada 0 sigue siendo la de
  // siempre: las guardas de una mirada de este archivo miden con el compuesto apagado.
  // Decisión 89: la textura del hígado (nodos fuertes y densidad de 4 mm) es la misma en las tres miradas, así que la
  // composición no la promedia: en el gemelo (`parenchymaTextureTwin.test.ts`) N_eff baja de 1,61–2,29 a 1,27–1,57 y la
  // SNR del compuesto ×0,75–0,80 (2,06–2,33; SwiftShader 1,91–2,02, GPU 1,86–2,15), con SNRc/SNR0 ÷ √N_eff en 1,03–1,08
  // (SwiftShader 1,03, GPU 0,97–1,03: dentro del ± 10 % de G1);
  // cada mirada ×0,84–0,88 (SwiftShader 1,57–1,67). La fracción oscura del compuesto, 0,007–0,018 (GPU 0,007–0,025),
  // sigue bajo G2 y separa el compuesto de una mirada (0,07–0,10).
  budget(240_000);
  const errors = await bootWithoutErrors(page);
  // la subxifoidea basculada 10° menos: con la sonda que solo empuja (decisión 63) la punta de la de partida (26°)
  // no apoya más allá de +18° y lo hondo sube ~16 mm; en la rejilla de la e2e le quedaba 1 parche compuesto de
  // hígado despejado a 20–60 mm (5 en main, el mínimo). Con 16° apoyan 177 de 192 líneas: 7 parches
  const s = await page.evaluate(() =>
    window.__vexusTest!.fidelity({ startPoint: 'subxiphoid', display: true, compound: true, pose: { rockDeg: -10 } }),
  );
  const c = s.compound!;
  expect(c, 'el banco devuelve la composición').toBeTruthy();
  const bands = c.bands.filter((b) => b.compound.patches >= 5 && b.look0.patches >= 5);
  expect(bands.length, JSON.stringify(c.bands.map((b) => [b.r0, b.compound.patches]))).toBeGreaterThan(0);
  for (const b of c.bands)
    test.info().annotations.push({
      type: `compuesto ${b.r0}–${b.r1} mm`,
      description:
        `parches ${b.compound.patches}; SNR ${b.look0.snr.toFixed(2)} → ${b.compound.snr.toFixed(2)} (×${b.snrGain.toFixed(3)}, √N_eff ${Math.sqrt(b.nEff).toFixed(3)}); ` +
        `ρ(0,+) ${b.rho0p.toFixed(3)} ρ(0,−) ${b.rho0m.toFixed(3)} ley ${b.law1.toFixed(3)}; ρ(−,+) ${b.rhoPm.toFixed(3)} ley ${b.law2.toFixed(3)}; ` +
        `N_eff ${b.nEff.toFixed(2)} ley ${b.nEffLaw.toFixed(2)}; oscuros ${b.look0.darkFraction.toFixed(3)} → ${b.compound.darkFraction.toFixed(3)}; ` +
        `grietas ${b.compound.crackIndex.toFixed(3)}; grano ${b.grainRatioLateral.toFixed(3)} × ${b.grainRatioAxial.toFixed(3)}; ` +
        `por mirada SNR ${b.perLook.map((t) => t.snr.toFixed(2)).join('/')} media ${b.perLook.map((t) => t.meanRatio.toFixed(3)).join('/')}`,
    });
  for (const seam of c.seam)
    test.info().annotations.push({
      type: `costura ${seam.r0}–${seam.r1} mm`,
      description: `SNR 2 miradas ${seam.snr2.toFixed(2)} (${seam.patches2}) / 3 miradas ${seam.snr3.toFixed(2)} (${seam.patches3}) = ${seam.ratio.toFixed(3)}`,
    });
  for (const b of bands) {
    const tag = JSON.stringify({
      r0: b.r0,
      compound: b.compound,
      look0: b.look0,
      snrGain: b.snrGain,
      nEff: b.nEff,
      grain: [b.grainRatioLateral, b.grainRatioAxial],
    });
    // G1: SNR del compuesto y su coherencia con N_eff medido (suelos 2,1 / 2,0 con el moteado difuso; con la textura
    // del hígado, ×0,75–0,80 en el gemelo)
    expect(b.compound.snr, tag).toBeGreaterThanOrEqual(b.r0 < 60 || b.r0 >= 140 ? 1.7 : 1.6);
    expect(b.compound.snr, tag).toBeLessThanOrEqual(3.0);
    expect(Math.abs(b.snrGain / Math.sqrt(b.nEff) - 1), tag).toBeLessThanOrEqual(0.1);
    // G2 y G3: sin los huecos oscuros ni las grietas del moteado de una mirada. Con la textura, un 1–2 % de muestras
    // oscuras del compuesto queda en las zonas de menos densidad y una sola alargada da 0,13 (SwiftShader, 7 parches; 0
    // en otra corrida; gemelo 0–0,06): G3 pasa de 0,04 a 0,2 y lo que separa el compuesto de una mirada es G2
    expect(b.compound.darkFraction, tag).toBeLessThanOrEqual(0.035);
    expect(b.compound.crackIndex, tag).toBeLessThanOrEqual(0.2);
    // el grano del compuesto es el de la mirada 0: no es un suavizado (§23), que lo agranda un 20–30 %. Con
    // SwiftShader las bandas tienen 5–10 parches y la razón oscila ±5–8 % (1,109 con 6 parches a 20–60 mm;
    // el gemelo da 1,05 ahí). Con la textura del hígado el pedestal de la densidad agranda más el grano medido del
    // compuesto, que tiene menos varianza de moteado: la razón sube a 1,03–1,10 en el gemelo (SwiftShader 1,10–1,12) y
    // un suavizado da 1,31–1,59. El techo es 1,2 con menos de 10 parches y 1,15 con más (antes 1,15 y 1,1)
    for (const g of [b.grainRatioLateral, b.grainRatioAxial]) {
      expect(g, tag).toBeGreaterThanOrEqual(0.9);
      expect(g, tag).toBeLessThanOrEqual(b.compound.patches < 10 ? 1.2 : 1.15);
    }
    // K5: cada mirada tiene la estadística de la mirada 0 (algo pre-Rayleigh con la textura: 1,45–1,9, antes 1,75–2,1) y
    // su misma media
    for (const t of b.perLook) {
      expect(t.snr, tag).toBeGreaterThan(1.45);
      expect(t.snr, tag).toBeLessThan(1.9);
      expect(Math.abs(t.meanRatio - 1), tag).toBeLessThanOrEqual(0.05);
    }
  }
  // K1: el grano lateral del compuesto sigue a la PSF, con el pedestal de la densidad del hígado (decisión 89: 1,08–1,17
  // × la PSF en el gemelo, 1,12–1,26 con SwiftShader y 1,19–1,22 con GPU en las bandas con ≥ 5 parches; antes, techo 1,25)
  for (const b of s.bands.filter((x) => x.patches >= 5)) {
    expect(b.fwhmLateralMm / b.beamFwhmMm, JSON.stringify(b)).toBeGreaterThan(0.8);
    expect(b.fwhmLateralMm / b.beamFwhmMm, JSON.stringify(b)).toBeLessThan(1.4);
  }
  // G4: el gris del hígado puro, a media escala y con la desviación de un equipo (10–16 en las referencias, 10,9–17,0
  // en los paneles reales del juez). Con la textura del hígado (decisión 89) la desviación del log de la envolvente del
  // compuesto crece ×1,19–1,27 en el gemelo: 15,2–15,7 con SwiftShader y 13,6–17,0 con GPU, y la banda pasa de 10,5–14,0
  // (calibrada con el moteado difuso) a 12,5–17,5. El
  // banco lo mide por banda con ≥ 1000 píxeles a densidad 2; con el lienzo de la e2e (densidad 1) puede no
  // haber bandas tan llenas: entonces, el hígado puro entero. La media escala es la del foco por defecto (decisión
  // 84: la emisión enfocada deja fuera del foco el hígado algo más oscuro), en la banda que lo contiene si llega a
  // 1000 píxeles
  const d = s.display!;
  expect(d.liver.pixels, JSON.stringify(d.liver)).toBeGreaterThan(1000);
  const atFocus = d.liverBands.find((b) => b.r0 <= 90 && 90 < b.r1 && b.pixels >= 1000) ?? d.liver;
  expect(atFocus.p50, JSON.stringify(atFocus)).toBeGreaterThanOrEqual(90);
  expect(atFocus.p50, JSON.stringify(atFocus)).toBeLessThanOrEqual(110);
  for (const b of d.liverBands)
    test.info().annotations.push({
      type: `gris ${b.r0}–${b.r1} mm`,
      description: `mediana ${b.p50}, desviación ${b.sd.toFixed(2)} (${b.pixels} px)`,
    });
  const lb = d.liverBands.filter((b) => b.pixels >= 1000);
  for (const b of lb.length ? lb : [d.liver]) {
    expect(b.sd, JSON.stringify(b)).toBeGreaterThanOrEqual(12.5);
    expect(b.sd, JSON.stringify(b)).toBeLessThanOrEqual(17.5);
  }
  // G8: A2 y A dirigidos de la GPU frente a sus gemelos de TS sobre los mismos segmentos de A1
  const parity = await page.evaluate(() =>
    window.__vexusTest!.transmissionParity({ startPoint: 'subxiphoid', every: 8, compound: true, look: 1 }),
  );
  const ptag = JSON.stringify(parity);
  test.info().annotations.push({ type: 'paridad de la mirada +θ', description: ptag });
  expect(parity.samples, ptag).toBeGreaterThan(500);
  // empates de redondeo: 0,04–0,31 % en las rejillas de CPU de las cuatro vistas (steeredParity.test.ts)
  expect(parity.ambiguous!, ptag).toBeLessThanOrEqual(0.01 * parity.samples);
  expect(parity.maxDiffDb, ptag).toBeLessThan(0.01);
  expect(parity.apertureMaxDiffDb!, ptag).toBeLessThan(0.01);
  // y la de sus ecos especulares (A o2.w, decisión 91): sus pares en la apertura mezclados con ella. Cada canal se
  // compara donde él mismo pasa de −60 dB: no puede quedar en 0 porque no se comparó nada
  expect(parity.apertureSamples!, ptag).toBeGreaterThan(500);
  expect(parity.specularSamples!, ptag).toBeGreaterThan(500);
  expect(parity.specularMaxDiffDb!, ptag).toBeLessThan(0.01);
  // una guarda de una mirada no puede medir en silencio una envolvente de otro cuadro
  const guard = await page.evaluate(() => window.__vexusTest!.envelopeGuard({ startPoint: 'subxiphoid' }));
  expect(guard.look, JSON.stringify(guard)).not.toBe(0);
  expect(guard.threw, JSON.stringify(guard)).toBe(true);
  expect(guard.message).toMatch(/la mirada 0 no es del último cuadro/);
  expect(errors).toEqual([]);
});
