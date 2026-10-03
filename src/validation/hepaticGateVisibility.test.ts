import { describe, expect, it } from 'vitest';
import { hepaticGateDropout, type GateVesselSample } from '../doppler/vesselIdentity';
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
