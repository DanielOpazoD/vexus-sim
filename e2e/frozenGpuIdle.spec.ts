import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, withinFrames } from './support';

declare global {
  interface Window {
    idleGpu: { fences: number; draws: number };
  }
}

test('two frozen views submit no empty GPU fences and still redraw camera, cine and resize', async ({ page, context }, info) => {
  budget(90_000, 2);
  const other = await context.newPage();
  const pages = [page, other];
  const errors = [];
  const records = [];
  try {
    for (const p of pages) {
      await p.addInitScript(() => {
        window.idleGpu = { fences: 0, draws: 0 };
        for (const name of ['fenceSync', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'blitFramebuffer']) {
          const original: unknown = Reflect.get(WebGL2RenderingContext.prototype, name);
          if (typeof original !== 'function') throw new Error(`Missing GL method ${name}`);
          Reflect.set(WebGL2RenderingContext.prototype, name, function (this: WebGL2RenderingContext, ...args: unknown[]) {
            window.idleGpu[name === 'fenceSync' ? 'fences' : 'draws']++;
            return Reflect.apply(original, this, args) as unknown;
          });
        }
      });
      errors.push(await bootWithoutErrors(p, '?e2e=app&abdomen=atlas'));
    }
    for (const p of pages) await p.locator('#freeze').click();
    for (const p of pages) {
      await withinFrames(p, 90, 'frozen map matches the displayed frame', () =>
        p.evaluate(
          () =>
            Number(document.querySelector<HTMLElement>('#cutmap')!.dataset.acquiredFrame) ===
              window.__vexusTest!.sim().renderer.displayedFrame!.n || 'pending',
        ),
      );
      const settled = await p.evaluate(() => window.__vexusTest!.framesRendered());
      await withinFrames(p, 30, 'frozen presentation settles', () =>
        p.evaluate((n) => window.__vexusTest!.framesRendered() >= n + 8 || 'pending', settled),
      );
      const before = await p.evaluate(() => ({
        ...window.idleGpu,
        loop: window.__vexusTest!.framesRendered(),
        n: window.__vexusTest!.sim().renderer.displayedFrame!.n,
        t: window.__vexusTest!.sim().sample.t,
      }));
      await withinFrames(p, 45, 'thirty real idle UI turns', () =>
        p.evaluate((n) => window.__vexusTest!.framesRendered() >= n + 30 || 'pending', before.loop),
      );
      const after = await p.evaluate(() => ({
        ...window.idleGpu,
        loop: window.__vexusTest!.framesRendered(),
        n: window.__vexusTest!.sim().renderer.displayedFrame!.n,
        t: window.__vexusTest!.sim().sample.t,
      }));
      records.push({ before, after });
      expect(after.draws - before.draws).toBe(0);
      expect(after.fences - before.fences).toBe(0);
      expect(after.n).toBe(before.n);
      expect(after.t).toBe(before.t);
    }
    const before = await page.evaluate(() => ({ ...window.idleGpu }));
    await page.locator('#nav-zoom-in').click();
    await withinFrames(page, 30, 'frozen camera redraw is fenced', () =>
      page.evaluate((b) => (window.idleGpu.draws > b.draws && window.idleGpu.fences > b.fences) || 'pending', before),
    );
    const resized = await page.evaluate(() => ({ ...window.idleGpu }));
    await page.setViewportSize({ width: 1280, height: 820 });
    await withinFrames(page, 30, 'resized frozen image is fenced', () =>
      page.evaluate((b) => (window.idleGpu.draws > b.draws && window.idleGpu.fences > b.fences) || 'pending', resized),
    );
    const cine = await page.evaluate(() => ({ ...window.idleGpu }));
    await page.locator('#cine').evaluate((el: HTMLInputElement) => {
      el.value = '0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await withinFrames(page, 30, 'historical cine selection is fenced', () =>
      page.evaluate((b) => (window.idleGpu.draws > b.draws && window.idleGpu.fences > b.fences) || 'pending', cine),
    );
    const live = await page.evaluate(() => {
      const r = window.__vexusTest!.sim().renderer;
      return { n: r.cineFrame(r.cineCount - 1).n, ...window.idleGpu };
    });
    await page.locator('#freeze').click();
    await withinFrames(page, 60, 'live acquisition resumes after idle and cine', () =>
      page.evaluate(
        (b) => (window.__vexusTest!.sim().renderer.displayedFrame!.n > b.n && window.idleGpu.draws > b.draws) || 'pending',
        live,
      ),
    );
    for (const e of errors) expect(e).toEqual([]);
  } finally {
    await info.attach('idle-gpu.json', { body: JSON.stringify(records), contentType: 'application/json' });
    await other.close();
  }
});
