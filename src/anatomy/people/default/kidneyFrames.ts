import type { Vec3 } from '../../../core/vec3';

/**
 * Marcos de los dos riñones del atlas por defecto (0 derecho, 1 izquierdo), movidos con su campo (decisiones 329 y 330), y
 * el marco fuente de cada uno, el del atlas antes de moverlo. Los genera `tools/anatomy/move-kidneys.ts`: no se editan a mano.
 */
export const KIDNEY_FRAMES: readonly {
  center: Vec3;
  long: Vec3;
  hilumHint: Vec3;
  source: { center: Vec3; long: Vec3; hilumHint: Vec3 };
}[] = [
  {
    center: [-57.1862655, -44.3988, -125.5475],
    long: [0.26900368, -0.39174398, 0.87987139],
    hilumHint: [0.94300102, 0.2929612, -0.15786961],
    source: { center: [-58.6862655, -32.3988, -145.5475], long: [0.00120157, -0.14708338, 0.98912337], hilumHint: [1, 0.25, 0] },
  },
  {
    center: [57.9266845, -42.78815, -108.1065],
    long: [-0.25514482, -0.16790092, 0.95221342],
    hilumHint: [-0.93949027, 0.27588518, -0.20308966],
    source: { center: [61.9266845, -40.78815, -127.1065], long: [-0.08034499, -0.15237369, 0.98505175], hilumHint: [-1, 0.25, 0] },
  },
];
