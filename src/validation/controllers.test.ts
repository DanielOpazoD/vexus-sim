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
    compound: false,
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
  it('«CX» cuando la composición espacial se forma (decisión 58), y solo entonces', () => {
    expect(hudText({ ...base, compound: true }).topRight[1]).toBe('18 cm · 3,5 MHz · G 0 dB · RD 60 · CX');
    expect(hudText({ ...base, compound: false }).topRight[1]).not.toContain('CX');
  });
  it('la FC mostrada se suaviza (media móvil) y arranca en el primer valor', () => {
    const hr = new HeartRateDisplay();
    expect(hr.update(1, 0.016)).toBe(60);
    const next = hr.update(0.5, 0.016); // salto a 120 lpm
    expect(next).toBeGreaterThan(60);
    expect(next).toBeLessThan(62);
  });
});

describe('Diagnóstico exportable (Fase 3)', () => {
  it('reúne versión, GPU, caso, equipo y errores con un formato versionado y un nombre de archivo estable', async () => {
    const { buildDiagnostics, diagnosticsFileName, buildLabel } = await import('../app/diagnostics');
    const { defaultEquipment } = await import('../app/simulator');
    const d = buildDiagnostics(
      {
        version: '0.4.0',
        commit: 'abc1234',
        buildTime: '2026-09-22T00:00:00Z',
        userAgent: 'test',
        gpu: { vendor: 'V', renderer: 'R' },
        viewport: { width: 800, height: 600, devicePixelRatio: 2 },
        caseId: 'normal-adult',
        simTimeS: 12.5,
        fps: 58,
        gpuMs: { frameMs: 5.7, perPass: { transmission: 1.5, rawField: 4.2 } },
        equipment: defaultEquipment(),
        errors: [{ source: 'gpu', message: 'contexto WebGL perdido', firstAt: 1, lastAt: 2, count: 2 }],
      },
      new Date('2026-09-22T10:11:12.345Z'),
    );
    expect(d.format).toBe('vexus-diagnostico/1');
    expect(d.createdAt).toBe('2026-09-22T10:11:12.345Z');
    expect(d.errors[0].count).toBe(2);
    expect(d.gpuMs?.perPass).toEqual({ transmission: 1.5, rawField: 4.2 });
    expect((JSON.parse(JSON.stringify(d)) as typeof d).equipment.bmode.depthMm).toBe(180);
    expect(diagnosticsFileName(d)).toBe('vexus-diagnostico-0.4.0-abc1234-2026-09-22T10-11-12-345Z.json');
    expect(buildLabel('0.4.0', 'abc1234')).toBe('v0.4.0 · abc1234');
    // las constantes de build existen también en las pruebas (define de Vite)
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('Notas de release desde el CHANGELOG (Fase 3)', () => {
  it('extrae la sección de la versión y falla si no existe', async () => {
    const { releaseNotes } = await import('../../tools/ci/release-notes');
    const md = '# H\n\n## [Sin publicar]\n\n- x\n\n## [0.4.0] — fecha\n\n### Añadido\n\n- a\n\n## [0.3.0]\n\n- b\n';
    expect(releaseNotes(md, '0.4.0')).toBe('### Añadido\n\n- a');
    expect(releaseNotes(md, '0.3.0')).toBe('- b');
    expect(() => releaseNotes(md, '9.9.9')).toThrow(/no tiene sección/);
  });
});
