import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget, withinFrames } from './support';
import type { CutMapInit, CutMapRequest, CutMapResponse } from '../src/ui/cutMapWorker';

interface SharedMapWitness {
  init: CutMapInit;
  requests: Record<number, CutMapRequest>;
  map?: CutMapResponse;
}
declare global {
  interface Window {
    sharedMapWitness?: SharedMapWitness;
  }
}

test('el trabajador modular conserva clasificación y estado separado al cambiar de caso', async ({ page }, info) => {
  budget(180_000);
  await page.addInitScript(() => {
    const original: unknown = Reflect.get(Worker.prototype, 'postMessage');
    if (typeof original !== 'function') throw new Error('Worker.postMessage no disponible');
    Worker.prototype.postMessage = function (message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
      const packet = message as CutMapInit | CutMapRequest;
      if (packet.type === 'init' && 'patient' in packet) {
        const witness: SharedMapWitness = { init: packet, requests: {} };
        window.sharedMapWitness = witness;
        this.addEventListener('message', (ev: MessageEvent<CutMapResponse>) => {
          if (ev.data.type === 'map') witness.map = ev.data;
        });
      } else if (packet.type === 'map' && window.sharedMapWitness) window.sharedMapWitness.requests[packet.id] = packet;
      Reflect.apply(original, this, [message, transfer]);
    };
  });
  const errors = await bootWithoutErrors(page, '?e2e=app&reference=1');
  for (const id of ['normal-adult', 'severe-congestion']) {
    await page.selectOption('#case-select', id);
    await page.locator('.win-card').nth(2).click();
    const priorId = await page.evaluate(() => window.sharedMapWitness?.map?.id ?? -1);
    await page.getByLabel('Rotación', { exact: true }).press('ArrowRight');
    await page.getByLabel('Inclinación', { exact: true }).press('ArrowRight');
    await page.getByLabel('Presión', { exact: true }).press('ArrowRight');
    await withinFrames(page, 60, `respuesta del trabajador de ${id}`, async () =>
      page.evaluate(
        ({ id, priorId }) => {
          const w = window.sharedMapWitness,
            sim = window.__vexusTest!.sim(),
            map = w?.map,
            req = map && w.requests[map.id];
          return w?.init.patient.id === id &&
            map &&
            map.id > priorId &&
            req &&
            JSON.stringify(req.frame) === JSON.stringify(sim.frame) &&
            JSON.stringify(req.compression) === JSON.stringify(sim.contact)
            ? true
            : 'sin respuesta de la pose y presión actuales';
        },
        { id, priorId },
      ),
    );
    const result = await page.evaluate(() => {
      const witness = window.sharedMapWitness!,
        map = witness.map!,
        req = witness.requests[map.id],
        sim = window.__vexusTest!.sim(),
        mismatches: unknown[] = [],
        types = new Set<number>();
      sim.anatomy.setProbeCompression(req.compression);
      let points = 0;
      try {
        // 32 × 32 estratificado: atraviesa pared, hígado, hueso y exterior.
        // Igualdad exacta: ambos entornos ejecutan el mismo clasificador, sin margen numérico nuevo.
        for (let v = 0; v < map.height; v += 4)
          for (let u = 0; u < map.width; u += 3) {
            const theta = -req.transducer.halfSector + (2 * req.transducer.halfSector * (u + 0.5)) / map.width,
              r = (req.depthMm * (v + 0.5)) / map.height,
              dir = req.frame.axial.map((x, i) => x * Math.cos(theta) + req.frame.lateral[i] * Math.sin(theta)),
              point = req.frame.curvatureCenter.map((x, i) => x + (req.transducer.curvatureRadius + r) * dir[i]) as [
                number,
                number,
                number,
              ],
              c = sim.anatomy.classifyWorld(point, req.sample as typeof sim.sample);
            types.add(c.tissue);
            points++;
            if (Number(c.tissue) !== map.tissue[v * map.width + u])
              mismatches.push({ u, v, main: c.tissue, worker: map.tissue[v * map.width + u] });
          }
      } finally {
        sim.anatomy.setProbeCompression(sim.contact);
      }
      return { caseId: sim.patient.id, initCaseId: witness.init.patient.id, points, types: [...types], mismatches };
    });
    expect(result.caseId).toBe(id);
    expect(result.initCaseId).toBe(id);
    expect(result.points).toBe(1024);
    expect(result.types.length).toBeGreaterThan(3);
    expect(result.mismatches).toEqual([]);
    await info.attach(`worker-${id}.json`, { body: JSON.stringify(result), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath(`worker-${id}.png`) });
  }
  expect(errors).toEqual([]);
});
