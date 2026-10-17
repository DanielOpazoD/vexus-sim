import { expect, test, type Page } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach, windowAcquired, withinFrames, withinSimSeconds } from './support';

checkAfterEach();

declare global {
  interface Window {
    dopplerPaths: {
      gate: number[][];
      box: number[][];
      line: number[][];
      text: string[];
      strokes: { width: number; color: string; points: number }[];
    };
    dopplerGpu: { held: boolean; polls: number };
  }
}

/** Observa los trazos reales del overlay sin sustituir ningún dibujo. */
async function observeOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dopplerPaths = { gate: [], box: [], line: [], text: [], strokes: [] };
    window.dopplerGpu = { held: false, polls: 0 };
    const gl = window.__vexusTest!.sim().renderer.gl;
    const wait = gl.clientWaitSync.bind(gl);
    gl.clientWaitSync = (sync, flags, timeout) => {
      if (window.dopplerGpu.held) {
        window.dopplerGpu.polls++;
        return gl.TIMEOUT_EXPIRED;
      }
      return wait(sync, flags, timeout);
    };
    const ctx = document.querySelector<HTMLCanvasElement>('#overlay')!.getContext('2d')!;
    const clear = ctx.clearRect.bind(ctx),
      begin = ctx.beginPath.bind(ctx),
      move = ctx.moveTo.bind(ctx),
      line = ctx.lineTo.bind(ctx),
      stroke = ctx.stroke.bind(ctx),
      fillText = ctx.fillText.bind(ctx);
    let path: number[][] = [];
    ctx.clearRect = (...args) => {
      window.dopplerPaths = { gate: [], box: [], line: [], text: [], strokes: [] };
      clear(...args);
    };
    ctx.beginPath = () => {
      path = [];
      begin();
    };
    ctx.moveTo = (x, y) => {
      path.push([x, y]);
      move(x, y);
    };
    ctx.lineTo = (x, y) => {
      path.push([x, y]);
      line(x, y);
    };
    ctx.fillText = (...args) => {
      window.dopplerPaths.text.push(args[0]);
      fillText(...args);
    };
    ctx.stroke = () => {
      window.dopplerPaths.strokes.push({
        width: ctx.lineWidth,
        color: typeof ctx.strokeStyle === 'string' ? ctx.strokeStyle : 'gradient/pattern',
        points: path.length,
      });
      if (ctx.strokeStyle === '#7ff0d8' && ctx.lineWidth === 2) window.dopplerPaths.gate = path.slice();
      // Chromium guarda el grosor en float: 1.2 no vuelve como el mismo double.
      // El color identifica este contorno; abajo se comprueban sus 50 vértices y esquinas.
      if (ctx.strokeStyle === '#ffd166') window.dopplerPaths.box = path.slice();
      if (ctx.strokeStyle === '#ffc857' && ctx.lineWidth === 1.5) window.dopplerPaths.line = path.slice();
      stroke();
    };
  });
}

const state = (page: Page) =>
  page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    return { pose: s.pose, pw: s.pw, color: s.color, mmode: s.mmode, frozen: s.frozen };
  });

/** Coordenada CSS desde la transformación que presenta el abanico adquirido. */
async function point(page: Page, theta: number, r: number) {
  return page.evaluate(
    ({ theta, r }) => {
      const s = window.__vexusTest!.sim();
      const canvas = document.querySelector<HTMLCanvasElement>('#gl')!;
      const rect = canvas.getBoundingClientRect();
      const p = s.renderer.beamToPixel(theta, r, s.renderer.displayedFrame?.anatomy.transducer ?? s.transducer);
      return { x: rect.left + (p.x * rect.width) / canvas.width, y: rect.top + (p.y * rect.height) / canvas.height };
    },
    { theta, r },
  );
}

/** Color adquiere a su cadencia física; 4/6 vueltas JS no equivalen a adquisiciones.
 * Se admite un período actual más el paso máximo del reloj, sin forzar render ni Color. */
async function withinAcquisition(page: Page, what: string, check: () => Promise<true | string>) {
  const seconds = await page.evaluate(() => {
    const s = window.__vexusTest!.sim();
    return (s.color.enabled ? 1 / s.colorTiming.frameHz : 0) + 0.25;
  });
  await withinSimSeconds(page, seconds, what, check);
}

