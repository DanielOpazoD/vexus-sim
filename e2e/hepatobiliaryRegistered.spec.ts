import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, checkAfterEach, withinFrames } from './support';
import type { Vec3 } from '../src/core/vec3';
import { Tissue } from '../src/anatomy/tissues';

checkAfterEach();
test('adquisición renal reportada y unión hepatobiliar registrada conservan paridad CPU/GPU', async ({ page }, info) => {
  budget(120_000);
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page
    .getByRole('button', { name: /Apnea\s*esp/ })
    .first()
    .click();
  const pose = { phi: 3.55, z: -180, lift: 0, yaw: -0.1321882345454526, rock: 0.3780207766067785, tilt: 0.04720718521646405 };
  await page.evaluate((pose) => {
    const h = window.__vexusTest!;
    h.setPose(pose);
    Object.assign(h.sim().bmode, {
      depthMm: 160,
      focusMm: 90,
      gainDb: -2,
      tgcDb: [0, 0, 0, 0, 0, 0],
      dynamicRangeDb: 65,
      persistence: 0.35,
      compound: true,
      harmonic: true,
    });
  }, pose);
  await withinFrames(page, 90, 'pose adquirida del informe original', async () =>
    page.evaluate((pose) => {
      const s = window.__vexusTest!.sim();
      const acquired = s.renderer.displayedAnatomy?.pose;
      return (!!acquired && Object.entries(pose).every(([key, value]) => Reflect.get(acquired, key) === value)) || 'pose pendiente';
    }, pose),
  );
  // El hook de paridad es síncrono. Completar primero el mapa congelado
  // evita bloquear la entrega de progreso de un Worker pendiente.
  await page.getByRole('button', { name: 'Congelar', exact: true }).click();
  await withinFrames(page, 90, 'mapa del plano renal adquirido', async () =>
    page.evaluate(() => {
      const s = window.__vexusTest!.sim();
      return (
        Number(document.querySelector<HTMLElement>('#cutmap')?.dataset.acquiredFrame) === s.renderer.displayedFrame?.n || 'mapa pendiente'
      );
    }),
  );

  const points: Vec3[] = [];
  // Rejilla material independiente: cuello/cístico y pedículo. No se cambia
  // la pose para hacer coincidir las clasificaciones ni se filtran discordancias.
  for (let x = -44.17; x <= 1; x += 2.5)
    for (let y = 11.13; y <= 45; y += 2.5) for (let z = -94.19; z <= -40; z += 2.5) points.push([x, y, z]);
  points.push([-39, 17, -80.5]); // pared intravesicular que reprodujo la regresión
  const { rows } = await page.evaluate((points) => window.__vexusTest!.corticalSamples(points), points);
  expect(rows).toHaveLength(points.length);
  let fluid = 0,
    biliaryWall = 0,
    blood = 0,
    maxDistanceError = 0;
  const mismatches: { index: number; cpu: number[]; gpu: number[] }[] = [];
  for (const [index, r] of rows.entries()) {
    if (r[7] !== r[0] || r[8] !== r[1]) mismatches.push({ index, cpu: r.slice(0, 3), gpu: r.slice(7, 10) });
    if (r[0] === Number(Tissue.Fluid)) fluid++;
    if (r[0] === Number(Tissue.BileDuctWall)) biliaryWall++;
    if (r[0] === Number(Tissue.Blood)) blood++;
    maxDistanceError = Math.max(maxDistanceError, Math.abs(r[9] - r[2]));
  }
  expect(mismatches).toEqual([]);
  expect(maxDistanceError).toBeLessThan(0.03);
  expect(fluid).toBeGreaterThan(30);
  expect(biliaryWall).toBeGreaterThan(10);
  expect(blood).toBeGreaterThan(30);
  expect(rows[rows.length - 1][0]).toBe(Tissue.Fluid);
  await info.attach('paridad-hepatobiliar', {
    body: JSON.stringify({ points: rows.length, fluid, biliaryWall, blood, maxDistanceError, mismatches }),
    contentType: 'application/json',
  });
  await info.attach('plano-renal-reportado', { body: await page.locator('.cut-block').screenshot(), contentType: 'image/png' });
  await info.attach('imagen-renal-reportada', { body: await page.locator('#sector-wrap').screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});
