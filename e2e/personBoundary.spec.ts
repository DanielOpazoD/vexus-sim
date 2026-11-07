import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { CutMapReply } from '../src/ui/cutMapProtocol';
import type { PersonBundleGraph } from '../tools/ci/personBundles';
import { BOOT_MS, bootWithoutErrors, budget, withinFrames } from './support';

// El grafo lo escribe el build; se lee al ejecutar, no al listar las pruebas (la CI lista sin `dist/`).
let cached: PersonBundleGraph | undefined;
const bundleGraph = (): PersonBundleGraph =>
  (cached ??= JSON.parse(readFileSync('dist/person-bundle-graph.json', 'utf8')) as PersonBundleGraph);
const privateChunks = () =>
  bundleGraph()
    .chunks.filter((c) => c.modules.some((m) => /(?:^|\/)s0028|\/personShader\.ts$/.test(m)))
    .map((c) => c.file);
const runtime = (person: 'default' | 's0028') =>
  bundleGraph().selections.find((s) => s.importer === 'src/anatomy/loadPerson.ts' && s.person === person)!.to;

test('default carga sus vistas y Worker sin solicitar ningún módulo privado s0028', async ({ page, context }) => {
  budget(20_000);
  const requests: string[] = [];
  context.on('request', (request) => requests.push(new URL(request.url()).pathname.slice(1)));
  const errors = await bootWithoutErrors(page, '?e2e=1&docente');
  await withinFrames(page, 30, 'Worker diferido default entrega un mapa', () =>
    page.evaluate(() => !!document.querySelector('#cutmap')?.getAttribute('data-acquired-frame') || 'mapa pendiente'),
  );
  expect(await page.evaluate(() => window.__vexusTest!.sim().scene.identity.person)).toBe('current');
  await page.locator('#debug-toggle').check();
  const teacher = bundleGraph().chunks.find((c) => c.modules.includes('src/ui/panel/teacherTab.ts'))!.file;
  await expect.poll(() => requests.includes(teacher)).toBe(true);
  expect(requests).toContain(bundleGraph().worker);
  expect(requests.filter((path) => privateChunks().includes(path))).toEqual([]);
  expect(requests).toContain(runtime('default'));
  expect(requests.filter((path) => /direct\.gzip|skin-polar|annotation-capacity|candidate-manifest|\/surfaces\.gzip/.test(path))).toEqual(
    [],
  );
  expect(errors).toEqual([]);
});

test('el fallo del chunk CPU del Worker muestra un aviso al alumno y permite recargar la misma persona', async ({ page, context }) => {
  budget(20_000);
  const cpu = bundleGraph().selections.find((s) => s.importer === 'src/ui/cutMapWorker.ts' && s.person === 's0028')!.to;
  let requests = 0;
  await context.route(`**/${cpu}`, (route) => (++requests === 1 ? route.continue() : route.abort('failed')));
  await page.goto('/?e2e=1&abdomen=s0028');
  await page.waitForFunction(() => window.__vexusTest?.loggedErrors().some((message) => message.startsWith('corte:')), undefined, {
    timeout: BOOT_MS,
  });
  expect(requests).toBeGreaterThan(1);
  const warning = page.getByRole('alert').filter({ hasText: 'No se pudo cargar el plano anatómico' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('s0028');
  await expect(warning).toContainText('El corte no está disponible');
  expect(await page.locator('#cutmap').getAttribute('data-acquired-frame')).toBeNull();
  expect(await page.evaluate(() => window.__vexusTest!.sim().scene.identity.person)).toBe('s0028');
  await page.locator('#cut-toggle').click();
  await expect(warning).toBeVisible();
  await test.info().attach('aviso-corte-no-disponible', { body: await page.screenshot(), contentType: 'image/png' });
  const reload = page.waitForEvent('domcontentloaded');
  await warning.getByRole('button', { name: 'Recargar esta persona' }).click();
  await reload;
  expect(new URL(page.url()).searchParams.get('abdomen')).toBe('s0028');
});

test('el Worker emitido comunica el fallo de su import CPU sin DOM ni publicar mapas', async ({ page, context }) => {
  budget(20_000);
  await bootWithoutErrors(page, '?e2e=1&abdomen=s0028');
  const cpu = bundleGraph().selections.find((s) => s.importer === 'src/ui/cutMapWorker.ts' && s.person === 's0028')!.to;
  // La página ya instaló CPU. Un Worker nuevo tiene su propio registro de módulos;
  // bloquear su import comprueba el archivo realmente emitido y la ruta de rechazo de Vite.
  await context.route(`**/${cpu}`, (route) => route.abort('failed'));
  const result = await page.evaluate(async (url) => {
    const sim = window.__vexusTest!.sim(),
      person = sim.scene.person;
    const worker = new Worker(url, { type: 'module' });
    try {
      return await new Promise<{ type: string; message?: string; epoch: number; assetKey: string }>((resolve, reject) => {
        worker.onerror = (event) => reject(new Error(event.message));
        worker.onmessage = (event: MessageEvent<CutMapReply>) => resolve(event.data);
        worker.postMessage({
          type: 'init',
          id: 71,
          epoch: 7,
          identity: person.identity,
          assetKey: person.assetKey,
          patient: sim.patient,
          buffers: person.assets.buffers,
        });
      });
    } finally {
      worker.terminate();
    }
  }, `/${bundleGraph().worker}`);
  expect(result).toMatchObject({ type: 'error', epoch: 7 });
  expect(result.message).toMatch(/import|fetch|module/i);
  expect(result.message).not.toMatch(/document|window.*defined/);
  expect(await page.evaluate(() => window.__vexusTest!.sim().scene.identity.person)).toBe('s0028');
});

for (const failure of ['network', 'evaluation'] as const) {
  test(`un chunk s0028 fallido (${failure}) deja error visible, sin persona default, y recarga la misma selección`, async ({
    page,
    context,
  }) => {
    budget(20_000, 0);
    const requests: string[] = [];
    context.on('request', (request) => requests.push(new URL(request.url()).pathname.slice(1)));
    const target = runtime('s0028');
    await context.route(`**/${target}`, (route) =>
      failure === 'network'
        ? route.abort('failed')
        : route.fulfill({ contentType: 'text/javascript', body: "throw new Error('s0028 evaluation sentinel');" }),
    );
    await page.goto('/?e2e=1&abdomen=s0028');
    await expect(page.locator('.error')).toContainText('No se pudo cargar s0028');
    expect(await page.evaluate(() => window.__vexusTest)).toBeUndefined();
    expect(requests).not.toContain(runtime('default'));
    expect(requests.filter((path) => /abdominal-atlas|thoracic-atlas/.test(path))).toEqual([]);
    const attempts = requests.filter((path) => path === target).length;
    await page.getByRole('button', { name: 'Recargar esta persona' }).click();
    await expect(page.locator('.error')).toContainText('No se pudo cargar s0028');
    await expect.poll(() => requests.filter((path) => path === target).length).toBeGreaterThan(attempts);
    expect(new URL(page.url()).searchParams.get('abdomen')).toBe('s0028');
    expect(requests).not.toContain(runtime('default'));
  });
}