async function readyLayout(page: Page) {
  await withinAcquisition(page, 'sector ajustado al modo', async () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#gl')!;
      const wrap = document.querySelector<HTMLElement>('#sector-wrap')!;
      const s = window.__vexusTest!.sim();
      const d = s.renderer.display;
      const rect = wrap.getBoundingClientRect();
      return (
        (canvas.width === d.width &&
          canvas.height === d.height &&
          canvas.height === Math.max(240, Math.floor(canvas.clientHeight * Math.min(2, devicePixelRatio)))) ||
        `presentación pendiente: ${JSON.stringify({
          canvas: { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight },
          sectorWrap: {
            clientWidth: wrap.clientWidth,
            clientHeight: wrap.clientHeight,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          },
          display: d,
          dpr: devicePixelRatio,
          gpu: window.dopplerGpu,
          frozen: s.frozen,
          frames: window.__vexusTest!.framesRendered(),
          acquiredFrame: s.renderer.displayedFrame?.n,
          colorFrameHz: s.color.enabled ? s.colorTiming.frameHz : null,
        })}`
      );
    }),
  );
}

/** La puerta/ROI dibujados y la adquisición responden mientras el botón continúa pulsado. */
async function drawnAndAcquired(page: Page, acquisition = true) {
  const check = (): Promise<true | string> =>
    page.evaluate((acquisition) => {
      const s = window.__vexusTest!.sim(),
        paths = window.dopplerPaths;
      const tr = s.renderer.displayedFrame?.anatomy.transducer ?? s.transducer;
      const pixel = (theta: number, r: number) => s.renderer.beamToPixel(theta, r, tr);
      if (s.pw.enabled) {
        if (paths.gate.length !== 4) return `puerta sin dibujar; trazos=${JSON.stringify(paths.strokes)}`;
        const mid = paths.gate.reduce((out, p) => [out[0] + p[0] / 4, out[1] + p[1] / 4], [0, 0]);
        const expected = pixel(s.pw.theta, s.pw.depthMm);
        // Trazos vectoriales, sin redondeo a píxel: tolerancia solo de aritmética flotante.
        if (Math.hypot(mid[0] - expected.x, mid[1] - expected.y) > 1e-6) return 'overlay PW anterior';
        const world = s.frame.curvatureCenter.map(
          (v, i) =>
            v +
            (s.transducer.curvatureRadius + s.pw.depthMm) *
              (s.frame.axial[i] * Math.cos(s.pw.theta) + s.frame.lateral[i] * Math.sin(s.pw.theta)),
        );
        if (acquisition && (!s.gateInfo || Math.hypot(...s.gateInfo.world.map((v, i) => v - world[i])) > 1e-6))
          return 'adquisición PW anterior';
      }
      if (s.color.enabled) {
        if (paths.box.length !== 50) return `caja sin dibujar; trazos=${JSON.stringify(paths.strokes)}`;
        const corners = [
          [0, s.color.theta0, s.color.r0],
          [24, s.color.theta1, s.color.r0],
          [25, s.color.theta1, s.color.r1],
          [49, s.color.theta0, s.color.r1],
        ];
        for (const [index, theta, r] of corners) {
          const expected = pixel(theta, r),
            actual = paths.box[index];
          if (Math.hypot(actual[0] - expected.x, actual[1] - expected.y) > 1e-6) return 'overlay Color anterior';
        }
        const c = s.renderer.displayedFrame?.color;
        if (acquisition && (!c?.enabled || (['theta0', 'theta1', 'r0', 'r1'] as const).some((k) => Math.abs(c[k] - s.color[k]) > 1e-6)))
          return 'ROI adquirida anterior';
      }
      return true;
    }, acquisition);
  if (acquisition) await withinAcquisition(page, 'puerta y caja adquiridas antes de soltar', check);
  // La valla bloquea deliberadamente los cuadros completos; aquí responde la presentación
  // CPU y rige el plazo de expect existente, no se espera una adquisición imposible.
  else await expect.poll(check, { message: 'overlay responde con la valla GPU retenida' }).toBe(true);
}

