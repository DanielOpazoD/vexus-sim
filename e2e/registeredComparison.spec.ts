import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { BOOT_MS, budget } from './support';
import { comparisonState } from '../tools/fidelity/comparisonState';
import { captureBMode, encodeBMode } from '../tools/fidelity/captureBMode';

test('compara imágenes registradas pese a distinto trabajo del receptor antes de adquirir', async ({ page }, info) => {
  // Dos arranques y hasta 78 cuadros: misma historia de siete cuadros, sin trabajo de relleno innecesario.
  budget(360_000, 2);
  const results: {
    raw: ReturnType<typeof comparisonState>;
    registered: ReturnType<typeof comparisonState>;
    rawHash: string;
    hash: string;
  }[] = [];
  for (let trial = 0; trial < 2; trial++) {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/?e2e=app&reference=1');
    await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) >= 2, undefined, { timeout: BOOT_MS });
    // Congelar inmediatamente: esperar el HUD o clicar antes deja una fase dependiente de la velocidad de la GPU.
    await page.evaluate(comparisonState, { phase: 'prepare' as const, targetSeconds: 5 });
    await page.getByRole('button', { name: 'Apnea espiratoria', exact: true }).click();
    await page.evaluate((extra) => {
      const sim = window.__vexusTest!.sim(),
        button = document.querySelector<HTMLButtonElement>('#freeze')!;
      button.click();
      try {
        for (let i = 0; i < extra; i++) sim.render();
      } finally {
        if (!sim.frozen) button.click();
      }
      if (sim.sample.t !== 5) throw new Error('El control del receptor avanzó la fisiología');
    }, trial * 11);
    const raw = await page.evaluate(comparisonState, { phase: 'capture' as const, targetSeconds: 30, view: 'portal' as const, frames: 6 });
    const read = async () => {
      const frame = await page.evaluate(() => {
        const { width, height, gray } = window.__vexusTest!.sim().renderer.readDisplay();
        return { width, height, gray: Array.from(gray) };
      });
      return createHash('sha256')
        .update(encodeBMode(frame.width, frame.height, frame.gray))
        .digest('hex');
    };
    const rawHash = await read();
    await captureBMode(page, info.outputPath(`unregistered-${trial}.png`));
    const registered = await page.evaluate(comparisonState, {
      phase: 'capture' as const,
      targetSeconds: 60,
      view: 'portal' as const,
      frames: 6,
      historyStartFrame: 33,
    });
    expect(registered).toMatchObject({
      time: 60,
      frozen: true,
      renderedFrame: 39,
      protocol: { receiverPhaseRegistered: true, receiverPhaseReset: false, historyStartFrame: 33, historyEndFrame: 39, frames: 7 },
    });
    await captureBMode(page, info.outputPath(`registered-${trial}.png`));
    results.push({ raw, registered, rawHash, hash: await read() });
    expect(errors).toEqual([]);
  }
  await info.attach('receiver-comparison.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results[0].raw.sample).toEqual(results[1].raw.sample);
  // Control negativo: mismo instante y geometría con diferente fase del receptor.
  expect(results[0].raw.renderedFrame).not.toBe(results[1].raw.renderedFrame);
  expect(results[0].rawHash).not.toBe(results[1].rawHash);
  expect(results[0].registered.sample).toEqual(results[1].registered.sample);
  expect(results[0].registered.pose).toEqual(results[1].registered.pose);
  expect(results[0].registered.bmode).toEqual(results[1].registered.bmode);
  expect(results[0].hash).toBe(results[1].hash);
});
