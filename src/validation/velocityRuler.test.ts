import { describe, expect, it, vi } from 'vitest';
import { velocityRuler, drawVelocityRuler } from '../ui/velocityRuler';
import { spectrumRowOf } from '../ui/captureOverlay';
import { dopplerShiftHz } from '../core/units';

describe('escala lateral PW', () => {
  it('reproduce el ejemplo asimétrico +60 / −20 sin cambiar la PRF', () => {
    const a = velocityRuler(40, 0.25, false, 240);
    expect(a.top).toBe(60);
    expect(a.bottom).toBe(-20);
    expect(a.ticks.find((x) => x.value === 0)?.row).toBe(180);
  });
  it('la inversión invierte la señal y el desplazamiento, no el signo de los rótulos de pantalla', () => {
    const a = velocityRuler(40, 0.25, true, 240);
    expect(a.top).toBe(20);
    expect(a.bottom).toBe(-60);
    expect(a.ticks.find((x) => x.value === 0)?.row).toBe(60);
  });
  it('no fabrica rótulos si la escala es inválida', () => {
    expect(velocityRuler(0, 0, false, 240).ticks).toEqual([]);
    expect(velocityRuler(NaN, 0, false, 240).ticks).toEqual([]);
  });
  for (const invert of [false, true])
    for (const baseline of [-0.4, 0, 0.4])
      it(`marca el mismo píxel que el espectro: invert=${invert}, baseline=${baseline}`, () => {
        const a = velocityRuler(50, baseline, invert, 200);
        for (const q of a.ticks.filter((t) => t.row > 0 && t.row < 200)) {
          // Independent conversion using actual Doppler units, including screen inversion.
          const f = dopplerShiftHz(q.value * 10 * (invert ? -1 : 1), 2.5e6);
          const prf = 2 * dopplerShiftHz(500, 2.5e6);
          expect(spectrumRowOf(f, prf, { baselineShift: baseline, invert }, 200)).toBeCloseTo(q.row, 8);
        }
      });
});

it('dibuja unidades junto al cero y restaura el contexto', () => {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
  };
  const canvas = { width: 104, height: 480, clientWidth: 52, getContext: () => ctx, getAttribute: () => '', setAttribute: vi.fn() };
  drawVelocityRuler(canvas as unknown as HTMLCanvasElement, 40, 0.25, false);
  expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  expect(ctx.fillText).toHaveBeenCalledWith('0 cm/s', 8, 180);
  expect(ctx.fillText).toHaveBeenCalledWith('60', 8, 7);
  expect(ctx.fillText).toHaveBeenCalledWith('-20', 8, 233);
  expect(ctx.restore).toHaveBeenCalledOnce();
});
