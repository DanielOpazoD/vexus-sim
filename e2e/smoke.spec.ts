import { expect, test, type Page } from '@playwright/test';
import { Tissue } from '../src/anatomy/tissues';
import {
  BOOT_MS,
  bootWithoutErrors,
  budget,
  checkAfterEach,
  stashLoggedErrors,
  clockRuns,
  expectLoggedErrors,
  simTime,
  withinFrames,
  withinSimSeconds,
} from './support';

/**
 * Humo de extremo a extremo: lo que ninguna prueba unitaria puede ver — que el
 * módulo arranca en el navegador, que WebGL2 renderiza cuadros, que la UI está
 * cableada (caso, modos, medición) y que no hay errores de consola. Las esperas son en
 * cuadros del bucle o en tiempo de simulación (`e2e/support.ts`); los plazos de cada
 * prueba son un arranque (`BOOT_MS`, la compilación con SwiftShader) más su trabajo.
 */
checkAfterEach();

/** Texto de un elemento, o su ausencia, para los mensajes de error. */
const textOf = async (page: Page, sel: string): Promise<string> => (await page.locator(sel).textContent()) ?? '';

/** `true` si el elemento contiene `text`; si no, lo que contiene (para el mensaje de `withinFrames`). */
const contains = (page: Page, sel: string, text: string | RegExp) => async (): Promise<true | string> => {
  const s = await textOf(page, sel);
  return (typeof text === 'string' ? s.includes(text) : text.test(s)) || `${sel} = «${s}»`;
};

test('arranca, renderiza cuadros y no emite errores', async ({ page }) => {
  budget(60_000);
  const errors = await bootWithoutErrors(page);
  // El reloj de simulación avanza con los cuadros (≤ 0,25 s por cuadro): en tres cuadros, algo; los fps redondeados
  // pueden ser 0 con SwiftShader y no se exigen
  await clockRuns(page, 'el reloj de la simulación avanza con cuadros completos');
  expect(errors).toEqual([]);
});

test('cambia de caso y el HUD lo refleja', async ({ page }) => {
  budget(90_000);
  const errors = await bootWithoutErrors(page);
  // Si el HUD no cambia, el mensaje dice por qué: caso vivo, selector, avisos y errores de consola
  // (en CI el paso a FA falló dos veces sin más pista que «esperaba FA»).
  const hudOr = (sel: string, text: string) => async (): Promise<true | string> => {
    const hud = await textOf(page, sel);
    if (hud.includes(text)) return true;
    const banner = await page.locator('.banner').allTextContents();
    const value = await page.locator('#case-select').inputValue();
    return `hud=${hud} · selector=${value} · avisos=${JSON.stringify(banner)} · errores=${JSON.stringify(errors)}`;
  };
  // el HUD se escribe en cada cuadro: el caso nuevo se ve en el cuadro siguiente al cambio (dos, por si el cambio
  // llega a mitad de uno)
  await page.selectOption('#case-select', 'severe-congestion');
  // modo alumno: el caso se rotula «Paciente B», nunca con su diagnóstico
  await withinFrames(page, 2, 'HUD con «Paciente B»', hudOr('#hud-tl', 'Paciente B'));
  await page.selectOption('#case-select', 'af-moderate-congestion');
  await withinFrames(page, 2, 'HUD con «FA»', hudOr('#hud-tr', 'FA'));
  expect(errors).toEqual([]);
});

test('lo que ve el usuario (?e2e=app): subxifoidea en armónica con composición, hígado a media escala y la VCI negra', async ({ page }) => {
  // El resto de la e2e arranca en la pose por defecto y en fundamental (`?e2e=1`, la física calibrada de sus pruebas);
  // la aplicación arranca en la ventana subxifoidea, en armónica y con la composición espacial (main.ts). Aquí, esa
  // configuración con los ganchos cargados: la imagen que abre el alumno, medida como el banco (decisiones 52 y 58).
  // Con SwiftShader (local, 27-09): hígado mediana 91, desviación 15,1; luz 7.
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app');
  await withinFrames(page, 2, 'HUD en armónica con composición', contains(page, '#hud-tr', /THI 3,5 MHz[\s\S]*CX/));
  await withinFrames(page, 20, 'la tarjeta subxifoidea resaltada', async () => {
    const cur = await page.locator('.win-card[aria-current="true"]').allTextContents();
    return (cur.length === 1 && cur[0].includes('Subxifoideo')) || `resaltadas: ${JSON.stringify(cur)}`;
  });
  const s = await page.evaluate(() => {
    const T = window.__vexusTest!;
    const sim = T.sim();
    // sin `startPoint`: la pose en que arrancó la aplicación; `compound: true` es el conmutador tal como está
    const f = T.fidelity({ compound: sim.bmode.compound, display: true });
    return { harmonic: sim.bmode.harmonic, compound: sim.bmode.compound, liver: f.display!.liver, lumen: f.display!.lumen };
  });
  const tag = JSON.stringify(s);
  test.info().annotations.push({ type: 'imagen del usuario', description: tag });
  expect(s.harmonic, tag).toBe(true);
  expect(s.compound, tag).toBe(true);
  // las bandas de la imagen mostrada de las pruebas en fundamental (banco, G4 del compuesto): hígado a media escala con
  // la desviación de un equipo, y la luz de la VCI casi negra
  expect(s.liver.pixels, tag).toBeGreaterThan(1000);
  expect(s.liver.p50, tag).toBeGreaterThan(85);
  expect(s.liver.p50, tag).toBeLessThan(120);
  expect(s.liver.sd, tag).toBeGreaterThanOrEqual(12.5);
  expect(s.liver.sd, tag).toBeLessThanOrEqual(17.5);
  expect(s.lumen.pixels, tag).toBeGreaterThan(500);
  expect(s.lumen.p50, tag).toBeLessThan(30);
  // y el Doppler pulsado se abre desde ahí, con el reloj en marcha
  await page.keyboard.press('p');
  await withinFrames(page, 2, 'HUD con «PW»', contains(page, '#hud-br', 'PW'));
  await clockRuns(page, 'el reloj de la simulación avanza con cuadros completos');
  expect(errors).toEqual([]);
});

test('ventanas (decisión 83): Intro en una tarjeta, mantenida como con el dedo, desliza la sonda hasta su ventana', async ({ page }) => {
  budget(90_000);
  const errors = await bootWithoutErrors(page);
  const card = page.locator('.win-card', { hasText: 'Epigástrico' });
  const readout = page.getByText(/^φ -?\d+° · z -?[\d.]+ cm · acoplamiento/);
  const readoutIs = (want: string, yes: boolean) => async (): Promise<true | string> => {
    const s = (await readout.textContent()) ?? '';
    return s.includes(want) === yes || `lectura «${s}»`;
  };
  // la e2e arranca en la pose por defecto (φ 166°, z 0,8 cm), lejos de la epigástrica (φ 90°, z −2 cm); la lectura se
  // escribe con la cadencia de 250 ms del panel
  await withinFrames(page, 20, 'la sonda empieza lejos de la epigástrica', readoutIs('φ 90° · z -2.0 cm', false));
  await card.focus();
  // Intro mantenida unos cuadros, como con el dedo (≈ 0,1 s son 6 cuadros a 60 fps): antes cualquier tecla mantenida
  // pasaba por la entrada de la sonda como un gesto manual y cancelaba en el cuadro siguiente el deslizamiento que la
  // tarjeta acababa de pedir. Con SwiftShader un cuadro tarda casi un segundo: se mantiene hasta que el reloj de la
  // simulación avanza medio segundo (dos cuadros al menos, a ≤ 0,25 s por cuadro)
  await page.keyboard.down('Enter');
  const t0 = await simTime(page);
  await withinFrames(
    page,
    40,
    'Intro mantenida medio segundo de simulación',
    async () => (await simTime(page)) > t0 + 0.5 || 'reloj parado',
  );
  await page.keyboard.up('Enter');
  // el deslizamiento acerca la pose con una constante de 0,3 s (`ProbeAnimator`): de 76° de distancia a < 0,2° en
  // ~1,8 s de simulación; se le dan 4, más la cadencia del panel
  await withinSimSeconds(page, 4, 'la sonda llega a la epigástrica', readoutIs('φ 90° · z -2.0 cm', true));
  // llegada: la tarjeta queda resaltada como la ventana en la que está la sonda (su punto y su giro)
  await withinFrames(
    page,
    20,
    'la tarjeta resaltada',
    async () => (await card.getAttribute('aria-current')) === 'true' || 'sin aria-current',
  );
  expect(errors).toEqual([]);
});

