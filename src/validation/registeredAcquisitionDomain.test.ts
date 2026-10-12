import { afterEach, expect, it, vi } from 'vitest';
import { acquiredState } from '../../tools/fidelity/registeredAcquisition';

afterEach(() => vi.unstubAllGlobals());

for (const [atlas, profile, expected] of [
  [false, false, 'procedural'],
  [false, true, 'bodyparts3d-profile'],
  [true, true, 'abdominal-atlas'],
] as const)
  it(`conserva el dominio anatómico de la adquisición: ${expected}`, () => {
    const frame = { t: 2, color: { enabled: false }, anatomy: { sample: { t: 2 }, seed: 73 } };
    vi.stubGlobal('window', {
      __vexusTest: {
        sim: () => ({
          frozen: true,
          patient: { id: 'synthetic', seed: 73 },
          scene: { hasAbdominalAtlas: atlas, torso: { profile: profile ? new Float32Array([1]) : undefined } },
          renderer: { displayedFrame: frame, readDisplay: () => ({ width: 1, height: 1, gray: new Uint8Array([128]) }) },
          physiology: { clock: { step: 50, dt: 0.04 } },
          sample: { t: 2 },
        }),
        loggedErrors: () => [],
      },
    });
    expect(acquiredState().anatomyDomain).toBe(expected);
  });
