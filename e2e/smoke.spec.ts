import { expect, test, type Page } from '@playwright/test';

/**
 * Humo de extremo a extremo: lo que ninguna prueba unitaria puede ver — que el
 * módulo arranca en el navegador, que WebGL2 renderiza cuadros, que la UI está
 * cableada (caso, modos, medición) y que no hay errores de consola.
 */
async function bootWithoutErrors(page: Page, query = '?e2e=1'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  // ?e2e expone ganchos de prueba estables (window.__vexusTest); nada más cambia
  await page.goto(`/${query}`);
  await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: 30_000 });
  // los ganchos de prueba se cargan de forma diferida (import dinámico)
  await expect.poll(() => page.evaluate(() => typeof window.__vexusTest), { timeout: 30_000 }).toBe('object');
  return errors;
}

test('arranca, renderiza cuadros y no emite errores', async ({ page }) => {
  const errors = await bootWithoutErrors(page);
  // El reloj de simulación avanza: con SwiftShader un cuadro puede tardar segundos
  // (el bucle limita dt a 0,25 s por cuadro), así que se espera a que t cambie en
  // vez de fijar un plazo; los fps redondeados pueden ser 0 y no se exigen.
  const tOf = (s: string | null) => Number(/t ([\d.]+) s/.exec(s ?? '')?.[1] ?? 0);
  const t1 = tOf(await page.locator('#status').textContent());
  await expect.poll(async () => tOf(await page.locator('#status').textContent()), { timeout: 30_000 }).toBeGreaterThan(t1);
  expect(errors).toEqual([]);
});

test('cambia de caso y el HUD lo refleja', async ({ page }) => {
  const errors = await bootWithoutErrors(page);
  // Si el HUD no cambia, el mensaje dice por qué: caso vivo, selector, avisos y errores de consola
  // (en CI el paso a FA falló dos veces sin más pista que «esperaba FA»).
  const hudOr = async (sel: string, text: string) => {
    const hud = (await page.locator(sel).textContent()) ?? '';
    if (hud.includes(text)) return 'ok';
    const banner = await page.locator('.banner').allTextContents();
    const value = await page.locator('#case-select').inputValue();
    return `hud=${hud} · selector=${value} · avisos=${JSON.stringify(banner)} · errores=${JSON.stringify(errors)}`;
  };
  await page.selectOption('#case-select', 'severe-congestion');
  // modo alumno: el caso se rotula «Paciente B», nunca con su diagnóstico
  await expect.poll(() => hudOr('#hud-tl', 'Paciente B'), { timeout: 30_000 }).toBe('ok');
  await page.selectOption('#case-select', 'af-moderate-congestion');
  await expect.poll(() => hudOr('#hud-tr', 'FA'), { timeout: 30_000 }).toBe('ok');
  expect(errors).toEqual([]);
});

