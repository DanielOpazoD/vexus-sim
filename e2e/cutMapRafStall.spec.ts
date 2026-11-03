import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

declare global {
  interface Window {
    cutRafStall: { hold: boolean; held: number; release: () => void };
  }
}

// Con la GPU saturada (SwiftShader en CI) el compositor puede dejar de entregar RAF mientras
// el hilo principal sigue atendiendo tareas. Si el Worker del corte ya está libre, la
// adquisición nueva sólo puede pedirse fuera de RAF; antes el corte quedaba en el cuadro anterior.
test('el corte atiende una adquisición nueva con RAF suspendido', async ({ page }, info) => {
  budget(90_000);
  await page.addInitScript(() => {
    const callbacks: FrameRequestCallback[] = [];
    const raf = window.requestAnimationFrame.bind(window);
    const state = (window.cutRafStall = {
      hold: false,
      held: 0,
      release() {
        state.hold = false;
        for (const callback of callbacks.splice(0)) raf(callback);
      },
    });
    window.requestAnimationFrame = (callback) =>
      raf((now) => {
        if (state.hold) {
          state.held++;
          callbacks.push(callback);
        } else callback(now);
      });
  });
  const errors = await bootWithoutErrors(page, '?e2e=app');
  let target: number | undefined;
  try {
    const initial = await page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      s.physiology.clock.pause();
      s.frozen = true;
      return s.renderer.displayedFrame!.n;
    });
    // Corte al día y Worker libre: no queda ninguna petición en vuelo.
    await expect.poll(() => page.locator('#cutmap').getAttribute('data-acquired-frame')).toBe(String(initial));
    // En la misma tarea: se retiene RAF y se adquiere otro cuadro, como al mover la sonda congelada.
    const held = await page.evaluate(() => {
      window.cutRafStall.hold = true;
      const frames = window.__vexusTest!.framesRendered();
      const s = window.__vexusTest!.sim();
      s.setPose({ ...s.pose, z: s.pose.z + 1 });
      s.frozen = false;
      s.render();
      s.frozen = true;
      return { frames, target: s.renderer.displayedFrame!.n };
    });
    target = held.target;
    expect(target).not.toBe(initial);
    await expect.poll(() => page.locator('#cutmap').getAttribute('data-acquired-frame')).toBe(String(target));
    // El bucle no corrió: el corte se atendió sin RAF.
    expect(await page.evaluate(() => window.__vexusTest!.framesRendered())).toBe(held.frames);
    expect(await page.evaluate(() => window.__vexusTest!.loggedErrors())).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('cut-raf-stall.json', {
      body: JSON.stringify({
        target,
        ...(await page.evaluate(() => ({
          held: window.cutRafStall.held,
          cut: document.querySelector('#cutmap')?.getAttribute('data-acquired-frame'),
          frames: window.__vexusTest!.framesRendered(),
          displayed: window.__vexusTest!.sim().renderer.displayedFrame!.n,
        }))),
      }),
      contentType: 'application/json',
    });
    await page.evaluate(() => window.cutRafStall.release());
  }
});