test('lo medido a la vista sobre el espectro y el vaso equivocado (decisión 94)', async ({ page }) => {
  // CI observó operaciones GPU de20–46s: plazo operativo de arranque+trabajo, no tolerancia de señal.
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=1');
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.keyboard.press('p');
  const capture = async (row: string) => {
    await page.getByRole('tab', { name: 'Medir' }).click();
    await page.getByRole('button', { name: row, exact: true }).click();
    const button = page.getByRole('button', { name: 'Capturar' });
    await button.evaluate((el) => {
      el.addEventListener(
        'click',
        () => {
          const c = document.getElementById('spectrum') as HTMLCanvasElement;
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 180 && d[i + 1] < 235 && d[i + 2] < 150) n++;
          el.setAttribute('data-capture-trace', String(n));
        },
        { once: true },
      );
    });
    const handle = await button.elementHandle();
    await button.click();
    if (row === 'Porta PF') expect(Number(await handle.getAttribute('data-capture-trace'))).toBeGreaterThan(30);
  };
  // píxeles del trazado de la captura (ámbar, #ffd166) en el espectro: el mapa de grises del espectro no llega a ese tono
  const tracePixels = () =>
    page.evaluate(() => {
      const c = document.getElementById('spectrum') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 180 && d[i + 1] < 235 && d[i + 2] < 150) n++;
      return n;
    });
  // la fila «Suprahepática» con la puerta en el tronco portal: rechazada, con dónde está la puerta
  expect(
    await page.evaluate(() => {
      window.__vexusTest!.goToStartPoint('portal');
      return window.__vexusTest!.placeGate(['pvTrunk']);
    }),
  ).toBe(true);
  await page.evaluate(() => window.__vexusTest!.advance(8));
  await capture('Suprahepática');
  await expect(page.locator('.result')).toContainText('VSH: no medible: vaso equivocado, la puerta está en la porta');
  // la fila de la porta sobre el mismo vaso sí mide, y su traza queda dibujada sobre el espectro
  await capture('Porta PF');
  await expect(page.locator('.result')).toContainText(/Porta: \d+\.\d\/\d+\.\d cm\/s → PF \d+ %/);
  await withinFrames(page, 3, 'traza de captura >30 píxeles', async () => {
    const n = await tracePixels();
    return n > 30 || `traza: ${n} píxeles`;
  });
  // congelado sigue a la vista
  await page.locator('#freeze').click();
  await withinFrames(page, 3, 'traza de captura >30 píxeles', async () => {
    const n = await tracePixels();
    return n > 30 || `traza: ${n} píxeles`;
  });
  expect(errors).toEqual([]);
});

test('modos por teclado, pestaña Medir y captura de una medición', async ({ page }) => {
  budget(180_000);
  // ?docente: al final se abre la pestaña Docente (en producción la casilla solo aparece así)
  const errors = await bootWithoutErrors(page, '?e2e=1&docente=1');
  // Técnica del operador: apnea espiratoria (pestaña Adquirir) antes de medir la suprahepática
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.keyboard.press('p');
  await expect(page.locator('#mode-pw')).toHaveClass(/active/);
  // el HUD se escribe en cada cuadro
  await withinFrames(page, 2, 'HUD con «PW»', contains(page, '#hud-br', 'PW'));
  const capture = async () => {
    await page.getByRole('tab', { name: 'Medir' }).click();
    await page.getByRole('button', { name: 'Suprahepática', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar' }).evaluate((button) => {
      // Después del handler real, dentro del mismo evento de mouse: la captura no
      // espera otra descarga ni puede leer otro paciente en un turno posterior.
      button.addEventListener(
        'click',
        () => {
          button.setAttribute('data-capture-result', document.querySelector('.result')?.textContent ?? '');
        },
        { once: true },
      );
    });
    const button = page.getByRole('button', { name: 'Capturar' });
    const handle = await button.elementHandle();
    await button.click();
    return handle.getAttribute('data-capture-result');
  };
  // Ventana intercostal (la del protocolo) y la puerta sobre la suprahepática en un punto sin
  // sombras (técnica del operador); 7 s de espectro sin renderizar (`advance`: tiempo de simulación, no de reloj).
  // Antes la puerta caía en la sombra de la cortina pulmonar y se «medía» el ruido; ahora sería no medible. Medido con
  // GPU: banda 28 dB sobre el suelo (desde la pose inicial la VSH queda a 11 cm con −32 dB y solo 15 dB de banda).
  expect(
    await page.evaluate(() => {
      window.__vexusTest!.goToStartPoint('intercostal');
      return window.__vexusTest!.placeGate(['hvRight', 'hvMiddle']);
    }),
  ).toBe(true);
  await page.evaluate(() => window.__vexusTest!.advance(7));
  await expect(page.locator('.result')).toContainText('VSH: —');
  expect(await capture()).toMatch(/VSH: S -?\d+\.\d · D -?\d+\.\d/);
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
  // Docente: el panel de depuración existe y se actualiza, y con más de 8 s de simulación (los dos `advance` de 7 s)
  // muestra la verdad fisiológica de los últimos 6 s con su grado. Antes la prueba lo daba por «inalcanzable con
  // SwiftShader»: el reloj de la simulación no depende de los fps.
  // `force`: con render por software el hilo principal no deja al elemento «estable».
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  expect(await simTime(page)).toBeGreaterThan(8);
  await withinFrames(
    page,
    20,
    'panel docente con el reloj y la verdad',
    contains(page, '.debug', /t [\d.]+ s · latido[\s\S]*VERDAD FISIOLÓGICA \(últimos 6 s\)[\s\S]*Grado C de referencia: /),
  );
  expect(errors).toEqual([]);
});

test('sobrevive a la pérdida del contexto WebGL: avisa, se recupera y el reloj sigue', async ({ page }) => {
  // la recuperación vuelve a compilar todos los programas: dos arranques
  budget(60_000, 2);
  const errors = await bootWithoutErrors(page);
  // la pérdida provocada queda en el registro de errores de la aplicación, como debe
  expectLoggedErrors(page, [/^gpu: contexto WebGL perdido$/]);
  await page.evaluate(() => {
    const gl = (document.getElementById('gl') as HTMLCanvasElement).getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __lc: WEBGL_lose_context }).__lc = ext;
    ext.loseContext();
  });
  // el evento de pérdida llega del proceso de la GPU, sin cuadros de por medio
  await expect(page.locator('.banner')).toContainText('Contexto GPU perdido', { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __lc: WEBGL_lose_context }).__lc.restoreContext());
  // recompila los programas, como al arrancar
  await expect(page.locator('.banner')).toHaveCount(0, { timeout: BOOT_MS });
  await clockRuns(page, 'el reloj sigue, con cuadros completos, tras recuperar el contexto');
  expect(errors).toEqual([]);
});

test('el speckle del parénquima hepático tiene la estadística del hígado: casi de Rayleigh, con la cola de sus dispersores fuertes', async ({
  page,
}) => {
  // Guarda de fidelidad de imagen (Fase 3): la envolvente de un speckle plenamente desarrollado
  // tiene SNR = 1,91. Detectar intensidad (1,0), sumar magnitudes antes del haz (≈ 9) o suavizar
  // la envolvente (≈ 3,7) salen de la banda (src/validation/speckle.test.ts). Desde la decisión 89 el hígado es algo
  // pre-Rayleigh a propósito (sus dispersores fuertes y la densidad de 4 mm, como el hígado sano in vivo): en estos
  // parches de 16 × 8 la SNR baja ×0,90–0,94 (`parenchymaTextureTwin.test.ts`: 2,08–2,11 → 1,91–1,95; SwiftShader
  // 1,67–1,85, antes 1,82–2,00 con GPU) y la banda con ella, de 1,6–2,25 a 1,5–2,1. Con la textura, la intensidad da
  // 0,99–1,03, |Re f| 1,35–1,39 y la caja de 3 × 5 de speckle.test.ts 2,94–3,20: siguen fuera.
  // Tres cuadros completos + lectura de la envolvente con SwiftShader: ~6 s cada uno en local y
  // ~3× en el runner de CI (agotó los 90 s por defecto).
  budget(240_000);
  const errors = await bootWithoutErrors(page);
  for (const startPoint of ['subxiphoid', 'intercostal', 'flank'] as const) {
    // guarda de una mirada (decisión 58): compuesto apagado, umbrales de siempre
    const s = await page.evaluate((id) => window.__vexusTest!.speckle({ startPoint: id, compound: false }), startPoint);
    const tag = `${startPoint}: ${JSON.stringify(s)}`;
    expect(s.patches, tag).toBeGreaterThan(50);
    expect(s.snr, tag).toBeGreaterThan(1.5);
    expect(s.snr, tag).toBeLessThan(2.1);
  }
  expect(errors).toEqual([]);
});

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