test('modos por teclado, pestaña Medir y captura de una medición', async ({ page }) => {
  test.setTimeout(180_000);
  // ?docente: al final se abre la pestaña Docente (en producción la casilla solo aparece así)
  const errors = await bootWithoutErrors(page, '?e2e=1&docente=1');
  // Técnica del operador: apnea espiratoria (pestaña Adquirir) antes de medir la suprahepática
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.keyboard.press('p');
  await expect(page.locator('#mode-pw')).toHaveClass(/active/);
  await expect(page.locator('#hud-br')).toContainText('PW');
  const capture = async () => {
    await page.getByRole('tab', { name: 'Medir' }).click();
    await page.getByRole('button', { name: 'Suprahepática', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar' }).click();
  };
  // Ventana intercostal (la del protocolo) y la puerta sobre la suprahepática en un punto sin
  // sombras (técnica del operador); 7 s de espectro sin renderizar: con SwiftShader el reloj avanza
  // despacio y 2,5 s no daban latidos completos. Antes la puerta caía en la sombra de la cortina
  // pulmonar y se «medía» el ruido; ahora sería no medible. Medido con GPU: banda 28 dB sobre el
  // suelo (desde la pose inicial la VSH queda a 11 cm con −32 dB y solo 15 dB de banda).
  expect(
    await page.evaluate(() => {
      window.__vexusTest!.goToStartPoint('intercostal');
      return window.__vexusTest!.placeGate(['hvRight', 'hvMiddle']);
    }),
  ).toBe(true);
  await page.evaluate(() => window.__vexusTest!.advance(7));
  await capture();
  // Un valor numérico con el visto bueno de la calidad: «VSH: —» o «no medible» no pasan
  await expect(page.locator('.result')).toContainText(/VSH: S -?\d+\.\d · D -?\d+\.\d/);
  // Sin contacto no hay flujo en la puerta: la captura es no medible, con el motivo
  await page.evaluate(() => {
    window.__vexusTest!.liftProbe(10);
    window.__vexusTest!.advance(7);
  });
  await capture();
  await expect(page.locator('.result')).toContainText('VSH: no medible: no hay flujo en la puerta');
  // y la fila del protocolo no muestra el patrón de esa captura (el de un espectro de ruido es «grave»)
  const hepaticRow = page.locator('.control').filter({ has: page.getByRole('button', { name: 'Suprahepática', exact: true }) });
  await expect(hepaticRow.locator('output')).toHaveText('no medible');
  // Docente: el panel de depuración existe y se actualiza (la verdad fisiológica
  // necesita t > 8 s de simulación, inalcanzable con SwiftShader en CI; se prueba en local).
  // `force`: con render por software el hilo principal no deja al elemento «estable».
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  await expect(page.locator('.debug')).toContainText(/t [\d.]+ s · latido/, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('sobrevive a la pérdida del contexto WebGL: avisa, se recupera y el reloj sigue', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await bootWithoutErrors(page);
  await page.evaluate(() => {
    const gl = (document.getElementById('gl') as HTMLCanvasElement).getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __lc: WEBGL_lose_context }).__lc = ext;
    ext.loseContext();
  });
  await expect(page.locator('.banner')).toContainText('Contexto GPU perdido', { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __lc: WEBGL_lose_context }).__lc.restoreContext());
  await expect(page.locator('.banner')).toHaveCount(0, { timeout: 60_000 });
  const tOf = (s: string | null) => Number(/t ([\d.]+) s/.exec(s ?? '')?.[1] ?? 0);
  const t1 = tOf(await page.locator('#status').textContent());
  await expect.poll(async () => tOf(await page.locator('#status').textContent()), { timeout: 60_000 }).toBeGreaterThan(t1);
  expect(errors).toEqual([]);
});

test('el speckle del parénquima hepático tiene estadística de Rayleigh', async ({ page }) => {
  // Guarda de fidelidad de imagen (Fase 3): la envolvente de un speckle plenamente desarrollado
  // tiene SNR = 1,91. Detectar intensidad (1,0), sumar magnitudes antes del haz (≈ 9) o suavizar
  // la envolvente (≈ 3,7) salen de la banda (src/validation/speckle.test.ts).
  // Tres cuadros completos + lectura de la envolvente con SwiftShader: ~6 s cada uno en local y
  // ~3× en el runner de CI (agotó los 90 s por defecto).
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  for (const startPoint of ['subxiphoid', 'intercostal', 'flank'] as const) {
    // guarda de una mirada (decisión 58): compuesto apagado, umbrales de siempre
    const s = await page.evaluate((id) => window.__vexusTest!.speckle({ startPoint: id, compound: false }), startPoint);
    const tag = `${startPoint}: ${JSON.stringify(s)}`;
    expect(s.patches, tag).toBeGreaterThan(50);
    expect(s.snr, tag).toBeGreaterThan(1.6);
    expect(s.snr, tag).toBeLessThan(2.25);
  }
  expect(errors).toEqual([]);
});

test('el banco de fidelidad mide el moteado del hígado despejado como un campo ideal', async ({ page }) => {
  // Banco de fidelidad (decisión 52). Con GPU real (M4) la subxifoidea del sano da SNR 1,93,
  // fracción oscura 0,065, grietas 0,07, grano axial 0,69 mm, lateral 0,95–1,05 × la PSF y lóbulos
  // < 0,06; la imagen mostrada, hígado en 144 de gris (mediana). Un defecto del moteado (intensidad,
  // magnitudes antes del haz, retícula periódica), una sombra dentro de la máscara o una lectura de
  // la imagen al revés lo sacan de estas bandas (src/validation/fidelity*.test.ts).
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  // guarda de una mirada (decisión 58): compuesto apagado, umbrales de siempre
  const s = await page.evaluate(() => window.__vexusTest!.fidelity({ startPoint: 'subxiphoid', display: true, compound: false }));
  const e = s.envelope;
  const tag = JSON.stringify(e);
  // con la compresión (decisión 63) la subxifoidea deja menos hígado despejado en el plano (16–17 parches
  // en local, 15 en el CI de GitHub; antes, > 15): 12 parches de 16 × 8 bastan para la SNR y la fracción oscura
  expect(e.patches, tag).toBeGreaterThanOrEqual(12);
  expect(e.snr, tag).toBeGreaterThan(1.75);
  expect(e.snr, tag).toBeLessThan(2.1);
  expect(e.darkFraction, tag).toBeGreaterThan(0.05);
  expect(e.darkFraction, tag).toBeLessThan(0.09);
  expect(e.crackIndex, tag).toBeLessThan(0.12);
  expect(e.secondaryLobeAxial, tag).toBeLessThan(0.15);
  expect(e.secondaryLobeLateral, tag).toBeLessThan(0.15);
  expect(e.fwhmAxialMm, tag).toBeGreaterThan(0.5);
  expect(e.fwhmAxialMm, tag).toBeLessThan(0.9);
  const bands = s.bands.filter((b) => b.patches >= 5);
  expect(bands.length, JSON.stringify(s.bands)).toBeGreaterThan(0);
  for (const b of bands) {
    expect(b.fwhmLateralMm / b.beamFwhmMm, JSON.stringify(b)).toBeGreaterThan(0.8);
    expect(b.fwhmLateralMm / b.beamFwhmMm, JSON.stringify(b)).toBeLessThan(1.25);
  }
  // la imagen mostrada se lee con la orientación correcta (la máscara del hígado cae en hígado) y el
  // preajuste abdominal (decisión 53) deja el hígado a media escala: mediana 99–103, desviación 16
  // con GPU real; la luz, casi negra
  const d = s.display!;
  const dtag = JSON.stringify({ liver: d.liver, lumen: d.lumen });
  expect(d.liver.pixels, dtag).toBeGreaterThan(1000);
  expect(d.liver.p50, dtag).toBeGreaterThan(85);
  expect(d.liver.p50, dtag).toBeLessThan(120);
  expect(d.liver.sd, dtag).toBeLessThan(19);
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
  test.setTimeout(240_000);
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
    // G1: SNR del compuesto y su coherencia con N_eff medido
    expect(b.compound.snr, tag).toBeGreaterThanOrEqual(b.r0 < 60 || b.r0 >= 140 ? 2.1 : 2.0);
    expect(b.compound.snr, tag).toBeLessThanOrEqual(3.0);
    expect(Math.abs(b.snrGain / Math.sqrt(b.nEff) - 1), tag).toBeLessThanOrEqual(0.1);
    // G2 y G3: sin los huecos oscuros ni las grietas del moteado de una mirada
    expect(b.compound.darkFraction, tag).toBeLessThanOrEqual(0.035);
    expect(b.compound.crackIndex, tag).toBeLessThanOrEqual(0.04);
    // el grano del compuesto es el de la mirada 0: no es un suavizado (§23), que lo agranda un 20–30 %. Con
    // SwiftShader las bandas tienen 5–10 parches y la razón oscila ±5–8 % (1,109 con 6 parches a 20–60 mm;
    // el gemelo da 1,05 ahí): el techo es 1,15 con menos de 10 parches y 1,1 con más
    for (const g of [b.grainRatioLateral, b.grainRatioAxial]) {
      expect(g, tag).toBeGreaterThanOrEqual(0.9);
      expect(g, tag).toBeLessThanOrEqual(b.compound.patches < 10 ? 1.15 : 1.1);
    }
    // K5: cada mirada es un moteado de Rayleigh con la misma media que la 0
    for (const t of b.perLook) {
      expect(t.snr, tag).toBeGreaterThan(1.75);
      expect(t.snr, tag).toBeLessThan(2.1);
      expect(Math.abs(t.meanRatio - 1), tag).toBeLessThanOrEqual(0.05);
    }
  }
  // K1: el grano lateral del compuesto sigue a la PSF
  for (const b of s.bands.filter((x) => x.patches >= 5)) {
    expect(b.fwhmLateralMm / b.beamFwhmMm, JSON.stringify(b)).toBeGreaterThan(0.8);
    expect(b.fwhmLateralMm / b.beamFwhmMm, JSON.stringify(b)).toBeLessThan(1.25);
  }
  // G4: el gris del hígado puro, a media escala y con la desviación de un equipo (15–17 con una mirada). El
  // banco lo mide por banda con ≥ 1000 píxeles a densidad 2; con el lienzo de la e2e (densidad 1) puede no
  // haber bandas tan llenas: entonces, el hígado puro entero
  const d = s.display!;
  expect(d.liver.pixels, JSON.stringify(d.liver)).toBeGreaterThan(1000);
  expect(d.liver.p50, JSON.stringify(d.liver)).toBeGreaterThanOrEqual(90);
  expect(d.liver.p50, JSON.stringify(d.liver)).toBeLessThanOrEqual(110);
  for (const b of d.liverBands)
    test.info().annotations.push({
      type: `gris ${b.r0}–${b.r1} mm`,
      description: `mediana ${b.p50}, desviación ${b.sd.toFixed(2)} (${b.pixels} px)`,
    });
  const lb = d.liverBands.filter((b) => b.pixels >= 1000);
  for (const b of lb.length ? lb : [d.liver]) {
    expect(b.sd, JSON.stringify(b)).toBeGreaterThanOrEqual(10.5);
    expect(b.sd, JSON.stringify(b)).toBeLessThanOrEqual(14.0);
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
  // una guarda de una mirada no puede medir en silencio una envolvente de otro cuadro
  const guard = await page.evaluate(() => window.__vexusTest!.envelopeGuard({ startPoint: 'subxiphoid' }));
  expect(guard.look, JSON.stringify(guard)).not.toBe(0);
  expect(guard.threw, JSON.stringify(guard)).toBe(true);
  expect(guard.message).toMatch(/la mirada 0 no es del último cuadro/);
  expect(errors).toEqual([]);
});

test('las normales de la GPU coinciden con el gradiente de la distancia de TS en las caras que dan brillo', async ({ page }) => {
  // Banco de interfaces (PR 5a de la tanda 1.5): el eco de una cara lisa depende de la incidencia sobre
  // su normal (decisión 57). Por vista y fila (cada cara y los subconjuntos de `FACE_NORMAL_SUBSETS`), los
  // puntos del plano a 0,02–0,4 mm de la cara en un tejido que la dibuja (mismo tejido en GPU y CPU):
  // |n·∇| entre la normal que usa el eco (`faceGradient`) y el gradiente de `faceSdf`, y el error relativo
  // de su norma (con ella el eco pasa ifd a distancia por la normal: en las paredes AP de la VCI elíptica
  // vale 1/apScale, y sin ella el perfil integraba apScale, −2,2 dB). En 5a tres normales no eran el
  // gradiente y 5b las corrige:
  //  - VCI (`tubeIvc`, `tubeIvcBody`): la sección elíptica escalaba la componente AP una vez (d/dist) y el
  //    gradiente la escala dos: 6–10° en todo el cuerpo. Ahora la normal es el gradiente de la sección
  //    (con el afilamiento del radio); portada a TS da p01 ≥ 0,9999 en el cuerpo (faceNormals.test.ts);
  //  - riñón: junto a la escotadura hiliar la normal era la del elipsoide (p01 0,61 en la ventana renal);
  //  - cápsula hepática: `liverSdf` elegía la normal de una de sus superficies (p05 0,45–0,98).
  //    Las dos pasan al gradiente numérico de su distancia con el paso del banco (0,02 mm): el mismo
  //    cálculo que la CPU, salvo float32.
  // Cúpula y vesícula ya daban ≥ 0,99 en p01 (ahora también usan el gradiente numérico). Un fallo de
  // cableado, de marco o de signo hundiría la mediana; las caras que 5b corrige se exigen ahora en p01 (la
  // VCI también en p05 ≥ 0,99). La norma, en p95 ≤ 0,01 (el gemelo TS da ≤ 5e-5; float32 y las uniones de
  // tubos dan el resto; una GPU sin la norma da ≥ 0,1 en la VCI de la subxifoidea, faceNormals.test.ts).
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  // apnea espiratoria: los planos cortan la anatomía en la misma posición que el gemelo de TS
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  const views = [
    { startPoint: 'subxiphoid' },
    { startPoint: 'intercostal' },
    { startPoint: 'flank' },
    { startPoint: 'renal' },
    // la vesícula no corta ningún plano de partida: flanco abanicado 18° hacia delante
    { startPoint: 'flank', pose: { tiltDeg: 18 } },
  ] as const;
  const faces = ['tube', 'liverSurface', 'dome', 'kidneyOuter', 'gallbladder'] as const;
  // subconjuntos (`FACE_NORMAL_SUBSETS`): se muestrean aparte y no cambian la fila de su cara
  const subsets = ['tubeIvc', 'tubeIvcBody', 'kidneyOuterNotchFree', 'kidneyOuterNotch'] as const;
  const gated = ['tube', 'liverSurface', 'dome', 'kidneyOuter', 'kidneyOuterNotchFree', 'gallbladder', 'tubeIvcBody'] as const;
  const seen = new Map<string, number>();
  for (const view of views) {
    const r = await page.evaluate((v) => window.__vexusTest!.faceNormals(v), view);
    for (const row of [...faces, ...subsets]) {
      const f = r[row];
      const tag = `${row} ${JSON.stringify(view)}: ${JSON.stringify(f)}`;
      // la GPU y la CPU clasifican igual los puntos de la banda (si no, la comparación sería vacía)
      expect(f.mismatched, tag).toBeLessThanOrEqual(0.05 * (f.points + f.mismatched));
      if (f.points < 50) continue;
      test.info().annotations.push({
        type: `normales · ${row}`,
        description: `${JSON.stringify(view)}: ${f.points} puntos, p01 ${f.p01.toFixed(3)}, p05 ${f.p05.toFixed(3)}, p50 ${f.p50.toFixed(4)}, < 0,98 en ${(100 * f.below098).toFixed(1)} %, norma p95 ${f.normErrP95.toExponential(1)} máx ${f.normErrMax.toExponential(1)}; peor ${f.worst}`,
      });
      seen.set(row, (seen.get(row) ?? 0) + 1);
      if ((faces as readonly string[]).includes(row)) expect(f.p50, tag).toBeGreaterThanOrEqual(0.99);
      if (row === 'tube') expect(f.p05, tag).toBeGreaterThanOrEqual(0.98);
      if (row === 'tubeIvc' || row === 'tubeIvcBody') expect(f.p05, tag).toBeGreaterThanOrEqual(0.99);
      const exact = ['liverSurface', 'dome', 'gallbladder', 'kidneyOuter', 'kidneyOuterNotchFree', 'kidneyOuterNotch', 'tubeIvcBody'];
      if (exact.includes(row)) expect(f.p01, tag).toBeGreaterThanOrEqual(0.98);
      if ((gated as readonly string[]).includes(row)) expect(f.normErrP95, tag).toBeLessThanOrEqual(0.01);
    }
  }
  // cada cara con brillo se comprobó en al menos una vista (la prueba no puede pasar vacía)
  for (const face of gated) expect(seen.get(face) ?? 0, `${face} sin vista con ≥ 50 puntos`).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('ecos de interfaz: paredes y cápsula brillan y el espejo diafragmático no deja costura', async ({ page }) => {
  // Decisión 57 con SwiftShader, una pose por vista y solo los tramos que se llenan (≥ 10 registros; el
  // diafragma, ≥ 5 en el tramo que tenga: a 0–20° no hay ninguno, ver docs/fidelity/README.md, «Qué llena
  // el barrido»). El gemelo B→C→D predice VCI 1,56, VSH 1,49 y cápsula 1,79 a 0–20° con K = 55 dB, y el
  // espejo de A0 queda a ≤ 0,009 mm de la pleura; antes, paredes y cápsula a 1,02–1,26 y el espejo hasta
  // 1,1 mm dentro del pulmón, con costura en el 4–18 % de las líneas. Umbrales con margen para la
  // calibración de K en [53; 57] dB, que se hace con GPU real (`npm run fidelity -- --sweep`). Desde la
  // decisión 62 la cápsula bajo la pared tiene encima la grasa preperitoneal y el peritoneo parietal, a
  // 0,7 mm: el banco mide esa línea como `peritoneum` (gemelo 1,82–1,83 a 0–20°; la cápsula sola, sin el
  // peritoneo, 1,48–1,79: `wallTwin.test.ts`), con techo para que no se blanquee.
  test.setTimeout(300_000);
  const errors = await bootWithoutErrors(page);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  const seen = { peritoneum: 0, diaphragm: 0, lumen: 0 };
  // paredes de vaso casi perpendiculares (< 15°): las de las vistas de partida están hondas (VCI a
  // 125 mm en el flanco) y curvas, y la coherencia de curvatura las deja en +6–10 dB (GPU); sin eco
  // de interfaz, el moteado solo daba ~3,5 dB
  const tubePeaks: number[] = [];
  for (const startPoint of ['subxiphoid', 'intercostal', 'flank'] as const) {
    const s = await page.evaluate(
      (id) => window.__vexusTest!.fidelity({ startPoint: id, display: true, samples: true, compound: false }),
      startPoint,
    );
    const d = s.display!;
    const tag = `${startPoint}: ${JSON.stringify({ lumen: d.lumen, capsule: d.capsule, peritoneum: d.peritoneum, walls: d.wallSystems, diaphragm: d.diaphragm, saturated: d.faceSaturated })}`;
    // la imagen sigue en su sitio: hígado a media escala y el centro de la luz casi negro
    expect(d.liver.p50, tag).toBeGreaterThan(85);
    expect(d.liver.p50, tag).toBeLessThan(120);
    // (la luz es la de VCI, suprahepáticas y porta con toda la rodaja en sangre, decisión 62: en la intercostal
    // por el 8.º espacio las suprahepáticas son finas y oblicuas al plano y la VCI queda contra la vértebra, y no
    // hay luz que medir; antes, con la luz del plano, su mediana era 52 con SwiftShader)
    if (d.lumen.pixels >= 50) {
      seen.lumen++;
      expect(d.lumen.p50, tag).toBeLessThan(30);
    }
    // ninguna cara de órgano se blanquea (el diafragma, Morison y la vesícula son las más reflectantes)
    for (const face of ['diaphragm', 'morison', 'gallbladder'] as const)
      if (Number.isFinite(d.faceSaturated[face])) expect(d.faceSaturated[face], tag).toBeLessThanOrEqual(0.02);
    const capsule = d.capsule[0];
    if (capsule.walls >= 10) expect(capsule.ratio, tag).toBeGreaterThanOrEqual(1.4);
    const peritoneum = d.peritoneum[0];
    if (peritoneum.walls >= 10) {
      seen.peritoneum++;
      expect(peritoneum.ratio, tag).toBeGreaterThanOrEqual(1.4);
      expect(peritoneum.ratio, tag).toBeLessThanOrEqual(2.4);
    }
    for (const r of s.faceSamples ?? [])
      if ((r.kind === 'ivc' || r.kind === 'hepaticVein' || r.kind === 'portal') && r.incidenceDeg < 15 && Number.isFinite(r.peakDb))
        tubePeaks.push(r.peakDb);
    for (const bin of d.diaphragm.filter((b) => b.walls >= 5)) {
      seen.diaphragm++;
      expect(bin.seamFraction, tag).toBeLessThanOrEqual(0.02);
      // el desfase del espejo sobre el suelo del banco (su emulación en CPU del espejo de la GPU): a
      // incidencia rasante la referencia del banco toma otro cruce y los dos valen lo mismo (8,6–19,8 mm en
      // la subxifoidea según la fase respiratoria), con la GPU siguiendo al modelo
      expect(bin.mirrorOffsetMm - bin.mirrorFloorMm, tag).toBeLessThanOrEqual(0.05);
    }
  }
  // la prueba no puede pasar vacía: la línea del peritoneo y el diafragma se midieron en alguna vista, y la luz
  // en la subxifoidea y el flanco (la VCI en eje largo)
  expect(seen.peritoneum).toBeGreaterThan(0);
  expect(seen.lumen).toBeGreaterThanOrEqual(2);
  const sorted = [...tubePeaks].sort((a, b) => a - b);
  expect(sorted.length, JSON.stringify(sorted)).toBeGreaterThanOrEqual(5);
  expect(sorted[Math.floor(sorted.length / 2)], JSON.stringify(sorted)).toBeGreaterThanOrEqual(5);
  expect(seen.diaphragm).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('pleura parietal: la línea pleural brilla y bajo ella hay neblina con líneas A, no un rectángulo negro', async ({ page }) => {
  // Decisión 61, con SwiftShader: la ventana intercostal en apnea inspiratoria (la cortina 30 mm abajo tapa
  // buena parte del sector), una mirada. Antes la cortina era el espejo del diafragma: bajo la pleura el
  // camino volvía a la pared y salía al gel (neblina ≈ 0 de gris) y no había eco de la pleura parietal. El
  // gemelo B → C → D (pleuraTwin.test.ts) da la línea pleural saturada, la neblina a 0,68 × el hígado y la
  // línea A de orden 2 +44 dB sobre ella; aquí, umbrales holgados (lo exacto lo mide el banco con GPU).
  test.setTimeout(300_000);
  const errors = await bootWithoutErrors(page);
  const s = await page.evaluate(() =>
    window.__vexusTest!.pleura({ startPoint: 'intercostal', respiration: 'apnea-inspiratory', compound: false }),
  );
  const tag = JSON.stringify({
    ...s,
    haze: { patches: s.haze.patches, fwhmAxialMm: s.haze.fwhmAxialMm, fwhmLateralMm: s.haze.fwhmLateralMm },
  });
  expect(s.caudalMm, tag).toBeGreaterThan(25);
  // la cortina está a la vista: líneas enteras y, de ellas, casi perpendiculares a la pleura
  expect(s.fullLines, tag).toBeGreaterThan(30);
  expect(s.normalLines, tag).toBeGreaterThan(5);
  // la línea pleural, la más brillante de la imagen
  expect(s.pleuraPeakGrey, tag).toBeGreaterThanOrEqual(230);
  // bajo ella, neblina gris, no negro, y más oscura en el intervalo siguiente
  expect(s.hazeGrey, tag).toBeGreaterThanOrEqual(20);
  expect(s.hazeRatio, tag).toBeGreaterThan(0.2);
  expect(s.hazeGreyDeep, tag).toBeLessThan(s.hazeGrey);
  // la primera réplica de la pleura (línea A de orden 2) destaca sobre la neblina
  expect(s.aLine2ProminenceDb, tag).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('pared (decisión 62): líneas brillantes, grasa hipoecoica con septos, músculo con estrías, cortical costal y sus normales', async ({
  page,
}) => {
  // Mirada 0 con SwiftShader en tres vistas de partida, con las definiciones del banco (`display.wall`). El
  // gemelo de CPU (wallTwin.test.ts, el mismo código del banco sobre su envolvente) da 4–6 líneas dentro, la
  // grasa a 0,47–0,57 del hígado, septos +5,0–10,4 dB, estrías +4,4–9,7 dB, la cortical +19,3 dB en el flanco y
  // las líneas a incidencia normal a +6,4–9,2 dB del hígado, sin picos saturados (SwiftShader: 6,6–11,3 dB, 0 %);
  // antes, ninguna línea dentro de la pared, y con las caras de σz 0,05 (GPU real) líneas blancas saturadas.
  // Umbrales con margen: las metas del README se miden con GPU real.
  test.setTimeout(300_000);
  const errors = await bootWithoutErrors(page);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  for (const startPoint of ['subxiphoid', 'intercostal', 'flank'] as const) {
    const s = await page.evaluate((id) => window.__vexusTest!.fidelity({ startPoint: id, display: true, compound: false }), startPoint);
    const w = s.display!.wall;
    const tag = `${startPoint}: ${JSON.stringify({ ...w, profileDb: undefined })}`;
    expect(w.profileLines, tag).toBeGreaterThanOrEqual(5);
    expect(w.linesInside, tag).toBeGreaterThanOrEqual(3);
    expect(w.fatToLiver, tag).toBeLessThan(0.75);
    expect(w.septumDb, tag).toBeGreaterThan(2);
    expect(w.striationDb, tag).toBeGreaterThan(2);
    // las líneas no se blanquean: bajo la pleura y la cortical, que son las más brillantes (W7)
    expect(w.lineSaturated, tag).toBeLessThanOrEqual(0.02);
    expect(w.lineLevelDb, tag).toBeLessThanOrEqual(16);
    // la cortical, en el flanco (W4), donde las costillas cruzan el plano bajo la sonda (en la intercostal por el
    // 8.º espacio no entra ninguna)
    if (startPoint === 'flank') {
      expect(w.ribLines, tag).toBeGreaterThanOrEqual(5);
      expect(w.ribPeakDb, tag).toBeGreaterThanOrEqual(12);
    }
    // las caras de la pared y de las costillas: la misma cara, normal y norma del gradiente en la GPU que en TS
    const n = await page.evaluate((id) => window.__vexusTest!.wallNormals({ startPoint: id }), startPoint);
    const ntag = `${startPoint} normales: ${JSON.stringify(n)}`;
    expect(n.points, ntag).toBeGreaterThan(300);
    expect(n.mismatched / (n.points + n.mismatched), ntag).toBeLessThan(0.01);
    expect(n.p05, ntag).toBeGreaterThan(0.98);
    expect(n.normErrP95, ntag).toBeLessThan(0.01);
  }
  expect(errors).toEqual([]);
});

test('la pasada A en cuatro etapas da la misma transmisión de un solo rayo que el modelo de CPU', async ({ page }) => {
  // Decisión 54: impactos por línea, segmentos y suma acumulada reproducen `rayAttenuationDb` en los
  // mismos puntos (las líneas con espejo no: la CPU no sigue el rayo reflejado). Con GPU real,
  // ≤ 0,0001 dB en cuatro ventanas; el color y el PW comparten este modelo (decisión 50). Cada línea se
  // compara hasta su primer segmento ambiguo (otro tejido a ±0,02 mm): en SwiftShader un segmento en el
  // borde de una cápsula o del intestino caía del otro lado en 33 de 50 fases respiratorias (también en
  // main) y la suma difería 0,06–0,27 dB desde ahí; con el corte, 0 de 30 y ≤ 5·10⁻⁵ dB.
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  for (const startPoint of ['subxiphoid', 'flank'] as const) {
    const r = await page.evaluate(
      (id) => window.__vexusTest!.transmissionParity({ startPoint: id, every: 8, compound: false }),
      startPoint,
    );
    const tag = `${startPoint}: ${JSON.stringify(r)}`;
    expect(r.lines, tag).toBeGreaterThan(5);
    expect(r.samples, tag).toBeGreaterThan(500);
    expect(r.maxDiffDb, tag).toBeLessThan(0.01);
  }
  expect(errors).toEqual([]);
});

test('el moteado del hígado persiste al inclinar la sonda medio grado y se renueva con 8°', async ({ page }) => {
  // Decisión 55: el medio de dispersores está anclado y no sigue a la normal del plano. Antes, con
  // el eje de compresión en la normal actual y el pivote en el origen del mundo, 0,5° de inclinación
  // cambiaba todo el moteado (gemelo: correlación −0,01); en un equipo el grano se conserva un grosor
  // de corte y se renueva cuando el plano ya atraviesa otro tejido. La correlación se toma sin la
  // tendencia de profundidad (gemelo: 0,95 / 0,86 / 0,06 con 0,5° / 2° de giro / 8°).
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  // apnea espiratoria: entre cuadros solo se mueve la sonda
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  const r = await page.evaluate(() => {
    const h = window.__vexusTest!;
    return {
      small: h.speckleMotion({ startPoint: 'intercostal', tiltDeg: 0.5, compound: false }),
      yaw: h.speckleMotion({ startPoint: 'intercostal', yawDeg: 2, compound: false }),
      big: h.speckleMotion({ startPoint: 'intercostal', tiltDeg: 8, compound: false }),
    };
  });
  const tag = JSON.stringify(r);
  expect(r.small.samples, tag).toBeGreaterThan(300);
  // volver a la pose: el mismo medio (con uno nuevo daría ~0; el ruido del receptor cambia por cuadro)
  expect(r.small.back, tag).toBeGreaterThan(0.9);
  expect(r.small.moved, tag).toBeGreaterThan(0.8);
  expect(r.yaw.moved, tag).toBeGreaterThan(0.7);
  expect(r.big.moved, tag).toBeLessThan(0.3);
  expect(errors).toEqual([]);
});

test('el fundido del ancla del moteado no da saltos: la textura y la correlación entre cuadros se mantienen', async ({ page }) => {
  // Decisión 55: girar la sonda 1° por cuadro pasa el umbral de reanclaje; durante los cuadros del
  // fundido (peso < 1) la GPU mezcla dos medios. La SNR del hígado no debe cambiar y cada cuadro debe
  // parecerse al anterior (un fundido mal cableado daría un destello o un salto de grano).
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  const frames = await page.evaluate(() =>
    window.__vexusTest!.speckleCrossfade({ startPoint: 'intercostal', stepDeg: 1, frames: 16, compound: false }),
  );
  const tag = JSON.stringify(frames);
  expect(
    frames.some((f) => f.w < 1),
    tag,
  ).toBe(true);
  const snr0 = frames[0].snr;
  // Lo que el fundido le cuesta a la correlación con el cuadro anterior, de sus pesos: el medio de un cuadro es
  // √w·N + √(1 − w)·V (N el ancla nueva, V la anterior; `SpeckleAnchor`). Si el fundido sigue, las dos anclas son
  // las mismas: ρ = √(w₀·w) + √((1 − w₀)(1 − w)) ≈ 0,99. Si empieza uno (w baja), la nueva del cuadro anterior es
  // la vieja de este: ρ = √(w₀)·√(1 − w) (√(8/9) tras un cuadro sin fundido; 8/9 en el enlace de dos fundidos
  // seguidos). La envolvente de un moteado de Rayleigh correlaciona ≈ ρ² (0,876 y 0,770, Monte Carlo; ρ² da
  // 0,889 y 0,790, algo más exigente).
  const fade = frames.map((f, i) => {
    const w0 = i === 0 ? 1 : frames[i - 1].w;
    const rho = f.w < w0 ? Math.sqrt(w0 * (1 - f.w)) : Math.sqrt(w0 * f.w) + Math.sqrt((1 - w0) * (1 - f.w));
    return rho * rho;
  });
  // La correlación que da el giro de 1° por cuadro, sin el fundido, cambia a lo largo del barrido (lo que se
  // ve del hígado cambia: 0,89 → 0,80 en 12°, igual en main banda a banda): cada cuadro se compara con los de
  // su entorno (±3), no con los primeros. Un fundido mal cableado (un destello, un salto de grano, soltar el
  // medio de golpe) da mucho menos que lo que el fundido cuesta.
  const motion = frames.map((f, i) => f.corrPrev / fade[i]);
  const localBase = (i: number) => {
    const v = motion.filter((_, j) => j !== i && Math.abs(j - i) <= 3).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  // sin destellos: el nivel del hígado no salta entre cuadros (soltar el medio viejo un cuadro antes
  // sumaba el mismo medio dos veces: +2,1 dB en el último cuadro de cada fundido)
  for (let i = 1; i < frames.length; i++) expect(Math.abs(frames[i].levelDb - frames[i - 1].levelDb), tag).toBeLessThan(0.8);
  frames.forEach((f, i) => {
    expect(f.snr / snr0, tag).toBeGreaterThan(0.85);
    expect(f.snr / snr0, tag).toBeLessThan(1.15);
    // el ancla no cambia más de 1/9 del medio entre dos cuadros (ρ² ≥ (8/9)²): reanclar a mitad de un fundido
    // soltaba de golpe el medio viejo (w 0,44 → 0,11: ρ² = 0,39; en GPU, correlación 0,65)
    expect(fade[i], `cuadro ${i}: ${tag}`).toBeGreaterThan(0.78);
    // el fundido no baja la correlación con el cuadro anterior más de lo que cuesta (hígado puro, intercostal en
    // espiración: 0,96–0,97 de su entorno en los dos arranques de fundido, el del cuadro 5 y el enlace del 13)
    expect(motion[i] / localBase(i), `cuadro ${i}: ${tag}`).toBeGreaterThan(0.85);
  });
  expect(errors).toEqual([]);
});

test('sin contacto no hay Doppler: el color y el espectro se apagan al levantar la sonda', async ({ page }) => {
  // Invariante de §23 de la guía. Medido con GPU real: color 1 346 celdas en contacto y 0 levantada;
  // PW 23 dB sobre el suelo en contacto y 7,5 dB (el valor del ruido puro) levantada.
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  const r = await page.evaluate(() => {
    const T = window.__vexusTest!;
    const out: Record<string, number | boolean | null> = {};
    const veins = ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] as const;
    T.goToStartPoint('renal');
    document.querySelector<HTMLButtonElement>('#mode-color')!.click();
    out.colorContact = T.colorOnVessel([...veins]);
    T.liftProbe(10);
    out.colorLifted = T.colorCells();
    T.liftProbe(0);
    // PW con el color encendido: el tríplex (decisión 66); el espectro se mide igual
    document.querySelector<HTMLButtonElement>('#mode-pw')!.click();
    out.gate = T.placeGate([...veins]);
    T.advance(3);
    out.pwContact = T.pwBandOverFloorDb(2);
    T.liftProbe(10);
    T.advance(3);
    out.pwLifted = T.pwBandOverFloorDb(2);
    return out;
  });
  const tag = JSON.stringify(r);
  expect(r.colorContact, tag).toBeGreaterThan(50);
  expect(r.colorLifted, tag).toBe(0);
  expect(r.gate, tag).toBe(true);
  expect(r.pwContact! as number, tag).toBeGreaterThan((r.pwLifted as number) + 8);
  expect(r.pwLifted as number, tag).toBeLessThan(11);
  expect(errors).toEqual([]);
});

test('tríplex (decisión 66): el color sigue en pantalla con el PW, la puerta nace en la caja y la caja la acompaña', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.evaluate(() => window.__vexusTest!.goToStartPoint('renal'));
  await page.locator('#mode-color').click();
  // con el color solo, una puerta fuera de la caja no la mueve (la caja no sigue a una puerta que no se ve)
  const colorOnly = await page.evaluate(() => {
    const T = window.__vexusTest!;
    T.placeGateAt(0.4, 150);
    return T.modeState();
  });
  await page.locator('#mode-pw').click();
  await expect(page.locator('#mode-color')).toHaveClass(/active/);
  await expect(page.locator('#mode-pw')).toHaveClass(/active/);
  await expect(page.locator('#hud-br')).toContainText('Color');
  await expect(page.locator('#hud-br')).toContainText('PW');
  const r = await page.evaluate(() => {
    const T = window.__vexusTest!;
    // al abrir el PW la puerta saltó al centro de la caja
    const entered = T.modeState();
    // en tríplex, la puerta que sale de la caja se lleva la caja
    T.placeGateAt(-0.35, 60);
    const followed = T.modeState();
    const veins = ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] as const;
    const color = T.colorOnVessel([...veins]);
    const gate = T.placeGate([...veins]);
    T.advance(3);
    return { entered, followed, color, gate, pw: T.pwBandOverFloorDb(2), cells: T.colorCells(), state: T.modeState() };
  });
  const tag = JSON.stringify({ colorOnly, ...r });
  expect(colorOnly.color && !colorOnly.pw, tag).toBe(true);
  expect(colorOnly.gateInBox, tag).toBe(false);
  expect(r.entered.gateInBox, tag).toBe(true);
  expect(r.entered.gate.theta, tag).toBeCloseTo(colorOnly.box.theta, 6);
  expect(r.entered.gate.r, tag).toBeCloseTo(colorOnly.box.r, 6);
  expect(r.followed.gateInBox, tag).toBe(true);
  expect(r.followed.box.theta, tag).toBeLessThan(r.entered.box.theta - 0.1);
  expect(r.gate, tag).toBe(true);
  expect(r.state.color && r.state.pw && r.state.gateInBox, tag).toBe(true);
  // el color sigue pintando el vaso y el espectro corre a la vez
  expect(r.color!, tag).toBeGreaterThan(50);
  expect(r.cells, tag).toBeGreaterThan(50);
  expect(r.pw!, tag).toBeGreaterThan(8);
  // el PW intercalado se lleva su tiempo: la imagen se refresca más despacio que con el color solo
  expect(r.state.frameHz, tag).toBeLessThan(colorOnly.frameHz);
  // volver a pulsar PW deja el color solo
  await page.locator('#mode-pw').click();
  await expect(page.locator('#mode-pw')).not.toHaveClass(/active/);
  await expect(page.locator('#mode-color')).toHaveClass(/active/);
  expect(await page.evaluate(() => window.__vexusTest!.modeState().pw)).toBe(false);
  expect(errors).toEqual([]);
});

test('modo alumno ciego: sin diagnóstico en pantalla; el docente lo ve con ?docente', async ({ page }) => {
  // Guía §17. Nombres clínicos de los casos (no deben aparecer en modo alumno).
  // Arranca la aplicación dos veces: con SwiftShader cada arranque compila los 16 programas (decisión 58) y
  // con la máquina cargada los dos no caben en los 90 s por omisión (fallaba igual en main).
  test.setTimeout(240_000);
  const diagnoses = ['Adulto sano', 'Congestión venosa', 'congestión moderada', 'fallo derecho'];
  const errors = await bootWithoutErrors(page);
  await expect(page.locator('#debug-toggle')).toBeHidden();
  await page.selectOption('#case-select', 'severe-congestion');
  await expect(page.locator('#hud-tl')).toContainText('Paciente B');
  const body = await page.locator('body').innerText();
  for (const d of diagnoses) expect(body, d).not.toContain(d);
  const options = await page.locator('#case-select option').allTextContents();
  expect(options).toEqual(['Paciente A', 'Paciente B', 'Paciente C']);
  await expect(page.locator('#cutmap')).toHaveAttribute('data-labels', '0');
  await expect(page.locator('#layer-vessels')).toBeDisabled();
  expect(errors).toEqual([]);

  // Con ?docente la casilla aparece y al marcarla vuelven el nombre, los rótulos y los vasos
  const errors2 = await bootWithoutErrors(page, '?e2e=1&docente=1');
  await page.locator('#debug-toggle').check();
  await page.selectOption('#case-select', 'severe-congestion');
  await expect(page.locator('#hud-tl')).toContainText('Congestión venosa grave');
  await expect(page.locator('#cutmap')).toHaveAttribute('data-labels', '1');
  await expect(page.locator('#layer-vessels')).toBeEnabled();
  expect(errors2).toEqual([]);
});

test('color: la misma transmisión que el PW y una ganancia que alcanza el ruido del equipo', async ({ page }) => {
  // El modelo, en el mismo punto: el téxel de la pasada A que lee el color en la puerta (convertido a la
  // frecuencia Doppler y con el acoplamiento que muestrea el color) frente al mismo téxel en la CPU, a ≤ 0,1 dB
  // (antes el color usaba un exponente fijo, 0,714, y veía menos atenuación: 3–4 dB aquí). La diferencia con
  // el PW en la puerta exacta es informativa, con una cota holgada: el téxel es el de la línea y la fila que
  // contienen la puerta (hasta ½ línea al lado y 1,125 mm antes) y el PW marcha a pasos de 2,5 mm hasta el
  // múltiplo siguiente; con las capas de la pared (decisión 62) esas discretizaciones cruzan más fronteras.
  // CPU, 40 fases de la respiración tranquila: |color − PW| ≤ 0,88 dB y, en el mismo punto, ≤ 0,77 dB; la
  // e2e llegó a medir 1,16 dB (1 de cada ~6 corridas pasaba de 1 dB, la cota de antes). Ruido puro 0 % de
  // celdas a 0 dB y 64 % a +24 dB (antes el máximo del deslizador no mostraba ruido nunca).
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  const r = await page.evaluate(() => {
    const T = window.__vexusTest!;
    document.querySelector<HTMLButtonElement>('#mode-pw')!.click();
    T.goToStartPoint('renal');
    const gate = T.placeGate(['interlobarVein1', 'interlobarVein2', 'interlobarVein3']);
    const t = T.gateTransmissionDb();
    // 2D antes de Color: el color solo, como se calibró el ruido (desde el PW, Color daría el tríplex, decisión 66)
    document.querySelector<HTMLButtonElement>('#mode-b')!.click();
    document.querySelector<HTMLButtonElement>('#mode-color')!.click();
    T.liftProbe(10);
    T.setColorGainDb(0);
    const noiseDefault = T.colorCellFraction();
    T.setColorGainDb(24);
    const noiseMax = T.colorCellFraction();
    return { gate, ...t, noiseDefault, noiseMax };
  });
  const tag = JSON.stringify(r);
  expect(r.gate, tag).toBe(true);
  expect(r.color, tag).toBeGreaterThanOrEqual(r.cpu[0] - 0.1);
  expect(r.color, tag).toBeLessThanOrEqual(r.cpu[1] + 0.1);
  expect(Math.abs(r.color - r.pw), tag).toBeLessThan(2);
  expect(r.noiseDefault, tag).toBeLessThan(0.001);
  expect(r.noiseMax, tag).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});
