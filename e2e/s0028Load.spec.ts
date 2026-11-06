import { expect, test } from '@playwright/test';
import type { PersonBuffers } from '../src/anatomy/personAssets';
import { bootWithoutErrors, budget, withinFrames } from './support';

interface WorkerEvidence {
  initializations: Array<{ person: unknown; abdominalBytes: number; thoracicBytes: number; wallBytes: number; skinBytes: number }>;
  maps: number;
  errors: string[];
}
declare global {
  interface Window {
    s0028WorkerEvidence: WorkerEvidence;
  }
}

test('s0028 carga una sola persona, dibuja y rechaza procedencia corrupta', async ({ page }) => {
  budget(20_000, 2);
  const assets: string[] = [];
  page.on('response', (r) => {
    if (/(?:atlas|surface|direct|capacity|skin-polar|candidate-manifest).*\.(?:bin|json)/.test(r.url())) assets.push(r.url());
  });
  await page.addInitScript(() => {
    const evidence: WorkerEvidence = { initializations: [], maps: 0, errors: [] };
    window.s0028WorkerEvidence = evidence;
    const observed = new WeakSet<Worker>();
    // Se invoca sólo con .call(this, ...) para conservar el Worker receptor.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, transferOrOptions: Transferable[] | StructuredSerializeOptions = {}) {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'surfaces')
        throw new Error('Extracción de superficies en el arranque');
      if (message && typeof message === 'object' && 'type' in message && message.type === 'init') {
        if (!observed.has(this)) {
          observed.add(this);
          this.addEventListener('message', ({ data }: MessageEvent<unknown>) => {
            if (!data || typeof data !== 'object' || !('type' in data)) return;
            if (data.type === 'map') evidence.maps++;
            if (data.type === 'error') evidence.errors.push('message' in data ? String(data.message) : 'Worker error');
          });
        }
        const identity = 'identity' in message ? message.identity : undefined;
        const buffers = ('buffers' in message ? message.buffers : {}) as PersonBuffers;
        evidence.initializations.push({
          person: identity && typeof identity === 'object' && 'person' in identity ? identity.person : undefined,
          abdominalBytes: buffers.abdominal?.byteLength ?? 0,
          thoracicBytes: buffers.thoracic?.byteLength ?? 0,
          wallBytes: buffers.capacity?.byteLength ?? 0,
          skinBytes: buffers.skin?.byteLength ?? 0,
        });
      }
      return post.call(this, message, Array.isArray(transferOrOptions) ? { transfer: transferOrOptions } : transferOrOptions);
    };
  });
  const errors = await bootWithoutErrors(page, '?e2e=1&abdomen=s0028');
  expect(await page.evaluate(() => window.__vexusTest!.sim().scene.identity.person)).toBe('s0028');
  await withinFrames(page, 30, 'el Worker diferido entrega un mapa s0028 real', () =>
    page.evaluate(() => window.s0028WorkerEvidence.maps > 0 || 'mapa pendiente'),
  );
  const worker = await page.evaluate(() => window.s0028WorkerEvidence);
  expect(worker.initializations.length).toBeGreaterThan(0);
  for (const init of worker.initializations)
    expect(init).toEqual({
      person: 's0028',
      abdominalBytes: 132_572_160,
      thoracicBytes: 59_234_016,
      wallBytes: 5_671_296,
      skinBytes: 2_813_952,
    });
  expect(worker.errors).toEqual([]);
  expect(assets.filter((u) => /abdominal-atlas|thoracic-atlas|abdominal-surface|thoracic-surface/.test(u))).toEqual([]);
  expect(errors).toEqual([]);
  await page.route('**/surfaces.gzip-*.bin', async (route) => {
    const r = await route.fetch();
    const body = Buffer.from(await r.body());
    body[20] ^= 1;
    await route.fulfill({ response: r, body });
  });
  await page.goto('/?e2e=1&abdomen=s0028');
  await expect(page.locator('body')).toContainText('comprimido alterado');
  expect(await page.evaluate(() => window.__vexusTest)).toBeUndefined();
  await page.unroute('**/surfaces.gzip-*.bin');
  await page.route('**/candidate-manifest-*.bin', async (route) => {
    const r = await route.fetch();
    const body = Buffer.from(await r.body());
    body[0] ^= 1;
    await route.fulfill({ response: r, body });
  });
  await page.goto('/?e2e=1&abdomen=s0028');
  await expect(page.locator('body')).toContainText('procedencia alterados');
  expect(await page.evaluate(() => window.__vexusTest)).toBeUndefined();
});
