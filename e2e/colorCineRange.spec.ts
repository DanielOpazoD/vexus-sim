import { expect, test } from '@playwright/test';
import type { RenderTarget } from '../src/ultrasound/gl';
import { bootWithoutErrors, budget } from './support';

for (const caseId of ['normal-adult', 'severe-congestion']) {
  test(`cine Color conserva el campo complejo de tejido móvil con ganancia alta, ${caseId}`, async ({ page }, info) => {
    budget(90_000);
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    if (caseId !== 'normal-adult') await page.selectOption('#case-select', caseId);
    const observed = await page.evaluate(() => {
      const hooks = window.__vexusTest!,
        sim = hooks.sim();
      const freeze = document.querySelector<HTMLButtonElement>('#freeze')!;
      if (sim.frozen) freeze.click();
      hooks.goToStartPoint('portalSubcostal');
      sim.patient.respiratoryPattern = 'apnea-expiratory';
      document.querySelector<HTMLButtonElement>('#mode-color')!.click();
      const base = { ...sim.pose, lift: -1 };
      const renderer = sim.renderer;
      // Test-only GPU readback: compare the stored complex signal before atan2,
      // not a screenshot whose saturated brightness can hide a phase error.
      const raw = renderer as unknown as { tColor: RenderTarget; readRgba: (target: RenderTarget, attachment: number) => Float32Array };
      const gl = renderer.gl,
        allocate = gl.texStorage3D.bind(gl);
      const allocations: number[][] = [];
      gl.texStorage3D = (...args: Parameters<typeof allocate>) => {
        allocations.push(args);
        allocate(...args);
      };
      const rows = [];
      try {
        for (const gainDb of [12, 24]) {
          renderer.setScene(sim.scene);
          sim.equipment = {
            ...sim.equipment,
            bmode: { ...sim.bmode, persistence: 0 },
            color: { ...sim.color, enabled: true, gainDb, wallFilterHz: 20, r0: 5, r1: 40, theta0: -0.3, theta1: 0.3 },
          };
          sim.setPose(base);
          sim.advance(1 / 60);
          sim.advance(1 / 60);
          sim.render({ forceColor: true });
          // Ordinary pose/contact/clock paths produce the moving-clutter signal.
          sim.setPose({ ...base, phi: base.phi + 0.005, z: base.z + 0.5, lift: -2 });
          sim.advance(1 / 60);
          sim.render({ forceColor: true });
          renderer.cineSeal();
          const target = renderer.cineCount - 1,
            frame = renderer.cineFrame(target);
          const live = raw.readRgba(raw.tColor, 0),
            velocity = [...sim.probeVelocity];
          const liveFrequency = renderer.readColorField().data;
          // A later acquired frame forces reconstruction, avoiding the live-image shortcut.
          sim.advance(0.1);
          sim.render({ forceColor: true });
          renderer.cineSeal();
          const laterFrame = renderer.cineFrame(renderer.cineCount - 1);
          renderer.showCine(target);
          const replay = raw.readRgba(raw.tColor, 0),
            replayFrequency = renderer.readColorField().data;
          let overflow = 0,
            mismatches = 0,
            nonfinite = 0,
            maxFrequencyError = 0,
            maxLive = 0;
          for (let i = 0; i < live.length; i += 4) {
            for (let c = 0; c < 2; c++) {
              maxLive = Math.max(maxLive, Math.abs(live[i + c]));
              if (Math.abs(live[i + c]) > 65504) overflow++;
              if (live[i + c] !== replay[i + c]) mismatches++;
              if (!Number.isFinite(live[i + c]) || !Number.isFinite(replay[i + c])) nonfinite++;
            }
            maxFrequencyError = Math.max(maxFrequencyError, Math.abs(liveFrequency[i] - replayFrequency[i]));
          }
          rows.push({
            gainDb,
            velocity,
            maxLive,
            overflow,
            mismatches,
            nonfinite,
            maxFrequencyError,
            target,
            current: renderer.cineCount - 1,
            frame: frame.n,
            laterFrame: laterFrame.n,
            prf: frame.colorFrame!.prf,
            laterPrf: laterFrame.colorFrame!.prf,
          });
          renderer.cineExit();
        }
      } finally {
        gl.texStorage3D = allocate;
        if (!sim.frozen) freeze.click();
      }
      return { rows, allocations, format: gl.RG32F };
    });
    await info.attach('color-cine-range.json', { body: JSON.stringify(observed, null, 2), contentType: 'application/json' });
    for (const row of observed.rows) {
      expect(row.velocity.some((v) => Math.abs(v) > 1)).toBe(true);
      expect(row.maxLive).toBeGreaterThan(65504);
      expect(row.overflow).toBeGreaterThan(100);
      expect(row.target).toBeLessThan(row.current);
      expect(row.frame).toBeLessThan(row.laterFrame);
      expect(row.prf).toBe(row.laterPrf);
      expect(row.nonfinite).toBe(0);
      expect(row.mismatches).toBe(0);
      expect(row.maxFrequencyError).toBe(0);
    }
    const color = observed.allocations.filter((args) => args[3] === 96 && args[4] === 160);
    expect(color.length).toBeGreaterThan(0);
    for (const allocation of color) {
      expect(allocation.slice(1)).toEqual([1, observed.format, 96, 160, 120]);
      // Two float32 components only: preserve 120 frames, the grid and cadence.
      expect(120 * (192 * 1024 * 2 + allocation[3] * allocation[4] * 8)).toBe(61_931_520);
    }
    expect(errors).toEqual([]);
  });
}
