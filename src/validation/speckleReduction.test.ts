import { describe, expect, it } from 'vitest';
import { normalizeEquipment } from '../app/equipment';
import { defaultEquipment } from '../app/simulator';
import { windowPreset } from '../app/windowPreset';
import { C_RECONSTRUCTION_MM_S } from '../core/units';
import { CONVEX_C35 } from '../probe/probe';
import { FRAME_PASSES, passGraphErrors } from '../ultrasound/passGraph';
import { DEFAULT_BMODE, SPECKLE_LEVELS } from '../ultrasound/renderer';
import { FRAG_COLOR, FRAG_MLINE, FRAG_SCANCONVERT, FRAG_SPECKLE } from '../ultrasound/shaders/passes.glsl';

describe('reducción de moteado del equipo (decisión 313)', () => {
  it('es una rama de la presentación: R solo lee la envolvente, solo G lee su salida y nadie más la usa', () => {
    expect(passGraphErrors(FRAME_PASSES)).toEqual([]);
    const r = FRAME_PASSES.find((p) => p.id === 'speckleReduction')!;
    expect(r.reads).toEqual(['env']);
    expect(r.writes).toBe('bLog');
    expect(FRAME_PASSES.filter((p) => p.reads.includes('bLog')).map((p) => p.id)).toEqual(['scanConvert']);
    expect(FRAME_PASSES.filter((p) => p.writes === 'env').map((p) => p.id)).toEqual(['compound']);
    expect(FRAG_COLOR).not.toContain('uBLog');
    expect(FRAG_MLINE).not.toContain('uBLog');
  });

  it('la física queda fuera: 0 por omisión; el preajuste de ventana no lo toca', () => {
    expect(DEFAULT_BMODE.speckleReduction).toBe(0);
    for (const id of ['renal', 'hepatorenal', 'portal', 'subxiphoid'] as const)
      for (const cmd of windowPreset(id, 2.5e6, true, true))
        if (cmd.type === 'bmode') expect(cmd.patch).not.toHaveProperty('speckleReduction');
  });

  it('el equipo solo admite 0, 1 y 2', () => {
    const ctx = { halfSectorRad: CONVEX_C35.halfSector, cMmS: C_RECONSTRUCTION_MM_S };
    const base = defaultEquipment();
    for (const [input, want] of [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 0],
    ] as const) {
      const out = normalizeEquipment({ ...base, bmode: { ...base.bmode, speckleReduction: input as 0 } }, ctx);
      expect(out.bmode.speckleReduction).toBe(want);
    }
  });

  it('los niveles crecen y siguen siendo laterales: sin toques axiales ni un soporte mayor que un grano', () => {
    expect(SPECKLE_LEVELS).toHaveLength(3);
    for (let i = 1; i < SPECKLE_LEVELS.length; i++) {
      const [step, sigma, mix] = SPECKLE_LEVELS[i];
      expect(step).toBeGreaterThan(SPECKLE_LEVELS[i - 1][0]);
      expect(sigma).toBeGreaterThan(SPECKLE_LEVELS[i - 1][1]);
      expect(mix).toBeGreaterThan(SPECKLE_LEVELS[i - 1][2]);
      expect(mix).toBeLessThanOrEqual(0.85);
      // cuatro toques por lado: ±1,2 mm como mucho
      expect(4 * step).toBeLessThanOrEqual(1.2);
    }
    // el toque se desplaza en líneas, nunca en filas
    expect(FRAG_SPECKLE).toContain('tapDb(float(ij.x) + float(side * k) * stepLine, ij.y, size)');
  });

  it('G usa la rama solo si R ha corrido, y la prioridad del color no la ve', () => {
    expect(FRAG_SCANCONVERT).toContain('uSpeckleOn == 1 ? displayDb(texture(uBLog, uv).r, r) : displayGrey(texture(uEnv, uv).r, r)');
  });
});
