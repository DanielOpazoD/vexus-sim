import { describe, expect, it } from 'vitest';
import type { Simulator } from '../app/simulator';
import type { Store } from '../app/store';
import type { Transducer } from '../probe/probe';
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
    speckleReduction: 0,
    harmonic: false,
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
  it('reducción de moteado (decisión 313): «RM n» en la línea de la imagen solo si actúa', () => {
    expect(hudText(base).topRight[1]).not.toContain('RM');
    expect(hudText({ ...base, speckleReduction: 2 }).topRight[1]).toBe('18 cm · 3,5 MHz · G 0 dB · RD 60 · RM 2');
    expect(hudText({ ...base, compound: true, speckleReduction: 1 }).topRight[1]).toMatch(/ · CX · RM 1$/);
  });
  it('tríplex (decisión 66): las líneas del color y del PW, y el chip con las dos', () => {
    const t = hudText({ ...base, mode: 'triplex' });
    expect(t.bottomRight).toHaveLength(2);
    expect(t.bottomRight[0]).toMatch(/^Color ±\d+ cm\/s · WF 60 Hz · 8 Hz$/);
    expect(t.bottomRight[1]).toMatch(/^PW ±\d+ cm\/s · puerta 4\.0 mm$/);
    expect(t.chip).toMatch(/^±\d+ cm\/s · Puerta 9\.5 cm · 50 mm\/s$/);
  });
  it('modo M (decisión 80): su barrido en la esquina y en el chip, sin las líneas del Doppler', () => {
    const m = hudText({ ...base, mode: 'M' });
    expect(m.bottomRight).toEqual(['M 50 mm/s · resp 0.42']);
    expect(m.chip).toBe('Modo M · 50 mm/s');
  });
  it('«CX» cuando la composición espacial se forma (decisión 58), y solo entonces', () => {
    expect(hudText({ ...base, compound: true }).topRight[1]).toBe('18 cm · 3,5 MHz · G 0 dB · RD 60 · CX');
    expect(hudText({ ...base, compound: false }).topRight[1]).not.toContain('CX');
  });
  it('«THI» delante de la frecuencia con la armónica tisular (decisión 77)', () => {
    expect(hudText({ ...base, harmonic: true, compound: true }).topRight[1]).toBe('18 cm · THI 3,5 MHz · G 0 dB · RD 60 · CX');
    expect(hudText(base).topRight[1]).not.toContain('THI');
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
    // el lazo cerrado y las intervenciones docentes viajan en el diagnóstico (decisión 79)
    const { Circulation } = await import('../physiology/circulation');
    const { NORMAL_ADULT } = await import('../cases');
    const c = new Circulation(NORMAL_ADULT, -3.678);
    c.calibrate({ cardiacOutputMlS: 75, arterialMeanMmHg: 90, compartments: [{ name: 'a', complianceMlPerMmHg: 100, pressureMmHg: 10 }] });
    c.intervene({ kind: 'bolus', volumeMl: 250 }, 3);
    const withLoop = buildDiagnostics({ ...d, circulation: { state: c.update(8), interventions: [...c.interventions] } });
    const parsed = JSON.parse(JSON.stringify(withLoop)) as typeof withLoop;
    expect(parsed.circulation?.interventions).toEqual([{ kind: 'bolus', volumeMl: 250, t0: 3 }]);
    expect(parsed.circulation?.state.fluidTargetMl).toBe(250);
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

describe('Línea M: arrastre sobre la imagen que se ve', () => {
  it('con el lienzo estirado (el contenedor cambió antes del cuadro siguiente) el asa se agarra y la línea va al punto', async () => {
    const { bindImageClick } = await import('../ui/controllers/imageClick');
    const { sectorLayout, beamToPixel } = await import('../ultrasound/sectorGeometry');
    const tr = { curvatureRadius: 50, halfSector: 0.6 } as Transducer;
    // el búfer conserva el alto de antes de la franja M; en pantalla el lienzo ya mide 1000 × 528
    const canvas = { width: 1000, height: 800, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 528 }) };
    const display = sectorLayout(canvas.width, canvas.height, tr, 180, 12);
    const sim = {
      frozen: false,
      transducer: tr,
      mmode: { enabled: true, theta: 0 },
      displayed: { bmode: { depthMm: 180 } },
      renderer: { display, displayedFrame: null, beamToPixel: (theta: number, r: number) => beamToPixel(display, tr, theta, r) },
    };
    const listeners: [string, (e: unknown) => void][] = [];
    const host = { addEventListener: (type: string, fn: (e: unknown) => void) => listeners.push([type, fn]), setPointerCapture: () => {} };
    const placed: number[] = [];
    bindImageClick({
      host: host as unknown as HTMLElement,
      canvas: canvas as unknown as HTMLCanvasElement,
      getSim: () => sim as unknown as Simulator,
      store: { get: () => ({ tool: 'none', mode: 'M' }) } as unknown as Store,
      setIvcCaliper: () => {},
      dispatch: (cmd) => {
        if (cmd.type === 'placeMLine') placed.push(cmd.theta);
      },
    });
    /** Evento de puntero en la posición de pantalla del haz (θ, r). */
    const event = (theta: number, r: number) => {
      const p = beamToPixel(display, tr, theta, r);
      return {
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: p.x,
        clientY: (p.y * 528) / 800,
        target: null,
        stopPropagation: () => {},
      };
    };
    const fire = (type: string, e: unknown) => listeners.filter(([t]) => t === type).forEach(([, fn]) => fn(e));
    fire('pointerdown', event(0, 100));
    fire('pointermove', event(-0.11, 100));
    expect(placed).toHaveLength(1);
    expect(placed[0]).toBeCloseTo(-0.11, 6);
  });
});
