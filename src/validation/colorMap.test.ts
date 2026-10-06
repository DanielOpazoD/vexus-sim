import { describe, expect, it } from 'vitest';
import { colorMapRgb } from '../ultrasound/colorMap';

describe('mapa de velocidad rojo/azul', () => {
  it('mantiene rojo y azul distinguibles en toda la escala, sin extremo amarillo', () => {
    let previousRed = 0,
      previousBlue = 0;
    for (let i = 0; i <= 100; i++) {
      const red = colorMapRgb(true, i / 100),
        blue = colorMapRgb(false, i / 100);
      expect(red[0]).toBeGreaterThan(3 * red[1]);
      expect(red[0]).toBeGreaterThan(3 * red[2]);
      expect(blue[2]).toBeGreaterThan(3 * blue[0]);
      expect(blue[2]).toBeGreaterThan(3 * blue[1]);
      expect(red[0]).toBeGreaterThanOrEqual(previousRed);
      expect(blue[2]).toBeGreaterThanOrEqual(previousBlue);
      previousRed = red[0];
      previousBlue = blue[2];
    }
    expect(colorMapRgb(true, -1)).toEqual(colorMapRgb(true, 0));
    expect(colorMapRgb(false, 2)).toEqual(colorMapRgb(false, 1));
  });
});
