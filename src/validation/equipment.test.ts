import { describe, expect, it } from 'vitest';
import { EQUIPMENT_LIMITS, EquipmentController, maxPrfForDepth, normalizeEquipment, reduceEquipment, type EquipmentContext } from '../app/equipment';
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
});
