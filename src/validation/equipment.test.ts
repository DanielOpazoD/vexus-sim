import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_LIMITS,
  EquipmentController,
  gateInColorBox,
  maxPrfForDepth,
  modeFrom,
  modeHasColor,
  modeHasPw,
  normalizeEquipment,
  reduceEquipment,
  toggleMode,
  type EquipmentContext,
  type ImagingMode,
} from '../app/equipment';
import { defaultEquipment } from '../app/simulator';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { CONVEX_C35 } from '../probe/probe';

/** Modelo de dominio del ecógrafo (Fase 1): comandos + invariantes físicas. */
const ctx: EquipmentContext = { halfSectorRad: CONVEX_C35.halfSector, cMmS: C_RECONSTRUCTION_MM_S };
const base = () => normalizeEquipment(defaultEquipment(), ctx);

describe('Estado del equipo', () => {
  it('reducir la profundidad arrastra la puerta PW, la caja de color y el foco dentro de la imagen', () => {
    let e = base();
    e = reduceEquipment(e, { type: 'placeGate', theta: 0, r: 170 }, ctx);
    e = reduceEquipment(e, { type: 'color', patch: { r0: 120, r1: 175 } }, ctx);
    e = reduceEquipment(e, { type: 'bmode', patch: { focusMm: 170 } }, ctx);
    e = reduceEquipment(e, { type: 'bmode', patch: { depthMm: 80 } }, ctx);
    expect(e.bmode.depthMm).toBe(80);
    expect(e.bmode.focusMm).toBeLessThanOrEqual(80);
    expect(e.pw.depthMm + e.pw.gateMm / 2).toBeLessThanOrEqual(80 + 1e-9);
    expect(e.color.r1).toBeLessThanOrEqual(80 + 1e-9);
    expect(e.color.r1 - e.color.r0).toBeGreaterThanOrEqual(EQUIPMENT_LIMITS.colorBox.minDepthMm - 1e-9);
  });

  it('la PRF no supera la que permite la profundidad (PRF ≤ c/2d) ni en PW ni en color', () => {
    let e = base();
    e = reduceEquipment(e, { type: 'placeGate', theta: 0, r: 160 }, ctx);
    e = reduceEquipment(e, { type: 'pw', patch: { prfHz: 12_000 } }, ctx);
    expect(e.pw.prfHz).toBeCloseTo(maxPrfForDepth(e.pw.depthMm + e.pw.gateMm / 2, C_RECONSTRUCTION_MM_S), 6);
    expect(e.pw.prfHz).toBeLessThan(5000);
    e = reduceEquipment(e, { type: 'color', patch: { prfHz: 12_000 } }, ctx);
    expect(e.color.prfHz).toBeLessThanOrEqual(maxPrfForDepth(e.color.r1, C_RECONSTRUCTION_MM_S) + 1e-9);
    // a poca profundidad sí se permite una PRF alta
    e = reduceEquipment(e, { type: 'placeGate', theta: 0, r: 30 }, ctx);
    e = reduceEquipment(e, { type: 'pw', patch: { prfHz: 12_000 } }, ctx);
    expect(e.pw.prfHz).toBeGreaterThan(10_000);
  });

  it('la caja de color y la puerta no salen del sector; escalar conserva el centro', () => {
    let e = base();
    e = reduceEquipment(e, { type: 'centerColorBox', theta: 2, r: 60 }, ctx);
    expect(e.color.theta1).toBeLessThanOrEqual(ctx.halfSectorRad + 1e-9);
    e = reduceEquipment(e, { type: 'placeGate', theta: -3, r: 50 }, ctx);
    expect(e.pw.theta).toBe(-ctx.halfSectorRad);
    const before = base();
    const mid = (x: typeof before) => [(x.color.theta0 + x.color.theta1) / 2, (x.color.r0 + x.color.r1) / 2];
    const scaled = reduceEquipment(before, { type: 'scaleColorBox', factor: 1.15 }, ctx);
    expect(mid(scaled)[0]).toBeCloseTo(mid(before)[0], 9);
    expect(mid(scaled)[1]).toBeCloseTo(mid(before)[1], 9);
    expect(scaled.color.theta1 - scaled.color.theta0).toBeCloseTo(1.15 * (before.color.theta1 - before.color.theta0), 9);
  });

  it('pasos de profundidad y ganancia se acotan; modo exclusivo; TGC por banda; normalizar es idempotente', () => {
    let e = base();
    for (let i = 0; i < 40; i++) e = reduceEquipment(e, { type: 'stepDepth', deltaMm: 10 }, ctx);
    expect(e.bmode.depthMm).toBe(EQUIPMENT_LIMITS.depthMm.max);
    for (let i = 0; i < 40; i++) e = reduceEquipment(e, { type: 'stepGain', deltaDb: -2 }, ctx);
    expect(e.bmode.gainDb).toBe(EQUIPMENT_LIMITS.gainDb.min);
    e = reduceEquipment(e, { type: 'mode', mode: 'color' }, ctx);
    expect([e.color.enabled, e.pw.enabled]).toEqual([true, false]);
    // la ganancia de color es en dB y se acota a los límites del deslizador
    e = reduceEquipment(e, { type: 'color', patch: { gainDb: 99 } }, ctx);
    expect(e.color.gainDb).toBe(EQUIPMENT_LIMITS.colorGainDb.max);
    e = reduceEquipment(e, { type: 'color', patch: { gainDb: -99 } }, ctx);
    expect(e.color.gainDb).toBe(EQUIPMENT_LIMITS.colorGainDb.min);
    e = reduceEquipment(e, { type: 'mode', mode: 'pw' }, ctx);
    expect([e.color.enabled, e.pw.enabled]).toEqual([false, true]);
    e = reduceEquipment(e, { type: 'tgc', band: 3, db: 99 }, ctx);
    expect(e.bmode.tgcDb[3]).toBe(EQUIPMENT_LIMITS.tgcDb.max);
    expect(normalizeEquipment(e, ctx)).toEqual(e);
  });

  it('el controlador avisa en cada comando y nunca expone un estado sin normalizar', () => {
    const c = new EquipmentController({ ...defaultEquipment(), bmode: { ...defaultEquipment().bmode, depthMm: 999 } }, ctx);
    expect(c.state.bmode.depthMm).toBe(EQUIPMENT_LIMITS.depthMm.max);
    const seen: number[] = [];
    c.subscribe((next, prev) => seen.push(next.bmode.depthMm - prev.bmode.depthMm));
    c.dispatch({ type: 'stepDepth', deltaMm: -20 });
    expect(seen).toEqual([-20]);
  });

  it('composición espacial (decisión 58): encendida por defecto; el conmutador sobrevive a abrir el color', () => {
    let e = base();
    expect(e.bmode.compound).toBe(true);
    e = reduceEquipment(e, { type: 'compound', enabled: false }, ctx);
    expect(e.bmode.compound).toBe(false);
    e = reduceEquipment(e, { type: 'compound', enabled: true }, ctx);
    // el color apaga el compuesto por la regla de actividad (compoundActive), no el conmutador
    e = reduceEquipment(e, { type: 'mode', mode: 'color' }, ctx);
    expect(e.bmode.compound).toBe(true);
    e = reduceEquipment(e, { type: 'mode', mode: 'B' }, ctx);
    expect(e.bmode.compound).toBe(true);
    expect(normalizeEquipment(e, ctx)).toEqual(e);
  });
});

