import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`pared Atlas: caras y normales del modelo compartido coinciden con GPU, ${caseId}`, async ({ page }, info) => {
    budget(300_000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    await page.selectOption('#case-select', caseId);
    await page
      .locator('button', { hasText: /Apnea\s*esp/ })
      .first()
      .click();
    const rows = [];
    for (const startPoint of ['hepatorenal', 'renal', 'portalSubcostal'] as const) {
      const n = await page.evaluate((id) => window.__vexusTest!.wallNormals({ startPoint: id }), startPoint);
      const tag = `${startPoint}: ${JSON.stringify(n)}`;
      // Mismos contratos TS/GLSL del banco de pared existente (smoke.spec),
      // ahora en el perfil Atlas ajustado de ambos pacientes, incluidas sus capas.
      expect(n.points, tag).toBeGreaterThan(300);
      expect(n.mismatched / (n.points + n.mismatched), tag).toBeLessThan(0.01);
      expect(n.p05, tag).toBeGreaterThan(0.98);
      expect(n.normErrP95, tag).toBeLessThan(0.01);
      rows.push({ startPoint, ...n });
    }
    await info.attach('normales-pared-atlas', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
