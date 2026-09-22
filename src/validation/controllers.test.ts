import { describe, expect, it } from 'vitest';
import { ErrorBudget } from '../app/errorBudget';
import { HeartRateDisplay, hudText, type HudInput } from '../ui/controllers/hud';

describe('Presupuesto de errores del bucle', () => {
  it('pasa a degradado con más de 5 fallos en 2 s y se recupera cuando la ventana se vacía', () => {
    const b = new ErrorBudget(2000, 5);
    for (let i = 0; i < 5; i++) expect(b.fail(i * 100)).toBe(false);
    expect(b.fail(500)).toBe(true);
    // 3 s después los fallos viejos ya no cuentan
    expect(b.fail(3500)).toBe(false);
  });
});

describe('HUD', () => {
  const base: HudInput = {
    patientLabel: 'Adulto sano',
    frozen: false,
    heartRateBpm: 70.4,
    atrialFibrillation: false,
    transducerMHz: 3.5,
    f0DopplerHz: 2.5e6,
    depthMm: 180,
    gainDb: 0,
    dynamicRangeDb: 60,
    mode: 'B',
    color: { prfHz: 2000, wallFilterHz: 60, frameHz: 8.2 },
    pw: { prfHz: 2600, gateMm: 4, depthMm: 95, sweepMmS: 50 },
    respVolume: 0.42,
  };
  it('esquinas y chip según el modo, con la frecuencia del transductor', () => {
    const b = hudText(base);
    expect(b.topRight).toEqual(['FC 70 lpm · Sinusal', '18 cm · 3,5 MHz · G 0 dB · RD 60']);
    expect(b.bottomRight).toEqual(['resp 0.42']);
    expect(b.chip).toBe('');
    const c = hudText({ ...base, mode: 'color' });
    expect(c.bottomRight[0]).toMatch(/^Color ±\d+ cm\/s · WF 60 Hz · 8 Hz$/);
    const p = hudText({ ...base, mode: 'pw', frozen: true, atrialFibrillation: true });
    expect(p.topLeft[0]).toBe('Adulto sano · congelada');
    expect(p.topRight[0]).toContain('FA');
    expect(p.chip).toBe('Puerta 9.5 cm · 50 mm/s');
  });
  it('la FC mostrada se suaviza (media móvil) y arranca en el primer valor', () => {
    const hr = new HeartRateDisplay();
    expect(hr.update(1, 0.016)).toBe(60);
    const next = hr.update(0.5, 0.016); // salto a 120 lpm
    expect(next).toBeGreaterThan(60);
    expect(next).toBeLessThan(62);
  });
});
