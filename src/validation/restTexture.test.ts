import { describe, expect, it } from 'vitest';
import { REST_TEXTURE, REST_TEXTURE_GLSL, bowelWallProfile, restTexture } from '../ultrasound/restTexture';
import { BOWEL_WALL_MM } from '../anatomy/organs/bowel';

describe('pared intestinal ligada a la geometría, no al ruido', () => {
  it('muscular y mucosa hipoecoicas, submucosa ecogénica; todas dentro de la pared física', () => {
    expect(bowelWallProfile(0.3)).toBe(REST_TEXTURE.muscularisBack);
    expect(bowelWallProfile(0.875)).toBe(REST_TEXTURE.submucosaBack);
    expect(bowelWallProfile(1.6)).toBeCloseTo(REST_TEXTURE.mucosaBack, 12);
    expect(REST_TEXTURE.submucosaEndMm + REST_TEXTURE.edgeMm).toBeLessThan(BOWEL_WALL_MM);
    for (let d = 0; d <= BOWEL_WALL_MM; d += 0.01) {
      expect(bowelWallProfile(d)).toBeGreaterThanOrEqual(0.38);
      expect(bowelWallProfile(d)).toBeLessThanOrEqual(2.2);
    }
  });
  it('usa la distancia real del eje continuo y conserva exactamente la misma anatomía entre repeticiones', () => {
    for (const d of [0.3, 0.875, 1.6]) expect(restTexture([-38 - d, 22, -250])).toBeCloseTo(bowelWallProfile(d), 8);
  });
  it('el shader comparte parámetros y no genera asas con uSeed ni valueNoise', () => {
    expect(REST_TEXTURE_GLSL).toContain('bowelWallProfile(-bowelSdf(m))');
    expect(REST_TEXTURE_GLSL).not.toMatch(/uSeed|valueNoise/);
    expect(REST_TEXTURE_GLSL).toContain(REST_TEXTURE.submucosaBack.toFixed(3));
  });
});
