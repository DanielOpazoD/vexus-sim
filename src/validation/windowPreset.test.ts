import { expect, it } from 'vitest';
import { windowPreset } from '../app/windowPreset';
import { START_POINTS } from '../app/startPoints';
import { reduceEquipment } from '../app/equipment';
import { defaultEquipment } from '../app/simulator';
import { C_RECONSTRUCTION_MM_S, nyquistVelocityCms } from '../core/units';
import { CONVEX_C35 } from '../probe/probe';

const ctx = { halfSectorRad: CONVEX_C35.halfSector, cMmS: C_RECONSTRUCTION_MM_S };
it.each([true, false])('cada ventana reemplaza los ajustes heredados sin elegir vaso ni cambiar modo (atlas=%s)', (atlas) => {
  for (const sp of START_POINTS) {
    let changed = defaultEquipment();
    changed.bmode.gainDb = 20;
    changed.bmode.tgcDb = [15, 15, 15, 15, 15, 15];
    changed.color = { ...changed.color, invert: true, prfHz: 500, wallFilterHz: 300, gainDb: -10, theta0: 0.2, theta1: 0.5 };
    changed.pw = {
      ...changed.pw,
      prfHz: 500,
      wallFilterHz: 300,
      gainDb: 20,
      baselineShift: 0.45,
      angleCorrection: 1,
      invert: true,
      gateMm: 10,
      sweepMmS: 100,
      theta: 0.5,
      depthMm: 150,
    };
    let fresh = defaultEquipment();
    for (const cmd of windowPreset(sp.id, CONVEX_C35.f0Doppler, atlas, atlas)) {
      changed = reduceEquipment(changed, cmd, ctx);
      fresh = reduceEquipment(fresh, cmd, ctx);
    }
    expect(changed, sp.id).toEqual(fresh);
    expect(changed.color.r1).toBeLessThanOrEqual(changed.bmode.depthMm);
    expect(changed.pw.enabled).toBe(false);
    expect(changed.pw.theta).toBe(0);
    // Switching panels must preserve the operator's independent scales and baseline.
    changed = reduceEquipment(changed, { type: 'pw', patch: { baselineShift: 0.3, prfHz: 2000 } }, ctx);
    const manual = changed.pw;
    changed = reduceEquipment(changed, { type: 'mode', mode: 'pw' }, ctx);
    expect(changed.pw.baselineShift).toBe(manual.baselineShift);
    expect(changed.pw.prfHz).toBe(manual.prfHz);
    if (sp.id === 'renal' || sp.id === 'hepatorenal') {
      expect(nyquistVelocityCms(fresh.color.prfHz, CONVEX_C35.f0Doppler)).toBeCloseTo(15);
      expect(nyquistVelocityCms(fresh.pw.prfHz, CONVEX_C35.f0Doppler)).toBeCloseTo(40);
    }
  }
});
