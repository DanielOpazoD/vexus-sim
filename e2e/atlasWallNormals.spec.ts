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
    const samplers = await page.evaluate(() => {
      const r = window.__vexusTest!.sim().renderer,
        gl = r.gl;
      const seen = new Set<object>(),
        programs = new Map<WebGLProgram, string>();
      const visit = (value: unknown, depth: number): void => {
        if (!value || typeof value !== 'object' || seen.has(value) || ArrayBuffer.isView(value) || depth > 4) return;
        seen.add(value);
        const program: unknown = Reflect.get(value, 'program');
        if (program instanceof WebGLProgram) {
          programs.set(program, String(Reflect.get(value, 'name')));
          return;
        }
        for (const [key, child] of Object.entries(value))
          if (depth || key.startsWith('p') || key.endsWith('Stages')) visit(child, depth + 1);
      };
      visit(r, 0);
      const types = new Set<number>([
        gl.SAMPLER_2D,
        gl.SAMPLER_3D,
        gl.SAMPLER_CUBE,
        gl.SAMPLER_2D_ARRAY,
        gl.SAMPLER_2D_SHADOW,
        gl.SAMPLER_CUBE_SHADOW,
        gl.SAMPLER_2D_ARRAY_SHADOW,
        gl.INT_SAMPLER_2D,
        gl.INT_SAMPLER_3D,
        gl.INT_SAMPLER_CUBE,
        gl.INT_SAMPLER_2D_ARRAY,
        gl.UNSIGNED_INT_SAMPLER_2D,
        gl.UNSIGNED_INT_SAMPLER_3D,
        gl.UNSIGNED_INT_SAMPLER_CUBE,
        gl.UNSIGNED_INT_SAMPLER_2D_ARRAY,
      ]);
      return [...programs].map(([program, name]) => {
        let count = 0;
        for (let i = 0; i < Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)); i++) {
          const u = gl.getActiveUniform(program, i)!;
          if (types.has(u.type)) count += u.size;
        }
        return { name, count };
      });
    });
    // Portabilidad al mínimo WebGL2, aunque la GPU local ofrezca más unidades.
    expect(samplers.length).toBeGreaterThan(15);
    expect(Math.max(...samplers.map((s) => s.count))).toBeLessThanOrEqual(16);
    await info.attach('unidades-textura', { body: JSON.stringify(samplers, null, 2), contentType: 'application/json' });
    await info.attach('normales-pared-atlas', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
