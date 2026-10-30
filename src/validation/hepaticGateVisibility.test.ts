import { describe, expect, it } from 'vitest';
import { hepaticGateDropout, portalBranchShift, portalGateDropout, type GateVesselSample } from '../doppler/vesselIdentity';
const sample = (t: number, hvRight: number): GateVesselSample => ({ t, vessels: { hvRight } });
describe('visibilidad de sangre suprahepática durante una captura', () => {
  it('requiere un tramo observado tan largo como la ventana espectral', () => {
    expect(hepaticGateDropout([sample(0, 0), sample(0.25, 0)], 0, 1, 0.25)).toBe(true);
    expect(hepaticGateDropout([sample(0, 0), sample(0.24, 0)], 0, 1, 0.25)).toBe(false);
    expect(hepaticGateDropout([sample(0, 0)], 0, 1, 0.25)).toBe(false);
    expect(hepaticGateDropout([], 0, 1, 0.25)).toBe(false);
  });
  it('respeta los latidos medidos y no acumula episodios separados por recuperación', () => {
    const track = [sample(0, 0), sample(0.2, 0), sample(0.3, 0.2), sample(0.4, 0), sample(0.6, 0)];
    expect(hepaticGateDropout(track, 0, 1, 0.25)).toBe(false);
    expect(hepaticGateDropout([sample(-0.3, 0), sample(0, 0)], 0, 1, 0.25)).toBe(false);
  });
  it('usa la presencia geométrica de sangre, no el signo o la ausencia de velocidad', () => {
    const track = [sample(0, 0.1), sample(0.5, 0.1)];
    const copy = structuredClone(track);
    expect(hepaticGateDropout(track, 0, 1, 0.25)).toBe(false);
    expect(track).toEqual(copy);
    // El caudal no forma parte de la entrada: una pausa verdadera no desaparece del resultado por esta regla.
  });
  it('suma suprahepáticas y no confunde sangre de otro sistema con visibilidad del objetivo', () => {
    const target: GateVesselSample[] = [0, 0.5].map((t) => ({ t, vessels: { hvRight: 0.006, hvMiddle: 0.005 } }));
    expect(hepaticGateDropout(target, 0, 1, 0.25)).toBe(false);
    const other: GateVesselSample[] = [0, 0.5].map((t) => ({ t, vessels: { pvTrunk: 0.8 } }));
    expect(hepaticGateDropout(other, 0, 1, 0.25)).toBe(true);
  });
});

describe('sangre portal que se va de la puerta durante una captura (decisión 294)', () => {
  const portal = (t: number, pvTrunk: number, pvRight = 0): GateVesselSample => ({ t, vessels: { pvTrunk, pvRight } });
  it('pierde más de la mitad de su máximo durante una ventana espectral', () => {
    expect(portalGateDropout([portal(0, 0.9), portal(0.5, 0.4), portal(0.75, 0.3)], 0, 1, 0.25)).toBe(true);
    expect(portalGateDropout([portal(0, 0.9), portal(0.5, 0.4), portal(0.74, 0.3)], 0, 1, 0.25)).toBe(false);
  });
  it('un vaivén que no baja de la mitad no cuenta, y tampoco lo que pasó fuera de los latidos medidos', () => {
    expect(portalGateDropout([portal(0, 0.9), portal(0.5, 0.46), portal(1, 0.47)], 0, 1, 0.25)).toBe(false);
    expect(portalGateDropout([portal(-1, 0.9), portal(0, 0.4), portal(0.5, 0.4)], 0, 1, 0.25)).toBe(false);
  });
  it('suma tronco y ramas: el reparto entre ellas no es perder el vaso', () => {
    expect(portalGateDropout([portal(0, 0.9, 0), portal(0.5, 0.2, 0.7), portal(1, 0.2, 0.7)], 0, 1, 0.25)).toBe(false);
  });
  it('la puerta sin sangre portal no dice nada: eso lo juzgan la identidad y la calidad', () => {
    expect(
      portalGateDropout(
        [
          { t: 0, vessels: { hvRight: 0.9 } },
          { t: 1, vessels: { hvRight: 0.1 } },
        ],
        0,
        1,
        0.25,
      ),
    ).toBe(false);
  });
});

describe('reparto de la sangre portal que cambia durante una captura (decisión 294)', () => {
  const frames = (shares: readonly number[], total = 0.8): GateVesselSample[] =>
    shares.map((share, i) => ({ t: i * 0.1, vessels: { pvTrunk: total * share, pvRight: total * (1 - share) } }));
  it('la puerta sobre la bifurcación que respira cambia de vaso: tronco de 0,9 a 0,5 de la sangre portal', () => {
    expect(portalBranchShift(frames([0.9, 0.9, 0.8, 0.7, 0.6, 0.5, 0.5, 0.6, 0.7, 0.8]), 0, 1)).toBe(true);
  });
  it('un reparto quieto o solo con el ruido de la población no cuenta, aunque sea mitad y mitad', () => {
    expect(portalBranchShift(frames([0.5, 0.52, 0.48, 0.55, 0.45, 0.5, 0.51, 0.49]), 0, 1)).toBe(false);
    expect(portalBranchShift(frames([1, 1, 1, 1, 1, 1, 1, 1]), 0, 1)).toBe(false);
  });
  it('solo cuenta lo que pasa en los latidos medidos', () => {
    const track = [...frames([0.9, 0.9, 0.9, 0.9]), ...frames([0.5, 0.5, 0.5, 0.5]).map((s) => ({ ...s, t: s.t + 1 }))];
    expect(portalBranchShift(track, 1, 2)).toBe(false);
    expect(portalBranchShift(track, 0, 2)).toBe(true);
  });
  it('sin sangre portal apreciable en la puerta no hay reparto que juzgar', () => {
    expect(portalBranchShift(frames([0.9, 0.1, 0.9, 0.1, 0.9, 0.1], 0.005), 0, 1)).toBe(false);
    expect(portalBranchShift([], 0, 1)).toBe(false);
  });
});