describe('Tríplex (decisión 66)', () => {
  const box = (e: ReturnType<typeof base>) => [e.color.theta0, e.color.theta1, e.color.r0, e.color.r1];

  it('Color y PW alternan su función y conservan la otra; 2D apaga las dos', () => {
    expect(toggleMode('B', 'color')).toBe('color');
    expect(toggleMode('B', 'pw')).toBe('pw');
    expect(toggleMode('color', 'pw')).toBe('triplex');
    expect(toggleMode('pw', 'color')).toBe('triplex');
    expect(toggleMode('triplex', 'pw')).toBe('color');
    expect(toggleMode('triplex', 'color')).toBe('pw');
    expect(toggleMode('color', 'color')).toBe('B');
    expect(toggleMode('pw', 'pw')).toBe('B');
    for (const m of ['B', 'color', 'pw', 'triplex'] as ImagingMode[]) expect(modeFrom(modeHasColor(m), modeHasPw(m))).toBe(m);
  });

  it('el tríplex enciende color y PW; la puerta que estaba fuera de la caja salta a su centro', () => {
    let e = base();
    e = reduceEquipment(e, { type: 'color', patch: { theta0: -0.1, theta1: 0.1, r0: 100, r1: 140 } }, ctx);
    // con el color apagado la puerta se mueve sola y la caja no la sigue
    e = reduceEquipment(e, { type: 'placeGate', theta: 0.3, r: 60 }, ctx);
    expect(box(e)).toEqual([-0.1, 0.1, 100, 140]);
    e = reduceEquipment(e, { type: 'mode', mode: 'color' }, ctx);
    e = reduceEquipment(e, { type: 'mode', mode: 'triplex' }, ctx);
    expect([e.color.enabled, e.pw.enabled]).toEqual([true, true]);
    expect(e.pw.theta).toBeCloseTo(0, 9);
    expect(e.pw.depthMm).toBeCloseTo(120, 9);
    expect(gateInColorBox(e)).toBe(true);
  });

  it('el color que se abre con el PW encendido centra la caja en la puerta', () => {
    let e = base();
    e = reduceEquipment(e, { type: 'color', patch: { theta0: -0.1, theta1: 0.1, r0: 100, r1: 140 } }, ctx);
    e = reduceEquipment(e, { type: 'mode', mode: 'pw' }, ctx);
    e = reduceEquipment(e, { type: 'placeGate', theta: 0.3, r: 60 }, ctx);
    // en dúplex (sin color) la caja no sigue a la puerta
    expect(box(e)).toEqual([-0.1, 0.1, 100, 140]);
    e = reduceEquipment(e, { type: 'mode', mode: 'triplex' }, ctx);
    expect([e.pw.theta, e.pw.depthMm]).toEqual([0.3, 60]);
    expect(gateInColorBox(e)).toBe(true);
    expect((e.color.theta0 + e.color.theta1) / 2).toBeCloseTo(0.3, 9);
  });

  it('la puerta que ya estaba dentro de la caja no se mueve al abrir el tríplex', () => {
    let e = base();
    e = reduceEquipment(e, { type: 'color', patch: { theta0: -0.1, theta1: 0.1, r0: 100, r1: 140 } }, ctx);
    e = reduceEquipment(e, { type: 'placeGate', theta: 0.05, r: 110 }, ctx);
    e = reduceEquipment(e, { type: 'mode', mode: 'color' }, ctx);
    e = reduceEquipment(e, { type: 'mode', mode: 'triplex' }, ctx);
    expect([e.pw.theta, e.pw.depthMm]).toEqual([0.05, 110]);
  });

  it('en tríplex la caja acompaña a la puerta que sale de ella, con su tamaño; dentro no se mueve', () => {
    let e = base();
    e = reduceEquipment(e, { type: 'color', patch: { theta0: -0.1, theta1: 0.1, r0: 100, r1: 140 } }, ctx);
    e = reduceEquipment(e, { type: 'mode', mode: 'triplex' }, ctx);
    e = reduceEquipment(e, { type: 'placeGate', theta: 0.02, r: 130 }, ctx);
    expect(box(e)).toEqual([-0.1, 0.1, 100, 140]);
    e = reduceEquipment(e, { type: 'placeGate', theta: -0.3, r: 70 }, ctx);
    expect(gateInColorBox(e)).toBe(true);
    expect((e.color.theta0 + e.color.theta1) / 2).toBeCloseTo(-0.3, 9);
    expect((e.color.r0 + e.color.r1) / 2).toBeCloseTo(70, 9);
    expect(e.color.theta1 - e.color.theta0).toBeCloseTo(0.2, 9);
    expect(e.color.r1 - e.color.r0).toBeCloseTo(40, 9);
    // junto al borde del sector la caja se acota dentro de la imagen y sigue conteniendo la puerta
    e = reduceEquipment(e, { type: 'placeGate', theta: ctx.halfSectorRad, r: 170 }, ctx);
    expect(gateInColorBox(e)).toBe(true);
    expect(e.color.theta1).toBeLessThanOrEqual(ctx.halfSectorRad + 1e-9);
    expect(normalizeEquipment(e, ctx)).toEqual(e);
  });

  it('«Caja −», centrar la caja o reducir la profundidad nunca dejan la puerta fuera de la caja en tríplex', () => {
    let e = base();
    e = reduceEquipment(e, { type: 'color', patch: { theta0: -0.25, theta1: 0.25, r0: 60, r1: 120 } }, ctx);
    e = reduceEquipment(e, { type: 'mode', mode: 'triplex' }, ctx);
    e = reduceEquipment(e, { type: 'placeGate', theta: 0.22, r: 112 }, ctx);
    for (let i = 0; i < 6; i++) {
      e = reduceEquipment(e, { type: 'scaleColorBox', factor: 1 / 1.15 }, ctx);
      expect(gateInColorBox(e), `Caja − ×${i + 1}`).toBe(true);
    }
    // la puerta que el alumno colocó no se pierde: fue la caja la que se movió
    expect([e.pw.theta, e.pw.depthMm]).toEqual([0.22, 112]);
    // centrar la caja lejos de la puerta la lleva a su centro
    e = reduceEquipment(e, { type: 'centerColorBox', theta: -0.3, r: 70 }, ctx);
    expect(gateInColorBox(e)).toBe(true);
    expect(e.pw.theta).toBeCloseTo((e.color.theta0 + e.color.theta1) / 2, 9);
    // reducir la profundidad arrastra las dos y la puerta sigue dentro
    e = reduceEquipment(e, { type: 'bmode', patch: { depthMm: 60 } }, ctx);
    expect(gateInColorBox(e)).toBe(true);
    expect(normalizeEquipment(e, ctx)).toEqual(e);
  });
});