test('foco (decisión 84): la banda del foco es algo más clara y se mueve con el deslizador', async ({ page }) => {
  // La intensidad de la emisión en el eje culmina en el foco (`focalGain`, con la potencia emitida fija y la referencia
  // en el foco del preajuste): con el foco somero se aclara el hígado somero y se oscurece el hondo, y al revés.
  // Ventana intercostal (hígado hasta 18 cm), fundamental y una mirada. Con GPU real (M4, densidad 1), gris del hígado
  // puro a 20–60 / 60–100 / 100–140 / 140–180 mm: 104 / 94 / 82 / 75 con el foco a 50 mm, 92 / 98 / 94 / 86 con el de
  // por defecto (90 mm) y 88 / 88 / 94 / 88 a 140 mm (antes, 101 / 99 / 95 / 95 con cualquier foco).
  budget(300_000);
  const errors = await bootWithoutErrors(page);
  const bandsAt = (focusMm: number) =>
    page.evaluate((f) => {
      window.__vexusTest!.setFocus(f);
      const s = window.__vexusTest!.fidelity({ startPoint: 'intercostal', display: true, compound: false });
      return s.display!.liverBands.map((b) => ({ r0: b.r0, p50: b.p50, pixels: b.pixels }));
    }, focusMm);
  const shallowFocus = await bandsAt(50);
  const deepFocus = await bandsAt(140);
  await page.evaluate(() => window.__vexusTest!.setFocus(90));
  const tag = JSON.stringify({ shallowFocus, deepFocus });
  const band = (bands: typeof shallowFocus, r0: number) => bands.find((b) => b.r0 === r0 && b.pixels >= 300);
  for (const bands of [shallowFocus, deepFocus]) {
    expect(band(bands, 20), tag).toBeTruthy();
    expect(band(bands, 140), tag).toBeTruthy();
  }
  // modelo: +4,9 dB a 40 mm con el foco a 50 frente a 140 mm, y +4,6 dB a 160 mm al revés
  expect(band(shallowFocus, 20)!.p50 - band(deepFocus, 20)!.p50, tag).toBeGreaterThanOrEqual(8);
  expect(band(deepFocus, 140)!.p50 - band(shallowFocus, 140)!.p50, tag).toBeGreaterThanOrEqual(8);
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
  // La cara externa de la grasa perirrenal (Morison, `perirenalOuter`) usaba el gradiente del contorno renal (p01 0,965
  // en la ventana renal, revisión de la decisión 68): ahora el de su propia distancia.
  // Cúpula y vesícula ya daban ≥ 0,99 en p01 (ahora también usan el gradiente numérico). Un fallo de
  // cableado, de marco o de signo hundiría la mediana; las caras que 5b corrige se exigen ahora en p01 (la
  // VCI también en p05 ≥ 0,99). La norma, en p95 ≤ 0,01 (el gemelo TS da ≤ 5e-5; float32 y las uniones de
  // tubos dan el resto; una GPU sin la norma da ≥ 0,1 en la VCI de la subxifoidea, faceNormals.test.ts).
  budget(240_000);
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
  // el pericardio (decisión 85), desde la subxifoidea: la normal del elipsoide de la cámara más cercana (o la de la cúpula
  // donde el saco apoya) frente al gradiente del epicardio recortado; sin la puerta de la norma (la GPU da 1 y la distancia
  // aproximada del elipsoide, |∇| a 1,1 % en la mediana y 6,5 % en p95 del gemelo TS: ≤ 0,6 dB en su eco)
  const faces = ['tube', 'liverSurface', 'dome', 'kidneyOuter', 'perirenalOuter', 'gallbladder', 'pericardium'] as const;
  // subconjuntos (`FACE_NORMAL_SUBSETS`): se muestrean aparte y no cambian la fila de su cara
  const subsets = ['tubeIvc', 'tubeIvcBody', 'kidneyOuterNotchFree', 'kidneyOuterNotch'] as const;
  const gated = [
    'tube',
    'liverSurface',
    'dome',
    'kidneyOuter',
    'kidneyOuterNotchFree',
    'perirenalOuter',
    'gallbladder',
    'tubeIvcBody',
  ] as const;
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
      const exact = [
        'liverSurface',
        'dome',
        'gallbladder',
        'kidneyOuter',
        'kidneyOuterNotchFree',
        'kidneyOuterNotch',
        'perirenalOuter',
        'tubeIvcBody',
      ];
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
  budget(300_000);
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
  // el diafragma con el pulmón encima: desde la decisión 85 el corazón apoya en la cúpula del plano de la subxifoidea; abanicada
  // 25° hacia la derecha del paciente, el plano pasa lateral a la aurícula (18 registros en el gemelo)
  for (const view of [
    { startPoint: 'subxiphoid' },
    { startPoint: 'intercostal' },
    { startPoint: 'flank' },
    { startPoint: 'subxiphoid', pose: { tiltDeg: -25 } },
  ] as const) {
    const s = await page.evaluate((v) => window.__vexusTest!.fidelity({ ...v, display: true, samples: true, compound: false }), view);
    const d = s.display!;
    const tag = `${JSON.stringify(view)}: ${JSON.stringify({ lumen: d.lumen, capsule: d.capsule, peritoneum: d.peritoneum, walls: d.wallSystems, diaphragm: d.diaphragm, saturated: d.faceSaturated })}`;
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
      // ≤ 2 % de costuras; una aislada solo en un tramo de ≥ 15 registros (17 en la subxifoidea desde la decisión 69 y 16 en
      // la abanicada a la derecha desde la 85, donde una sola ya es el 6 %: con GPU real la misma vista da 0 costuras; con
      // SwiftShader, una por un valle del moteado del espejo justo tras la línea). Con la textura del hígado (decisión
      // 89) los valles de −15 dB son más probables en las células de poca densidad, también en el espejo: la abanicada da
      // 1–2 en 23 (0 en main): dos en un tramo de ≥ 15 registros. El desfase del espejo, abajo, es la guarda directa de la
      // costura de verdad (el espejo dentro del pulmón). En un tramo más corto, ninguna, como antes
      const seams = Math.round(bin.seamFraction * bin.walls);
      expect(seams, tag).toBeLessThanOrEqual(bin.walls >= 15 ? Math.max(2, Math.floor(0.02 * bin.walls)) : Math.floor(0.02 * bin.walls));
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
  budget(300_000);
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
  budget(300_000);
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

test('la pasada A en cuatro etapas da la misma transmisión de un solo rayo que el modelo de CPU; la de la imagen, la de sus gemelos', async ({
  page,
}) => {
  // Decisión 54: impactos por línea, segmentos y suma acumulada reproducen `rayAttenuationDb` en los
  // mismos puntos (las líneas con espejo no: la CPU no sigue el rayo reflejado). Con GPU real,
  // ≤ 0,0001 dB en cuatro ventanas; el color y el PW comparten este modelo (decisión 50). Cada línea se
  // compara hasta su primer segmento ambiguo (otro tejido a ±0,02 mm): en SwiftShader un segmento en el
  // borde de una cápsula o del intestino caía del otro lado en 33 de 50 fases respiratorias (también en
  // main) y la suma difería 0,06–0,27 dB desde ahí; con el corte, 0 de 30 y ≤ 5·10⁻⁵ dB.
  // La subcostal, por la cara de la vesícula: con Ψ̃ sumada como r_k·Σe/(R + r) − Σe·r/(R + r), su primera fila dejaba en
  // la GPU un residuo de redondeo y la imagen se separaba de los gemelos 0,01–0,12 dB (decisión 86).
  budget(240_000);
  const errors = await bootWithoutErrors(page);
  for (const startPoint of ['subxiphoid', 'flank', 'subcostal'] as const) {
    const r = await page.evaluate(
      (id) => window.__vexusTest!.transmissionParity({ startPoint: id, every: 8, compound: false }),
      startPoint,
    );
    const tag = `${startPoint}: ${JSON.stringify(r)}`;
    expect(r.lines, tag).toBeGreaterThan(5);
    expect(r.samples, tag).toBeGreaterThan(500);
    expect(r.maxDiffDb, tag).toBeLessThan(0.01);
    // la transmisión de la imagen (penumbra con la emisión apodizada y refracción de las luces, decisiones 54, 86 y 91)
    // frente a sus gemelos sobre los segmentos de la GPU, sin las muestras en empate de redondeo de los tramos de la
    // refracción, y la de los ecos especulares (A o2.w, decisión 91: bajo las costillas del flanco, sus pares)
    expect(r.apertureSamples!, tag).toBeGreaterThan(500);
    expect(r.specularSamples!, tag).toBeGreaterThan(500);
    expect(r.apertureMaxDiffDb!, tag).toBeLessThan(0.01);
    expect(r.specularMaxDiffDb!, tag).toBeLessThan(0.01);
    expect(r.ambiguous!, tag).toBeLessThanOrEqual(0.01 * r.apertureSamples!);
  }
  // Decisión 86: detrás de la vesícula (subcostal) la bilis, más lenta que el hígado, es una lente convergente: los rayos
  // del haz enfocado que cruzan su borde se desvían y dejan de solaparse, así que el borde deja una sombra, y el centro,
  // sin foco, algo menos. La ganancia es la transmisión de la imagen sobre la del rayo único, en las muestras sin gas ni
  // hueso de A0 al alcance de la penumbra (±40 líneas por encima): ahí solo queda la refracción.
  const gb = await page.evaluate(() => {
    const T = window.__vexusTest!;
    T.setCompound(false);
    T.goToStartPoint('subcostal');
    const sim = T.sim();
    sim.render();
    const t = sim.renderer.readTransmission();
    const g = sim.renderer.readSegments(sim.bmode.depthMm);
    const rows = g.rows;
    const bile = 0.05 * g.stepMm; // la bilis deja 0,08 mm por segmento; la sangre, 0,006
    const onGb: number[] = [];
    let exit = 0;
    for (let l = 0; l < g.lines; l++) {
      let n = 0;
      for (let s = 0; s < rows; s++)
        if (g.excess[l * rows + s] > bile) {
          n++;
          exit = Math.max(exit, s);
        }
      if (n * g.stepMm >= 8) onGb.push(l);
    }
    if (onGb.length < 2) return { lines: onGb.length, edgeSamples: 0, centerSamples: 0, edgeMinDb: 0, centerMeanDb: 0, centerMaxDb: 0 };
    const l0 = onGb[0];
    const l1 = onGb[onGb.length - 1];
    const gainDb = (l: number, k: number) => 20 * Math.log10(t.aperture[k * t.lines + l] / t.single[k * t.lines + l]);
    const penumbra = (l: number, k: number) => {
      for (let m = Math.max(0, l - 40); m <= Math.min(g.lines - 1, l + 40); m++) {
        const gas = g.hitGasSeg![m];
        const bone = g.hitBoneSeg![m];
        if ((gas >= 0 && gas < k) || (bone >= 0 && bone < k)) return true;
      }
      return false;
    };
    let edgeMinDb = 0;
    let centerMaxDb = -99;
    let centerSum = 0;
    let edgeSamples = 0;
    let centerSamples = 0;
    for (let k = exit + Math.round(20 / g.stepMm); k <= Math.min(rows - 1, exit + Math.round(40 / g.stepMm)); k++)
      for (let l = Math.max(0, l0 - 6); l <= Math.min(g.lines - 1, l1 + 6); l++) {
        if (penumbra(l, k)) continue;
        if (Math.abs(l - l0) <= 6 || Math.abs(l - l1) <= 6) {
          edgeMinDb = Math.min(edgeMinDb, gainDb(l, k));
          edgeSamples++;
        }
        if (Math.abs(l - (l0 + l1) / 2) <= (l1 - l0) / 6) {
          centerMaxDb = Math.max(centerMaxDb, gainDb(l, k));
          centerSum += gainDb(l, k);
          centerSamples++;
        }
      }
    return { lines: onGb.length, edgeSamples, centerSamples, edgeMinDb, centerMeanDb: centerSum / centerSamples, centerMaxDb };
  });
  const gtag = JSON.stringify(gb);
  expect(gb.lines, gtag).toBeGreaterThan(10);
  expect(gb.edgeSamples, gtag).toBeGreaterThan(50);
  expect(gb.centerSamples, gtag).toBeGreaterThan(20);
  // el banco de ondas da −7 a −9 dB en el borde y de −3 a +1 en el centro; el modelo, algo menos hondo en el borde
  expect(gb.edgeMinDb, gtag).toBeLessThan(-4);
  expect(gb.edgeMinDb, gtag).toBeLessThan(gb.centerMeanDb - 1.5);
  expect(gb.centerMaxDb, gtag).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('el moteado del hígado persiste al inclinar la sonda medio grado y se renueva con 8°', async ({ page }) => {
  // Decisión 55: el medio de dispersores está anclado y no sigue a la normal del plano. Antes, con
  // el eje de compresión en la normal actual y el pivote en el origen del mundo, 0,5° de inclinación
  // cambiaba todo el moteado (gemelo: correlación −0,01); en un equipo el grano se conserva un grosor
  // de corte y se renueva cuando el plano ya atraviesa otro tejido. La correlación se toma sin la
  // tendencia de profundidad (gemelo: 0,95 / 0,86 / 0,06 con 0,5° / 2° de giro / 8°).
  budget(240_000);
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
  budget(240_000);
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
  // la vieja de este: ρ = √(w₀)·√(1 − w). La transición temporal empieza en w=0 y termina en w=1. La envolvente de un moteado de Rayleigh correlaciona ≈ ρ² (0,876 y 0,770, Monte Carlo; ρ² da
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
    // Se conserva la guarda previa de correlación para este barrido a 60 Hz; reanclar a mitad de un fundido
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
  budget(240_000);
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
    // Un latido y medio de color (8 cuadros), no un cuadro suelto: en contacto, TODOS con color en las interlobares
    // (medido con SwiftShader desde diez fases del latido: 653–776 celdas, nunca menos); levantada, NINGUNO.
    const first = T.colorOnVessel([...veins]);
    let contact = first ?? 0;
    for (let i = 1; i < 8; i++) contact = Math.min(contact, T.colorCells());
    out.colorContact = first === null ? null : contact;
    T.liftProbe(10);
    let lifted = 0;
    for (let i = 0; i < 8; i++) lifted = Math.max(lifted, T.colorCells());
    out.colorLifted = lifted;
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
  budget(240_000);
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
  // el HUD se escribe en cada cuadro
  await withinFrames(page, 2, 'HUD con «Color» y «PW»', contains(page, '#hud-br', /Color[\s\S]*PW|PW[\s\S]*Color/));
  const r = await page.evaluate(() => {
    const T = window.__vexusTest!;
    // al abrir el PW la puerta saltó al centro de la caja
    const entered = T.modeState();
    // en tríplex, la puerta que sale de la caja se lleva la caja
    T.placeGateAt(-0.35, 60);
    const followed = T.modeState();
    const veins = ['interlobarVein1', 'interlobarVein2', 'interlobarVein3'] as const;
    // un latido y medio de color (8 cuadros), todos con color en las interlobares (el mínimo de los 8; medido con
    // SwiftShader en tríplex desde diez fases: 659–769 celdas)
    const first = T.colorOnVessel([...veins]);
    let color = first ?? 0;
    for (let i = 1; i < 8; i++) color = Math.min(color, T.colorCells());
    const gate = T.placeGate([...veins]);
    T.advance(3);
    let cells = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 8; i++) cells = Math.min(cells, T.colorCells());
    return { entered, followed, color: first === null ? null : color, gate, pw: T.pwBandOverFloorDb(2), cells, state: T.modeState() };
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

test('color realista (decisión 70): sin bloques de celda, grano correlado y relleno moteado', async ({ page }) => {
  // Antes el estimador daba un valor constante por celda (línea de color × paquete de 1 mm), de 3–4 × 2–3 téxeles: la
  // mayoría de los pares vecinos con color eran IDÉNTICOS y el vaso se veía en bloques. Ahora cada téxel se estima en su
  // sitio y el ruido y el moteado de la sangre están correlados a la celda de resolución: vecinos parecidos pero no
  // iguales, y la correlación cae con la distancia (un grano de tamaño finito).
  budget(240_000);
  const errors = await bootWithoutErrors(page);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.evaluate(() => window.__vexusTest!.goToStartPoint('flank'));
  await page.locator('#mode-color').click();
  const r = await page.evaluate(() => {
    const T = window.__vexusTest!;
    const first = T.colorOnVessel(['hvRight', 'hvMiddle', 'ivcInfra', 'ivcSupra']);
    // El flujo venoso es pulsátil: donde se invierte (onda a) cruza el cero y, durante un cuadro de color, las cuatro
    // venas pueden quedar bajo el filtro de pared y el campo vacío, como parpadea el color en un equipo (medido: la
    // fracción con color sigue al latido, ~5 cuadros por ciclo a 6,2 Hz, con mínimos de 0 a 0,009). Se analiza el
    // cuadro con más color de un latido y medio (8 cuadros): antes se tomaba un instante suelto y fallaba 1 de cada 5.
    // Las celdas sobre el vaso, por cuadro: antes se exigían en el cuadro suelto de `colorOnVessel`, que en CI dio 0
    // en la inversión del flujo. Ahora, color en al menos la mitad de los 8 cuadros (medido con SwiftShader desde diez
    // fases del latido: 6–8 de 8 con más de 50 celdas; los vacíos, 1–2 por latido): un filtro de pared que se comiera
    // el flujo venoso casi todo el ciclo no pasa, aunque un cuadro suelto tuviera color.
    const counts = [first ?? 0];
    let best = T.colorTexture();
    counts.push(best.cells);
    for (let i = 1; i < 8; i++) {
      const t = T.colorTexture();
      if (t.visible > best.visible) best = t;
      counts.push(t.cells);
    }
    return { ...best, cells: first === null ? null : counts.slice(1).filter((c) => c > 50).length, counts };
  });
  const tag = JSON.stringify(r);
  expect(r.cells!, tag).toBeGreaterThanOrEqual(4);
  expect(r.visible, tag).toBeGreaterThan(0.005);
  expect(r.identicalPairs, tag).toBeLessThan(0.05);
  expect(r.corr1, tag).toBeGreaterThan(0.5);
  expect(r.corr4, tag).toBeLessThan(r.corr1 - 0.1);
  expect(errors).toEqual([]);
});

test('modo alumno ciego: sin diagnóstico en pantalla; el docente lo ve con ?docente', async ({ page }) => {
  // Guía §17. Nombres clínicos de los casos (no deben aparecer en modo alumno).
  // Arranca la aplicación dos veces: con SwiftShader cada arranque compila los 16 programas (decisión 58)
  budget(120_000, 2);
  const diagnoses = ['Adulto sano', 'Congestión venosa', 'congestión moderada', 'fallo derecho', 'Trampa', 'sin congestión', 'casi normal'];
  const errors = await bootWithoutErrors(page);
  await expect(page.locator('#debug-toggle')).toBeHidden();
  await page.selectOption('#case-select', 'severe-congestion');
  await withinFrames(page, 2, 'HUD con «Paciente B»', contains(page, '#hud-tl', 'Paciente B'));
  const body = await page.locator('body').innerText();
  for (const d of diagnoses) expect(body, d).not.toContain(d);
  const options = await page.locator('#case-select option').allTextContents();
  expect(options).toEqual(['Paciente A', 'Paciente B', 'Paciente C', 'Paciente D', 'Paciente E', 'Paciente F', 'Paciente G']);
  await expect(page.locator('#cutmap')).toHaveAttribute('data-labels', '0');
  await expect(page.locator('#layer-vessels')).toBeDisabled();
  expect(errors).toEqual([]);

  // Con ?docente la casilla aparece y al marcarla vuelven el nombre, los rótulos y los vasos
  const errors2 = await bootWithoutErrors(page, '?e2e=1&docente=1');
  await page.locator('#debug-toggle').check();
  await page.selectOption('#case-select', 'severe-congestion');
  await withinFrames(page, 2, 'HUD con el nombre del caso', contains(page, '#hud-tl', 'Congestión venosa grave'));
  await expect(page.locator('#cutmap')).toHaveAttribute('data-labels', '1');
  await expect(page.locator('#layer-vessels')).toBeEnabled();
  expect(errors2).toEqual([]);
});

test('casos trampa (decisión 82): el alumno lee la viñeta, marca el contexto y ve el aviso; la trampa es del docente', async ({ page }) => {
  // Dos arranques (alumno y docente), como el modo ciego: con SwiftShader cada uno compila los programas
  budget(120_000, 2);
  const errors = await bootWithoutErrors(page);
  await page.selectOption('#case-select', 'abdominal-hypertension');
  await withinFrames(page, 2, 'HUD con «Paciente D»', contains(page, '#hud-tl', 'Paciente D'));
  // `force`: con render por software el hilo principal no deja a los elementos «estables»
  await page.getByRole('tab', { name: 'Medir' }).click({ force: true });
  // la viñeta del caso, con lo que el operador sabe
  await expect(page.locator('.vignette')).toContainText('Presión vesical 16 mmHg');
  const iap = page.getByRole('checkbox', { name: 'Presión intraabdominal alta' });
  await expect(iap).not.toBeChecked();
  await expect(page.getByRole('group', { name: 'Confusores del paciente' }).getByRole('checkbox')).toHaveCount(7);
  // modo alumno: ni el nombre del caso ni la trampa en pantalla ni en el DOM; las explicaciones de las trampas tampoco en
  // ningún JS que haya descargado (viajan con la pestaña Docente, que no se carga). El nombre de los casos sí va en el JS
  // principal, como el de siempre (`blind-mode-screen-only`)
  const student = await page.locator('body').innerText();
  for (const leak of ['Trampa', 'Grado 0 falso', 'Contexto real']) expect(student, leak).not.toContain(leak);
  const html = await page.content();
  for (const leak of ['Trampa ·', 'Grado 0 falso', 'Contexto real']) expect(html, leak).not.toContain(leak);
  const scripts = await page.evaluate(() => [
    ...new Set([
      ...[...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((sc) => sc.src),
      ...performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => /\.js(\?|$)/.test(n)),
    ]),
  ]);
  expect(
    scripts.some((src) => /\/index-[^/]+\.js/.test(src)),
    JSON.stringify(scripts),
  ).toBe(true);
  expect(
    scripts.some((src) => /teacherTab/.test(src)),
    JSON.stringify(scripts),
  ).toBe(false);
  for (const src of scripts) {
    const js = await (await page.request.get(src)).text();
    for (const leak of ['Grado 0 falso', 'La porta subestima', 'Sobreestima: VExUS 2']) expect(js, `${src}: ${leak}`).not.toContain(leak);
  }
  await iap.check({ force: true });
  await expect(page.locator('.result')).toContainText('presión intraabdominal alta: la VCI puede ser pequeña con la PAD alta');
  await expect(page.locator('.result')).toContainText('mVExUS (sin riñón)');
  // otro caso: la casilla se desmarca, el aviso se va y la viñeta es la suya
  await page.selectOption('#case-select', 'normal-adult');
  await expect(page.locator('.vignette')).toContainText('taller de ecografía', { timeout: 30_000 });
  await expect(iap).not.toBeChecked();
  await expect(page.locator('.result')).not.toContainText('presión intraabdominal alta');
  expect(errors).toEqual([]);

  // Docente: el nombre del caso, su contexto real y la trampa
  const errors2 = await bootWithoutErrors(page, '?e2e=1&docente=1');
  // al marcar «Docente» la consola abre su pestaña
  await page.locator('#debug-toggle').check({ force: true });
  await page.selectOption('#case-select', 'abdominal-hypertension');
  const notes = page.locator('.case-notes');
  // las notas, la viñeta y el lazo cambian con el caso en el mismo evento (sin esperar cuadros); el plazo es el de un
  // cuadro de SwiftShader que tenga ocupado el hilo principal
  await expect(notes).toContainText('Trampa · PIA alta con fallo derecho', { timeout: 30_000 });
  await expect(notes).toContainText('Contexto real: Presión intraabdominal alta');
  await expect(notes).toContainText('Grado 0 falso');
  // el panel docente se escribe con la cadencia de 250 ms; la verdad fisiológica pide más de 8 s de simulación
  // (`advance`: tiempo de simulación sin dibujar, no de reloj)
  await withinFrames(page, 20, 'estado del lazo del caso', contains(page, '.loop-state', 'caso 14.0'));
  await page.evaluate(() => window.__vexusTest!.advance(9));
  await withinFrames(page, 20, 'verdad fisiológica en el panel', contains(page, '.debug', 'VERDAD FISIOLÓGICA (últimos 6 s)'));
  // y al volver al modo alumno las notas, el estado del lazo y la verdad salen también del DOM
  await page.locator('#debug-toggle').uncheck({ force: true });
  await expect(notes).toHaveText('');
  await expect(page.locator('.loop-state')).not.toContainText('caso');
  const after = await page.content();
  for (const leak of ['Grado 0 falso', 'VERDAD FISIOLÓGICA']) expect(after, leak).not.toContain(leak);
  expect(errors2).toEqual([]);
});

test('intervenciones docentes (decisión 79): bolo y PEEP mueven el lazo del simulador vivo y «Reiniciar paciente» vuelve al caso', async ({
  page,
}) => {
  budget(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=1&docente=1');
  // `force`: con render por software el hilo principal no deja a los elementos «estables»
  await page.locator('#debug-toggle').check({ force: true });
  await page.getByRole('tab', { name: 'Docente' }).click({ force: true });
  const loop = () => page.evaluate(() => window.__vexusTest!.circulation());
  expect(await loop()).toMatchObject({ caseId: 'normal-adult', rapMeanMmHg: 5, fluidTargetMl: 0, peepTargetCmH2O: 0, interventions: 0 });
  await page.getByRole('button', { name: 'Bolo 500 mL', exact: true }).click({ force: true });
  await expect(page.getByRole('status').filter({ hasText: 'Bolo de 500 mL en curso' })).toBeVisible();
  expect(await loop()).toMatchObject({ fluidTargetMl: 500, interventions: 1 });
  // 30 s de simulación sin renderizar (tiempo docente acelerado: el bolo llega en ~30 s): la PAD sube ~3 mmHg
  await page.evaluate(() => window.__vexusTest!.advance(30));
  expect((await loop()).rapMeanMmHg).toBeGreaterThan(7);
  await withinFrames(page, 20, 'el bolo en el estado del lazo', contains(page, '.loop-state', /bolo de 500 mL, hace \d+ s/));
  const peep = page.getByRole('group', { name: 'PEEP' });
  await peep.getByRole('button', { name: '10', exact: true }).click({ force: true });
  expect(await loop()).toMatchObject({ peepTargetCmH2O: 10, interventions: 2 });
  await expect(peep.getByRole('button', { name: '10', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reiniciar paciente', exact: true }).click({ force: true });
  await expect
    .poll(loop, { timeout: 30_000 })
    .toMatchObject({ caseId: 'normal-adult', rapMeanMmHg: 5, fluidTargetMl: 0, peepTargetCmH2O: 0, interventions: 0 });
  await expect(page.getByRole('status').filter({ hasText: 'Paciente reiniciado' })).toBeVisible();
  await withinFrames(page, 20, 'PEEP 0 pulsado', async () => {
    const v = await peep.getByRole('button', { name: '0', exact: true }).getAttribute('aria-pressed');
    return v === 'true' || `aria-pressed=${v}`;
  });
  await withinFrames(page, 20, 'sin intervenciones en el lazo', async () => {
    const v = await page.locator('.loop-state dd').last().textContent();
    return v === 'ninguna' || `última intervención «${v}»`;
  });
  // con el teclado: el sano admite −563 mL; el segundo diurético se recorta y el botón queda no disponible sin perder el foco
  const diuretic = page.getByRole('button', { name: 'Diurético −500 mL', exact: true });
  await diuretic.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'recortado al límite del paciente' })).toBeVisible();
  await expect(diuretic).toHaveAttribute('aria-disabled', 'true');
  expect(await diuretic.evaluate((el) => el === document.activeElement)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Sin efecto' })).toBeVisible();
  // otro caso: el aviso de la intervención anterior desaparece
  await page.selectOption('#case-select', 'severe-congestion');
  await expect.poll(loop, { timeout: 30_000 }).toMatchObject({ caseId: 'severe-congestion', interventions: 0 });
  await expect(page.getByRole('status')).toHaveText('');
  expect(errors).toEqual([]);
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
  budget(240_000);
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

test('armónica tisular (decisión 77): campo cercano limpio, el mismo tejido y más ruido; el conmutador y el HUD', async ({ page }) => {
  // cuatro cuadros con lectura de la envolvente (dos modos × contacto y sonda levantada) con SwiftShader, y un segundo
  // arranque sin ?e2e
  budget(240_000, 2);
  const errors = await bootWithoutErrors(page);
  // la e2e arranca en fundamental, la física calibrada de sus pruebas (la aplicación, en armónica)
  await withinFrames(
    page,
    2,
    'HUD sin THI',
    async () => !(await textOf(page, '#hud-tr')).includes('THI') || (await textOf(page, '#hud-tr')),
  );
  const r = await page.evaluate(() => window.__vexusTest!.harmonicContrast({ startPoint: 'subxiphoid' }));
  const tag = JSON.stringify(r);
  const db = (x: { fundamental: number; harmonic: number }) => 20 * Math.log10(x.harmonic / x.fundamental);
  // el campo cercano (piel, grasa y transitorio): la acumulación y el rechazo del transitorio lo oscurecen, y la
  // ganancia focal de la emisión (decisión 84), algo más en armónica, cuya fuente es p1² (−6,5 frente a −4,9 dB a
  // 2 mm con el foco por defecto). Sin acumulación ni rechazo del transitorio la armónica quedaría por encima
  expect(db(r.near), tag).toBeLessThan(-2);
  // el tejido (sin la ganancia focal de cada modo): la acumulación compensada y la misma atenuación, el mismo nivel
  expect(Math.abs(db(r.tissue)), tag).toBeLessThan(1.5);
  // el ruido del receptor solo (sonda levantada), en toda la profundidad: +3 dB respecto al eco (HARMONIC.noiseDb)
  expect(db(r.noise), tag).toBeGreaterThan(2.3);
  expect(db(r.noise), tag).toBeLessThan(3.7);
  // el conmutador de la consola cambia el modo y el HUD lo dice (la sección Avanzado está plegada: fuera del
  // árbol de accesibilidad, así que se busca por su texto)
  const toggle = page.locator('button', { hasText: 'Armónica (THI)' });
  await expect(toggle).toHaveCount(1);
  await toggle.evaluate((b) => (b as HTMLButtonElement).click());
  await withinFrames(page, 2, 'HUD con THI', contains(page, '#hud-tr', 'THI 3,5 MHz'));
  await toggle.evaluate((b) => (b as HTMLButtonElement).click());
  await withinFrames(
    page,
    2,
    'HUD sin THI',
    async () => !(await textOf(page, '#hud-tr')).includes('THI') || (await textOf(page, '#hud-tr')),
  );
  expect(errors).toEqual([]);
  // y la aplicación, sin ?e2e (sin ganchos: se espera a su primer cuadro, dominado por la compilación), arranca en
  // armónica (main.ts), como un preajuste abdominal moderno; el HUD se escribe en el mismo cuadro que el estado
  await stashLoggedErrors(page);
  await page.goto('/?docente=1');
  await expect(page.locator('#status')).toContainText(/\d+ fps/, { timeout: BOOT_MS });
  await expect(page.locator('#hud-tr')).toContainText('THI 3,5 MHz');
});

/** Imagen mostrada (una muestra de sus píxeles), cuadro del cine en pantalla y cursor del ECG (su x media). */
async function cineShot(page: Page) {
  return page.evaluate(() => {
    const r = window.__vexusTest!.sim().renderer;
    const d = r.readDisplay();
    const gray: number[] = [];
    for (let i = 0; i < d.gray.length; i += 13) gray.push(d.gray[i]);
    const ecg = document.getElementById('ecg') as HTMLCanvasElement;
    const px = ecg.getContext('2d')!.getImageData(0, 0, ecg.width, ecg.height).data;
    const y = Math.floor(ecg.height / 2);
    let sx = 0;
    let nx = 0;
    // el cursor es celeste (#5cc8ff, con su borde suavizado); la traza del ECG es verde y la respiración, azul oscuro
    for (let x = 0; x < ecg.width; x++) {
      const i = (y * ecg.width + x) * 4;
      if (px[i + 2] > 180 && px[i + 1] > 140 && px[i] < 150) {
        sx += x;
        nx++;
      }
    }
    return {
      gray,
      t: r.cineShownFrame?.t ?? null,
      tEnd: r.cineCount ? r.cineFrame(r.cineCount - 1).t : null,
      times: Array.from({ length: r.cineCount }, (_, i) => r.cineFrame(i).t),
      cursorX: nx ? sx / nx : null,
      ecgWidth: ecg.width,
    };
  });
}

test('cine (decisión 80): congelar y retroceder ~1 s cambia la imagen y mueve el cursor del ECG; al final, el cuadro congelado', async ({
  page,
}) => {
  budget(300_000);
  const errors = await bootWithoutErrors(page);
  // el anillo guarda cuadros a ≤ 20 Hz del reloj de la simulación (con SwiftShader, todos: ≤ 0,25 s por cuadro)
  const span = () =>
    page.evaluate(() => {
      const r = window.__vexusTest!.sim().renderer;
      return r.cineCount > 1 ? r.cineFrame(r.cineCount - 1).t - r.cineFrame(0).t : 0;
    });
  await withinSimSeconds(page, 4, 'el cine guarda más de 1,6 s', async () => {
    const x = await span();
    return x > 1.6 || `${x.toFixed(2)} s guardados`;
  });
  // El cuadro del cine en pantalla (su instante): se lee sin tocar la GPU. `cineShot` lee la imagen con readPixels, que
  // espera a que la GPU acabe lo pendiente (con SwiftShader, hasta 35 s en CI): antes se sondeaba con él y una sola
  // lectura agotaba el plazo de 30 s con el valor de antes del primer cuadro congelado (null)
  const shownT = () => page.evaluate(() => window.__vexusTest!.sim().renderer.cineShownFrame?.t ?? null);
  await page.keyboard.press(' ');
  // el rótulo y el cine se dibujan en el cuadro siguiente
  await withinFrames(page, 2, 'FREEZE', async () => (await textOf(page, '#live-chip')) === 'FREEZE' || (await textOf(page, '#live-chip')));
  await expect(page.locator('#cine')).toBeVisible();
  // congelada, el cine está en su último cuadro: el congelado
  await withinFrames(page, 2, 'el cine muestra un cuadro', async () => (await shownT()) !== null || 'ninguno');
  const end = await cineShot(page);
  expect(end.t, JSON.stringify(end.times)).toBe(end.tEnd);
  expect(end.cursorX, 'cursor del ECG').not.toBeNull();
  // ~1 s atrás con ←: el cuadro más cercano a t_final − 1 s
  const target = end.times.reduce(
    (best, t, i) => (Math.abs(t - (end.tEnd! - 1)) < Math.abs(end.times[best] - (end.tEnd! - 1)) ? i : best),
    0,
  );
  for (let k = 0; k < end.times.length - 1 - target; k++) await page.keyboard.press('ArrowLeft');
  await withinFrames(page, 2, 'el cine ~1 s atrás', async () => {
    const t = await shownT();
    return t === end.times[target] || `cuadro en ${t} s (se esperaba ${end.times[target]} s)`;
  });
  await withinFrames(page, 2, 'el instante del cuadro', contains(page, '#cine-time', /^−\d,\d\d s$/));
  const back = await cineShot(page);
  const tag = JSON.stringify({ end: { t: end.t, x: end.cursorX }, back: { t: back.t, x: back.cursorX }, target, times: end.times });
  expect(Math.abs(back.t! - (end.tEnd! - 1)), tag).toBeLessThan(0.3);
  // otra imagen (la respiración y el ruido del receptor cambian en 1 s) y el cursor, ~1 s a la izquierda
  const mad = back.gray.reduce((a, g, i) => a + Math.abs(g - end.gray[i]), 0) / back.gray.length;
  expect(mad, tag).toBeGreaterThan(1);
  const pxPerSec = await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    const ecg = document.getElementById('ecg') as HTMLCanvasElement;
    return ecg.width / (ecg.clientWidth / (s.pw.sweepMmS * 3.2));
  });
  expect(end.cursorX! - back.cursorX!, tag).toBeGreaterThan(0.6 * pxPerSec * (end.t! - back.t!));
  // Fin: el último cuadro, el de la congelación, idéntico píxel a píxel
  await page.keyboard.press('End');
  await withinFrames(page, 2, 'el cine en el último cuadro', async () => {
    const t = await shownT();
    return t === end.t || `cuadro en ${t} s (se esperaba ${end.t} s)`;
  });
  const again = await cineShot(page);
  expect(again.gray, tag).toEqual(end.gray);
  expect(again.cursorX).toBe(end.cursorX);
  // al descongelar el cine se va y la imagen vuelve a correr
  await page.keyboard.press(' ');
  await expect(page.locator('#cine')).toBeHidden();
  expect(errors).toEqual([]);
});

test('modo M (decisión 80): línea M sobre la VCI subxifoidea; su banda cambia con la respiración y el colapso medido coincide con la verdad', async ({
  page,
}) => {
  budget(360_000);
  // más alto: la franja M crece (34 % del alto) y los calibres, de píxeles enteros, son más finos
  await page.setViewportSize({ width: 1280, height: 1000 });
  const errors = await bootWithoutErrors(page);
  // La sesión arranca con respiración apagada; este ejercicio evalúa un ciclo respiratorio adquirido.
  await page.getByRole('button', { name: 'Activar respiración', exact: true }).click();
  // una mirada: con SwiftShader (≤ 4 cuadros por segundo) la composición espacial promedia 0,75 s de cuadros y
  // suaviza la anchura de la banda (con GPU real, 50 ms)
  await page.evaluate(() => {
    window.__vexusTest!.setCompound(false);
    window.__vexusTest!.goToStartPoint('subxiphoid');
  });
  await page.locator('#mode-m').click();
  await expect(page.locator('#mode-m')).toHaveClass(/active/);
  await expect(page.locator('#mmode')).toBeVisible();
  // barrido a 25 mm/s (≥ 2 ciclos respiratorios en la franja) y 13 cm de profundidad (la VCI, a 10–11 cm, más grande)
  await page.getByRole('button', { name: '25', exact: true }).click();
  for (let k = 0; k < 5; k++) await page.keyboard.press('[');
  await withinFrames(page, 2, 'HUD con 13 cm', contains(page, '#hud-tr', '13 cm'));
  // la línea M donde la pone el operador (VExUS): a través de la VCI 2 cm por debajo de la desembocadura de las
  // suprahepáticas (z material 35 mm → 15 mm), según la anatomía de CPU. La más perpendicular del tramo (3,5 cm por
  // debajo) sobrestima el colapso ~6 puntos: el eco especular de la pared de enfrente, máximo de frente, se come
  // 1–1,5 mm de la luz (decisión 80, `m-mode-lumen-blooming`)
  const line = await page.evaluate((blood) => {
    const s = window.__vexusTest!.sim();
    const tr = s.transducer;
    const fr = s.frame;
    let best: { theta: number; r0: number; r1: number; dz: number } | null = null;
    for (let i = 0; i < tr.lines; i++) {
      const theta = -tr.halfSector + (2 * tr.halfSector * i) / (tr.lines - 1);
      const d = [0, 1, 2].map((k) => fr.axial[k] * Math.cos(theta) + fr.lateral[k] * Math.sin(theta));
      const n = Math.hypot(d[0], d[1], d[2]);
      let r0 = -1;
      let r1 = -1;
      let z = 0;
      for (let r = 60; r < s.bmode.depthMm - 5; r += 0.5) {
        const R = tr.curvatureRadius + r;
        const q = s.anatomy.classifyWorld(
          [fr.curvatureCenter[0] + (d[0] / n) * R, fr.curvatureCenter[1] + (d[1] / n) * R, fr.curvatureCenter[2] + (d[2] / n) * R],
          s.sample,
        );
        if ((q.vessel === 'ivcInfra' || q.vessel === 'ivcSupra') && q.tissue === blood) {
          if (r0 < 0) r0 = r;
          r1 = r;
          z = q.material[2];
        } else if (r0 >= 0) break;
      }
      if (r0 >= 0 && (!best || Math.abs(z - 15) < best.dz)) best = { theta, r0, r1, dz: Math.abs(z - 15) };
    }
    if (!best) return null;
    // el punto de la imagen donde el alumno haría clic (píxeles de la ventana)
    const p = s.renderer.beamToPixel(best.theta, (best.r0 + best.r1) / 2, tr);
    const c = document.getElementById('gl') as HTMLCanvasElement;
    const rect = c.getBoundingClientRect();
    return { ...best, x: rect.left + (p.x * rect.width) / c.width, y: rect.top + (p.y * rect.height) / c.height };
  }, Tissue.Blood);
  expect(line, 'ninguna línea cruza la VCI').not.toBeNull();
  expect(line!.dz, JSON.stringify(line)).toBeLessThan(3);
  // un clic sobre la imagen coloca la línea M, como la puerta del PW
  await page.mouse.click(line!.x, line!.y);
  await expect.poll(() => page.evaluate(() => window.__vexusTest!.sim().mmode.theta)).toBeCloseTo(line!.theta, 2);
  // Un drag iniciado antes de congelar no puede mover la guía sobre una adquisición congelada.
  const heldTheta = await page.evaluate(() => window.__vexusTest!.sim().mmode.theta);
  await page.mouse.move(line!.x, line!.y);
  await page.mouse.down();
  await page.keyboard.press(' ');
  await withinFrames(page, 2, 'FREEZE durante drag M', async () => (await textOf(page, '#live-chip')) === 'FREEZE' || 'aún no congelado');
  await page.mouse.move(line!.x + 50, line!.y);
  expect(await page.evaluate(() => window.__vexusTest!.sim().mmode.theta)).toBe(heldTheta);
  await page.mouse.up();
  await page.keyboard.press(' ');
  // la franja cubre un ciclo respiratorio y medio (14/min: 4,3 s; con SwiftShader, ≤ 0,25 s por cuadro): se mide sobre
  // lo que cubre, y la verdad en el mismo intervalo
  const sv = await page.evaluate(() => (document.getElementById('mmode') as HTMLCanvasElement).clientWidth / (25 * 3.2));
  const span = () =>
    page.evaluate(() => {
      const m = window.__vexusTest!.sim().renderer.mStrip;
      return m.count > 1 ? m.time(m.count - 1) - m.time(0) : 0;
    });
  await withinSimSeconds(page, 10, 'la franja M cubre más de 7 s', async () => {
    const x = await span();
    return x > 7 || `${x.toFixed(2)} s en la franja`;
  });
  await page.keyboard.press(' ');
  await withinFrames(page, 2, 'FREEZE', async () => (await textOf(page, '#live-chip')) === 'FREEZE' || (await textOf(page, '#live-chip')));
  // la luz de la VCI en la franja que se ve (el lienzo #mmode), en el centro del tramo de cada columna: el núcleo oscuro
  // (la racha más larga de grises < 50 cerca de la luz) y sus bordes donde el gris cruza la mitad entre la luz y el pico
  // de la pared (en 3 mm), interpolados: donde el operador pone los calibres, de borde interno a borde interno
  const band = await page.evaluate(
    ({ r0, r1, sv }) => {
      const s = window.__vexusTest!.sim();
      const m = s.renderer.mStrip;
      const tR = s.physiology.clock.t;
      const cv = document.getElementById('mmode') as HTMLCanvasElement;
      const [W, H, depth] = [cv.width, cv.height, m.depthMm];
      const img = cv.getContext('2d')!.getImageData(0, 0, W, H).data;
      const k0 = Math.max(0, Math.floor(((r0 - 12) / depth) * H));
      const k1 = Math.min(H - 1, Math.ceil(((r1 + 12) / depth) * H));
      const w3 = Math.round((3 / depth) * H);
      const samples = s.physiology.samples;
      const out: { t: number; x: number; top: number; bottom: number; dAp: number }[] = [];
      // la primera columna cubre un intervalo desconocido: desde la segunda; lejos de la escala del borde derecho
      for (let i = 1; i < m.count; i++) {
        const t = m.time(i);
        const x = Math.floor(((m.time(i - 1) + t) / 2 - (tR - sv)) * (W / sv));
        if (t > tR || x < 0 || x >= W - 45) continue;
        const g = Array.from({ length: H }, (_, y) => img[(y * W + x) * 4]);
        let best = [0, -1];
        let start = -1;
        for (let k = k0; k <= k1 + 1; k++) {
          const dark = k <= k1 && g[k] < 50;
          if (dark && start < 0) start = k;
          if (!dark && start >= 0) {
            if (k - start > best[1] - best[0] + 1) best = [start, k - 1];
            start = -1;
          }
        }
        const run = g.slice(best[0], best[1] + 1).sort((a, b) => a - b);
        const lumen = run[Math.floor(run.length / 2)];
        const edges = [-1, 1].map((dir) => {
          const from = dir < 0 ? best[0] : best[1];
          let peak = 0;
          for (let j = 1; j <= w3; j++) peak = Math.max(peak, g[from + dir * j]);
          const mid = (lumen + peak) / 2;
          for (let j = 0; j < w3; j++) {
            const a = g[from + dir * j];
            const b = g[from + dir * (j + 1)];
            if (a < mid && b >= mid) return from + dir * (j + (mid - a) / (b - a));
          }
          return from;
        });
        let near = samples[0];
        for (const q of samples) if (Math.abs(q.t - t) < Math.abs(near.t - t)) near = q;
        // píxel y → profundidad de su centro, (y + ½)/H
        out.push({ t, x, top: ((edges[0] + 0.5) / H) * depth, bottom: ((edges[1] + 0.5) / H) * depth, dAp: near.ivc.dApMm });
      }
      const tL = out[0].t;
      let max = -Infinity;
      let min = Infinity;
      for (const q of samples)
        if (q.t >= tL && q.t <= tR) {
          max = Math.max(max, q.ivc.dApMm);
          min = Math.min(min, q.ivc.dApMm);
        }
      return { out, truth: { max, min, ci: (100 * (max - min)) / max }, tR, depth };
    },
    { r0: line!.r0, r1: line!.r1, sv },
  );
  const w = band.out.map((c) => c.bottom - c.top);
  const d = band.out.map((c) => c.dAp);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const [mw, md] = [mean(w), mean(d)];
  const corr =
    w.reduce((a, x, i) => a + (x - mw) * (d[i] - md), 0) /
    Math.sqrt(w.reduce((a, x) => a + (x - mw) ** 2, 0) * d.reduce((a, x) => a + (x - md) ** 2, 0));
  // Dónde pone el operador los calibres: en el máximo y el mínimo de la ENVOLVENTE de la banda, no en una columna suelta.
  // Cada columna de la franja es un cuadro, así que cuántas hay en 7 s depende de los fps (27 en el corredor, cientos con
  // GPU real) y los extremos de columnas sueltas son extremos del ruido: en CI la anchura de una columna se aparta
  // ±0,35–0,5 mm de la recta que la une a la verdad (anchura = 0,73–0,77 × dAp − 0,5–1,0 mm; una llegó a 1,96), y la
  // colapsabilidad de las dos columnas extremas salió 32,5–38,2 % frente a 30,4 de la verdad en cuatro ejecuciones.
  // La envolvente es la media de los bordes en ±0,3 s de simulación alrededor de cada columna (≈ 3 columnas en el
  // corredor; ±7 % del ciclo respiratorio de 4,3 s, que apenas achata el máximo y el mínimo), independiente de los fps:
  // sobre esas cuatro ejecuciones da 28,3–30,8 %. (La mediana de las tres rebajaba el máximo: 26,3–31,1.) Las cotas
  // (±5 puntos de la verdad, aquí y con los calibres) no cambian.
  const HALF_WINDOW_S = 0.3;
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const t0 = band.out[0].t;
  const tEnd = band.out[band.out.length - 1].t;
  const around = (i: number) => band.out.filter((c) => Math.abs(c.t - band.out[i].t) <= HALF_WINDOW_S);
  const env = band.out.map((_, i) => {
    const win = around(i);
    const top = mean(win.map((c) => c.top));
    const bottom = mean(win.map((c) => c.bottom));
    return { top, bottom, width: bottom - top, columns: win.length };
  });
  // solo columnas con la ventana entera dentro de la franja
  const inner = band.out.map((_, i) => i).filter((i) => band.out[i].t - HALF_WINDOW_S >= t0 && band.out[i].t + HALF_WINDOW_S <= tEnd);
  const iMax = inner.reduce((best, i) => (env[i].width > env[best].width ? i : best), inner[0]);
  const iMin = inner.reduce((best, i) => (env[i].width < env[best].width ? i : best), inner[0]);
  const ciBand = (100 * (env[iMax].width - env[iMin].width)) / env[iMax].width;
  // Lo que la envolvente deja de ver, columna a columna: el ruido de cada columna respecto a la recta que une su anchura
  // con la verdad (en CI, mediana del desvío absoluto 0,24–0,35 mm; techo 0,6). Una columna mal escrita o con el borde
  // saltando por el moteado de la pared lo sube.
  const slope = w.reduce((a, x, i) => a + (x - mw) * (d[i] - md), 0) / d.reduce((a, x) => a + (x - md) ** 2, 0);
  const residual = median(w.map((x, i) => Math.abs(x - (mw + slope * (d[i] - md)))));
  // informativo: la verdad con la misma envolvente (sus extremos en ±0,3 s) — en CI la banda la supera en 3–5 puntos
  // (la anchura de la banda es ~0,73 × dAp − 0,7 mm, ver el informe del PR); la cota sigue siendo la verdad continua
  const dEnv = band.out.map((_, i) => mean(around(i).map((c) => c.dAp)));
  const jMax = inner.reduce((best, i) => (dEnv[i] > dEnv[best] ? i : best), inner[0]);
  const jMin = inner.reduce((best, i) => (dEnv[i] < dEnv[best] ? i : best), inner[0]);
  const ciTruthEnv = (100 * (dEnv[jMax] - dEnv[jMin])) / dEnv[jMax];
  // la anchura en espiración (el diámetro de la verdad por encima de su mediana) y en inspiración
  const dMed = [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)];
  const wOf = (hi: boolean) => mean(w.filter((_, i) => d[i] > dMed === hi));
  const tag = JSON.stringify({
    n: w.length,
    corr,
    ciBand,
    ciTruthEnv,
    residual,
    slope,
    truth: band.truth,
    wMax: env[iMax],
    wMin: env[iMin],
    wExp: wOf(true),
    wIns: wOf(false),
    line,
  });
  test.info().annotations.push({ type: 'modo M', description: tag });
  test.info().annotations.push({
    type: 'modo M: t, anchura, dAp',
    description: JSON.stringify(band.out.map((c, i) => [c.t, w[i], d[i]].map((v) => +v.toFixed(2)))),
  });
  // la banda es la VCI en todas las columnas y su anchura sigue a la respiración (el diámetro AP de la verdad)
  expect(w.length, tag).toBeGreaterThan(12);
  expect(Math.min(...w), tag).toBeGreaterThan(5);
  expect(Math.max(...w), tag).toBeLessThan(25);
  expect(env[iMax].width - env[iMin].width, tag).toBeGreaterThan(2);
  expect(env[iMax].columns, tag).toBeGreaterThanOrEqual(2);
  expect(env[iMin].columns, tag).toBeGreaterThanOrEqual(2);
  expect(wOf(true) - wOf(false), tag).toBeGreaterThan(1);
  expect(corr, tag).toBeGreaterThan(0.6);
  expect(residual, tag).toBeLessThan(0.6);
  expect(Math.abs(ciBand - band.truth.ci), tag).toBeLessThanOrEqual(5);
  // los calibres de la pestaña Medir sobre la franja congelada: de borde a borde de la envolvente en la columna más ancha
  // y en la más estrecha, con clics enteros accesibles al alumno. Su incertidumbre de resolución es visible.
  await page.getByRole('tab', { name: 'Medir' }).click();
  await page.getByRole('button', { name: 'VCI modo M', exact: true }).click();
  const box = (await page.locator('#mmode').boundingBox())!;
  const clicked: number[] = [];
  const pixels: number[] = [];
  for (const i of [iMax, iMin]) {
    const c = band.out[i];
    // el lienzo tiene densidad 1: su píxel x es el de la ventana
    const x = Math.round(box.x + c.x + 0.5);
    for (const r of [env[i].top, env[i].bottom]) {
      // El segundo extremo tiene peor resolución: verifica que no se pierden sus metadatos al fijar t.
      await page.locator('#mmode').evaluate((el, h) => (el.style.height = `${h}px`), clicked.length % 2 ? box.height / 2 : box.height);
      const pointBox = (await page.locator('#mmode').boundingBox())!;
      const y = Math.round(pointBox.y + (r / band.depth) * pointBox.height);
      clicked.push(((y - pointBox.y) / pointBox.height) * band.depth);
      pixels.push(band.depth / pointBox.height);
      await page.mouse.click(x, y);
    }
  }
  const result = page.locator('.result');
  await expect(result).toContainText(/VCI modo M: máx \d+,\d · mín \d+,\d mm → colapso \d+ %/);
  const ci = Number(/colapso (\d+) %/.exec((await result.textContent()) ?? '')![1]);
  // Separar calibración UI, redondeo de presentación y error físico. La tolerancia física sigue en ±5 puntos.
  const [d1, d2] = [Math.abs(clicked[1] - clicked[0]), Math.abs(clicked[3] - clicked[2])];
  const ciClicks = (100 * (Math.max(d1, d2) - Math.min(d1, d2))) / Math.max(d1, d2);
  expect(Math.abs(ci - ciClicks), `${tag} · calibres ${ci} % (puntos ${ciClicks.toFixed(1)} %)`).toBeLessThanOrEqual(0.51);
  const interval = /Resolución: ([\d,]+)–([\d,]+) %/.exec((await result.textContent()) ?? '')!;
  expect(interval, 'La incertidumbre de los clics debe ser visible al alumno').not.toBeNull();
  const [lo, hi] = [Number(interval[1].replace(',', '.')), Number(interval[2].replace(',', '.'))];
  const pixel = Math.max(...pixels);
  const max = Math.max(d1, d2);
  const min = Math.min(d1, d2);
  expect(lo).toBeCloseTo(Math.max(0, (100 * (max - pixel - min - pixel)) / (max - pixel)), 1);
  expect(hi).toBeCloseTo((100 * (max + pixel - Math.max(0, min - pixel))) / (max + pixel), 1);
  // ±0,05 exclusivamente por mostrar el intervalo con un decimal. La banda mantiene su gate físico ±5 arriba.
  expect(ciBand).toBeGreaterThanOrEqual(lo - 0.05);
  expect(ciBand).toBeLessThanOrEqual(hi + 0.05);
  expect(Math.max(lo - band.truth.ci, band.truth.ci - hi, 0), tag).toBeLessThanOrEqual(5);
  await test.info().attach('VCI M: resolución distinta por extremo', { body: await page.screenshot(), contentType: 'image/png' });
  // Un calibre de un píxel a baja altura CSS supera el mínimo de 1 mm, pero no resuelve colapso.
  await page.getByRole('button', { name: 'VCI modo M', exact: true }).click();
  await page.locator('#mmode').evaluate((el) => (el.style.height = '80px'));
  const smallBox = (await page.locator('#mmode').boundingBox())!;
  for (const dx of [40, 80]) {
    for (const dy of [40, 41]) await page.mouse.click(Math.round(smallBox.x + dx), Math.round(smallBox.y + dy));
  }
  await expect(result).toContainText('Resolución: 0,0–100,0 %');
  await expect(result).not.toContainText('NaN');
  expect(errors).toEqual([]);
});
