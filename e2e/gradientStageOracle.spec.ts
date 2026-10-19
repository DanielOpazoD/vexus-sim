import { expect, test } from '@playwright/test';
import { gradientOraclePayload, runGradientOracle } from './gradientStageOracle';
import { bootWithoutErrors, budget, checkAfterEach } from './support';

checkAfterEach();
test('gradient stage preserves consumed float bytes in both looks and rejects all seven axis faults', async ({ page }, info) => {
  // One normal application boot; same work budget as startupContexts, no deadline extension.
  budget(90_000);
  const payload = gradientOraclePayload();
  await info.attach('gradient-stage-oracle-sources.json', {
    body: JSON.stringify(payload.provenance, null, 2),
    contentType: 'application/json',
  });
  const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
  await page.locator('#freeze').click();
  const result = await page.evaluate(runGradientOracle, payload);
  await info.attach('gradient-stage-oracle.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.exhaustiveClasses).toBe(payload.ids.tissues * payload.ids.interfaces);
  expect(result.variants).toEqual(['look0', 'steered', 'phased']);
  expect(result.mutants).toHaveLength(21);
  expect(errors).toEqual([]);
});
