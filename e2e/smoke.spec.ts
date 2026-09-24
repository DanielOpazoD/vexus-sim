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
    const s = await page.evaluate((id) => window.__vexusTest!.speckle({ startPoint: id }), startPoint);
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
  const s = await page.evaluate(() => window.__vexusTest!.fidelity({ startPoint: 'subxiphoid', display: true }));
  const e = s.envelope;
  const tag = JSON.stringify(e);
  expect(e.patches, tag).toBeGreaterThan(15);
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

test('las normales de la GPU coinciden con el gradiente de la distancia de TS en las caras que dan brillo', async ({ page }) => {
  // Banco de interfaces (PR 5a de la tanda 1.5): el eco de una cara lisa depende de la incidencia sobre
  // su normal (decisión 57). Por vista y fila (cada cara y los subconjuntos de `FACE_NORMAL_SUBSETS`), los
  // puntos del plano a 0,02–0,4 mm de la cara en un tejido que la dibuja (mismo tejido en GPU y CPU):
  // |n·∇| entre la normal que usa el eco (`faceNormal`) y el gradiente de `faceSdf`. En 5a tres normales
  // no eran el gradiente y 5b las corrige:
  //  - VCI (`tubeIvc`, `tubeIvcBody`): la sección elíptica escalaba la componente AP una vez (d/dist) y el
  //    gradiente la escala dos: 6–10° en todo el cuerpo. Ahora la normal es el gradiente de la sección
  //    (con el afilamiento del radio); portada a TS da p01 ≥ 0,9999 en el cuerpo (faceNormals.test.ts);
  //  - riñón: junto a la escotadura hiliar la normal era la del elipsoide (p01 0,61 en la ventana renal);
  //  - cápsula hepática: `liverSdf` elegía la normal de una de sus superficies (p05 0,45–0,98).
  //    Las dos pasan al gradiente numérico de su distancia con el paso del banco (0,02 mm): el mismo
  //    cálculo que la CPU, salvo float32.
  // Cúpula y vesícula ya daban ≥ 0,99 en p01. Un fallo de cableado, de marco o de signo hundiría la
  // mediana; las caras que 5b corrige se exigen ahora en p01 (la VCI también en p05 ≥ 0,99).
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
        description: `${JSON.stringify(view)}: ${f.points} puntos, p01 ${f.p01.toFixed(3)}, p05 ${f.p05.toFixed(3)}, p50 ${f.p50.toFixed(4)}, < 0,98 en ${(100 * f.below098).toFixed(1)} %; peor ${f.worst}`,
      });
      seen.set(row, (seen.get(row) ?? 0) + 1);
      if ((faces as readonly string[]).includes(row)) expect(f.p50, tag).toBeGreaterThanOrEqual(0.99);
      if (row === 'tube') expect(f.p05, tag).toBeGreaterThanOrEqual(0.98);
      if (row === 'tubeIvc' || row === 'tubeIvcBody') expect(f.p05, tag).toBeGreaterThanOrEqual(0.99);
      const exact = ['liverSurface', 'dome', 'gallbladder', 'kidneyOuter', 'kidneyOuterNotchFree', 'kidneyOuterNotch', 'tubeIvcBody'];
      if (exact.includes(row)) expect(f.p01, tag).toBeGreaterThanOrEqual(0.98);
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
  // calibración de K en [53; 57] dB, que se hace con GPU real (`npm run fidelity -- --sweep`).
  test.setTimeout(300_000);
  const errors = await bootWithoutErrors(page);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  const seen = { capsule: 0, diaphragm: 0 };
  for (const startPoint of ['subxiphoid', 'intercostal', 'flank'] as const) {
    const s = await page.evaluate((id) => window.__vexusTest!.fidelity({ startPoint: id, display: true }), startPoint);
    const d = s.display!;
    const tag = `${startPoint}: ${JSON.stringify({ capsule: d.capsule, walls: d.wallSystems, diaphragm: d.diaphragm, saturated: d.faceSaturated })}`;
    // la imagen sigue en su sitio: hígado a media escala y el centro de la luz casi negro
    expect(d.liver.p50, tag).toBeGreaterThan(85);
    expect(d.liver.p50, tag).toBeLessThan(120);
    expect(d.lumen.p50, tag).toBeLessThan(30);
    // ninguna cara de órgano se blanquea (el diafragma, Morison y la vesícula son las más reflectantes)
    for (const face of ['diaphragm', 'morison', 'gallbladder'] as const)
      if (Number.isFinite(d.faceSaturated[face])) expect(d.faceSaturated[face], tag).toBeLessThanOrEqual(0.02);
    const capsule = d.capsule[0];
    if (capsule.walls >= 10) {
      seen.capsule++;
      expect(capsule.ratio, tag).toBeGreaterThanOrEqual(1.4);
    }
    for (const sys of ['ivc', 'hepaticVein'] as const) {
      const wall = d.wallSystems[sys][0];
      if (wall.walls >= 10) expect(wall.ratio, tag).toBeGreaterThanOrEqual(1.3);
    }
    for (const bin of d.diaphragm.filter((b) => b.walls >= 5)) {
      seen.diaphragm++;
      expect(bin.seamFraction, tag).toBeLessThanOrEqual(0.02);
      expect(bin.mirrorOffsetMm, tag).toBeLessThanOrEqual(0.05);
    }
  }
  // la prueba no puede pasar vacía: la cápsula y el diafragma se midieron en alguna vista
  expect(seen.capsule).toBeGreaterThan(0);
  expect(seen.diaphragm).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('la pasada A en cuatro etapas da la misma transmisión de un solo rayo que el modelo de CPU', async ({ page }) => {
  // Decisión 54: impactos por línea, segmentos y suma acumulada reproducen `rayAttenuationDb` en los
  // mismos puntos (las líneas con espejo no: la CPU no sigue el rayo reflejado). Con GPU real,
  // ≤ 0,0001 dB en cuatro ventanas; el color y el PW comparten este modelo (decisión 50).
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  for (const startPoint of ['subxiphoid', 'flank'] as const) {
    const r = await page.evaluate((id) => window.__vexusTest!.transmissionParity({ startPoint: id, every: 8 }), startPoint);
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
      small: h.speckleMotion({ startPoint: 'intercostal', tiltDeg: 0.5 }),
      yaw: h.speckleMotion({ startPoint: 'intercostal', yawDeg: 2 }),
      big: h.speckleMotion({ startPoint: 'intercostal', tiltDeg: 8 }),
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
  const frames = await page.evaluate(() => window.__vexusTest!.speckleCrossfade({ startPoint: 'intercostal', stepDeg: 1, frames: 16 }));
  const tag = JSON.stringify(frames);
  expect(
    frames.some((f) => f.w < 1),
    tag,
  ).toBe(true);
  const snr0 = frames[0].snr;
  // sin destellos: el nivel del hígado no salta entre cuadros (soltar el medio viejo un cuadro antes
  // sumaba el mismo medio dos veces: +2,1 dB en el último cuadro de cada fundido)
  for (let i = 1; i < frames.length; i++) expect(Math.abs(frames[i].levelDb - frames[i - 1].levelDb), tag).toBeLessThan(0.8);
  for (const f of frames) {
    expect(f.snr / snr0, tag).toBeGreaterThan(0.85);
    expect(f.snr / snr0, tag).toBeLessThan(1.15);
    // 1° de giro por cuadro ya da ~0,83 sin fundido (los píxeles laterales se mueven); el fundido
    // no debe bajar de ahí más que un poco
    expect(f.corrPrev, tag).toBeGreaterThan(0.7);
  }
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

test('modo alumno ciego: sin diagnóstico en pantalla; el docente lo ve con ?docente', async ({ page }) => {
  // Guía §17. Nombres clínicos de los casos (no deben aparecer en modo alumno).
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
  // Medido con GPU real: color − PW entre −0,8 y +0,1 dB en cuatro ventanas (antes el color usaba un
  // exponente fijo, 0,714, y veía menos atenuación); ruido puro 0 % de celdas a 0 dB y 64 % a +24 dB
  // (antes el máximo del deslizador no mostraba ruido nunca).
  test.setTimeout(240_000);
  const errors = await bootWithoutErrors(page);
  const r = await page.evaluate(() => {
    const T = window.__vexusTest!;
    document.querySelector<HTMLButtonElement>('#mode-pw')!.click();
    T.goToStartPoint('renal');
    const gate = T.placeGate(['interlobarVein1', 'interlobarVein2', 'interlobarVein3']);
    const t = T.gateTransmissionDb();
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
  expect(Math.abs(r.color - r.pw), tag).toBeLessThan(1);
  expect(r.noiseDefault, tag).toBeLessThan(0.001);
  expect(r.noiseMax, tag).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});