test('PW, Color y tríplex se arrastran antes de soltar sin mover la sonda; se conservan cine, calibre y gestos modificados', async ({
  page,
}, info) => {
  budget(240_000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await observeOverlay(page);
  for (const mode of ['pw', 'color', 'triplex'] as const) {
    await page.locator('#mode-b').click();
    if (mode !== 'pw') await page.locator('#mode-color').click();
    if (mode !== 'color') await page.locator('#mode-pw').click();
    await readyLayout(page);
    const before = await state(page);
    const theta = mode === 'color' ? (before.color.theta0 + before.color.theta1) / 2 : before.pw.theta;
    const r = mode === 'color' ? (before.color.r0 + before.color.r1) / 2 : before.pw.depthMm;
    const start = await point(page, theta, r);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    try {
      // Desplazamientos menores que media caja: detecta el defecto de acompañar solo al salir de ella.
      for (const fraction of [0.1, 0.2]) {
        // Retener una valla ya consultada garantiza que el cuadro adquirido no puede
        // ponerse al día y ocultar un contorno interactivo que espere a la GPU.
        await page.evaluate(() => {
          window.dopplerGpu = { held: true, polls: 0 };
        });
        await withinFrames(page, 2, 'valla controlada en espera', async () =>
          page.evaluate(() => window.dopplerGpu.polls > 0 || 'valla aún no consultada'),
        );
        const heldFrame = await page.evaluate(() => window.__vexusTest!.sim().renderer.displayedFrame!.n);
        const target = await point(
          page,
          theta + fraction * (before.color.theta1 - before.color.theta0),
          r + fraction * (before.color.r1 - before.color.r0),
        );
        await page.mouse.move(target.x, target.y, { steps: 2 });
        const now = await state(page);
        expect(now.pose, `${mode}: la sonda permanece quieta durante el arrastre`).toEqual(before.pose);
        const center = await point(
          page,
          mode === 'color' ? (now.color.theta0 + now.color.theta1) / 2 : now.pw.theta,
          mode === 'color' ? (now.color.r0 + now.color.r1) / 2 : now.pw.depthMm,
        );
        // Chromium cuantiza la posición del puntero; un píxel y medio CSS admite esa cuantización.
        expect(Math.hypot(center.x - target.x, center.y - target.y), `${mode}: objeto sigue al mouse antes de pointerup`).toBeLessThan(1.5);
        if (mode !== 'pw') {
          expect(now.color.theta1 - now.color.theta0).toBeCloseTo(before.color.theta1 - before.color.theta0, 8);
          expect(now.color.r1 - now.color.r0).toBeCloseTo(before.color.r1 - before.color.r0, 8);
        }
        if (mode === 'triplex') {
          expect((now.color.theta0 + now.color.theta1) / 2).toBeCloseTo(now.pw.theta, 8);
          expect((now.color.r0 + now.color.r1) / 2).toBeCloseTo(now.pw.depthMm, 8);
        }
        if (mode === 'color') expect(now.pw).toEqual(before.pw);
        await drawnAndAcquired(page, false);
        expect(
          await page.evaluate(() => window.__vexusTest!.sim().renderer.displayedFrame!.n),
          'el overlay se mueve sobre la adquisición anterior',
        ).toBe(heldFrame);
        await page.evaluate(() => {
          window.dopplerGpu.held = false;
        });
        await drawnAndAcquired(page);
      }
      await page.screenshot({ path: info.outputPath(`${mode}-drag-held.png`) });
    } finally {
      await page.evaluate(() => {
        window.dopplerGpu.held = false;
      });
      await page.mouse.up();
    }
    if (mode === 'color') {
      await page.evaluate(() => {
        window.dopplerGpu = { held: true, polls: 0 };
      });
      try {
        await withinFrames(page, 2, 'valla retenida al apagar Color', async () =>
          page.evaluate(() => window.dopplerGpu.polls > 0 || 'pendiente'),
        );
        const n = await page.evaluate(() => window.__vexusTest!.sim().renderer.displayedFrame!.n);
        await page.locator('#mode-color').click();
        // Los píxeles previos conservan su escala; el contorno del control ya está apagado.
        await expect
          .poll(() =>
            page.evaluate(() => {
              const s = window.__vexusTest!.sim(),
                frame = s.renderer.displayedFrame!;
              return {
                live: s.color.enabled,
                acquired: frame.color.enabled,
                n: frame.n,
                box: window.dopplerPaths.box.length,
                scale: window.dopplerPaths.text.includes('cm/s'),
              };
            }),
          )
          .toEqual({ live: false, acquired: true, n, box: 0, scale: true });
      } finally {
        await page.evaluate(() => {
          window.dopplerGpu.held = false;
        });
      }
    }
  }

  // Alt y botón derecho mantienen la angulación libre aun empezando sobre la puerta.
  for (const modified of ['alt', 'right'] as const) {
    const before = await state(page),
      p = await point(page, before.pw.theta, before.pw.depthMm);
    await page.mouse.move(p.x, p.y);
    if (modified === 'alt') await page.keyboard.down('Alt');
    await page.mouse.down({ button: modified === 'right' ? 'right' : 'left' });
    await page.mouse.move(p.x + 16, p.y + 12, { steps: 2 });
    const now = await state(page);
    expect(now.pose.rock).not.toBe(before.pose.rock);
    expect(now.pose.tilt).not.toBe(before.pose.tilt);
    expect(now.pw).toEqual(before.pw);
    expect(now.color).toEqual(before.color);
    await page.mouse.up({ button: modified === 'right' ? 'right' : 'left' });
    if (modified === 'alt') await page.keyboard.up('Alt');
  }

  await page.locator('#freeze').click();
  await expect(page.locator('#cine-bar')).toBeVisible();
  const held = await state(page),
    p = await point(page, held.pw.theta, held.pw.depthMm);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 25, p.y + 15, { steps: 2 });
  expect(await state(page), 'congelada no desplaza puerta, ROI ni sonda').toEqual(held);
  await page.mouse.up();
  const cine = page.locator('#cine');
  await cine.focus();
  await cine.press('Home');
  await expect(cine).toHaveValue('0');
  await cine.press('End');
  expect(await state(page), 'recorrer el cine no modifica equipo ni pose').toEqual(held);

  // El calibre conserva prioridad aunque el punto esté sobre la puerta PW.
  await page.getByRole('tab', { name: 'Medir', exact: true }).click();
  await page.getByRole('button', { name: 'VCI diámetro', exact: true }).click();
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x + 18, p.y);
  await expect(page.getByRole('heading', { name: 'Calibrador', exact: true })).toBeHidden();
  await expect(
    page
      .locator('.control.proto')
      .filter({ has: page.getByRole('button', { name: 'VCI diámetro', exact: true }) })
      .locator('output'),
  ).toHaveText(/\d+\.\d mm/);
  expect(await state(page), 'el calibre no mueve los controles Doppler').toEqual(held);

  await page.locator('#freeze').click();
  await page.locator('#mode-m').click();
  await readyLayout(page);
  const mBefore = await state(page),
    mStart = await point(page, mBefore.mmode.theta, 80),
    mTarget = await point(page, mBefore.mmode.theta + 0.1, 80);
  await page.mouse.move(mStart.x, mStart.y);
  await page.mouse.down();
  await page.mouse.move(mTarget.x, mTarget.y, { steps: 2 });
  expect((await state(page)).pose).toEqual(mBefore.pose);
  expect((await state(page)).mmode.theta).toBeCloseTo(mBefore.mmode.theta + 0.1, 2);
  await page.keyboard.press(' ');
  const mHeld = await state(page);
  expect(mHeld.frozen).toBe(true);
  await page.mouse.move(mTarget.x + 30, mTarget.y);
  expect(await state(page), 'congelar durante un arrastre M detiene la línea').toEqual(mHeld);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('elegir ventanas reinicia Doppler y M en 2D, sale del cine y adquiere el nuevo destino', async ({ page }) => {
  budget(180_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  for (const destination of [
    { id: 'portal', label: 'Porta · intrahepática', mode: 'color' },
    { id: 'renal', label: 'Renal', mode: 'triplex' },
    { id: 'portalTrunk', label: 'Porta · tronco PW', mode: 'M' },
  ] as const) {
    if (destination.mode === 'M') await page.locator('#mode-m').click();
    else {
      await page.locator('#mode-color').click();
      if (destination.mode === 'triplex') await page.locator('#mode-pw').click();
    }
    if (destination.mode === 'M') {
      await page.locator('#freeze').click();
      await expect(page.locator('#cine-bar')).toBeVisible();
      await page.getByRole('tab', { name: 'Medir', exact: true }).click();
      await page.getByRole('button', { name: 'VCI diámetro', exact: true }).click();
    }
    await page
      .locator('.win-card')
      .filter({ has: page.locator('.win-name', { hasText: new RegExp(`^${destination.label}$`) }) })
      .click();
    await expect(page.locator('#mode-b')).toHaveAttribute('aria-pressed', 'true');
    for (const mode of ['m', 'color', 'pw']) await expect(page.locator(`#mode-${mode}`)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#freeze')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#cine-bar')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Calibrador', exact: true })).toBeHidden();
    await windowAcquired(page, destination.id);
    expect(await page.evaluate(() => window.__vexusTest!.sim().renderer.displayedFrame!.color.enabled)).toBe(false);
    const s = await state(page);
    expect(s.pw.enabled || s.color.enabled || s.mmode.enabled).toBe(false);
  }
  expect(errors).toEqual([]);
});
