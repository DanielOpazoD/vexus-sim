import { describe, expect, it } from 'vitest';
import { WALL, WALL_GLSL, wallDepths, wallRegion } from '../anatomy/organs/wall';
import { CASES, NORMAL_ADULT } from '../cases';
import { AnatomyScene } from './support/legacyPerson/scene';

/**
 * Línea alba de la pared default (decisión 326). Hasta la 324 la pared era la misma en todas partes: estas pruebas fallan
 * con un reparto uniforme (la línea media y el recto tenían las mismas profundidades).
 */
describe('línea alba de la pared (decisión 326)', () => {
  const t = new AnatomyScene(NORMAL_ADULT).torso;
  const at = (u: number, z: number) => wallDepths(t, u, z);

  it('línea alba: entre el recto de cada lado, una banda fibrosa con la grasa preperitoneal debajo', () => {
    const mid = at(0, -60);
    const rectus = at(40, -60);
    // las vainas casi se tocan en la línea media; en el recto las separa el músculo
    expect(mid.transversalis - mid.fascia).toBeLessThan(3);
    expect(rectus.transversalis - rectus.fascia).toBeGreaterThan(7);
    // la grasa preperitoneal de la línea media triplica la que queda bajo el recto
    expect(mid.peritoneum - mid.transversalis).toBeGreaterThan(3 * (rectus.peritoneum - rectus.transversalis));
  });

  it('fuera de la línea media, el reparto del hábito (la variación por flanco, tórax y espalda se retiró)', () => {
    for (const u of [-400, -150, -28, 28, 40, 150, 400]) {
      const [fat, muscle, mid] = wallRegion(t, u);
      expect(mid, `${u}`).toBe(0);
      expect(fat, `${u}`).toBe(t.fatMm);
      expect(muscle, `${u}`).toBeCloseTo(t.muscleMm - t.preperitonealMm, 12);
    }
  });

  it('el total no cambia y las capas no se cruzan, en todos los casos', () => {
    for (const c of CASES) {
      const tc = new AnatomyScene(c).torso;
      for (let u = -60; u <= 60; u += 1)
        for (let z = -200; z <= 80; z += 10) {
          const w = wallDepths(tc, u, z);
          expect(w.peritoneum, `${c.id} ${u} ${z}`).toBe(tc.skinMm + tc.fatMm + tc.muscleMm);
          expect(w.scarpa, `${c.id} ${u} ${z}`).toBeLessThan(w.fascia);
          expect(w.transversalis - w.fascia, `${c.id} ${u} ${z}`).toBeGreaterThan(1);
          expect(w.peritoneum - w.transversalis, `${c.id} ${u} ${z}`).toBeGreaterThan(1.5);
        }
    }
  });

  it('es continuo al mover la sonda: ninguna capa salta entre muestras a 0,5 mm', () => {
    for (let u = -60; u <= 60; u += 0.5) {
      const a = wallRegion(t, u);
      const b = wallRegion(t, u + 0.5);
      for (let k = 0; k < 2; k++) expect(Math.abs(a[k] - b[k]), `${u}`).toBeLessThan(0.5);
    }
  });

  it('la GLSL escribe los mismos números que WALL.region', () => {
    const body = WALL_GLSL.slice(WALL_GLSL.indexOf('vec3 wallRegion('), WALL_GLSL.indexOf('vec4 wallDepths('));
    const R = WALL.region;
    const g = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
    for (const v of [...R.lineaMm, R.lineaAlbaMm, R.fatMidline])
      expect(body, `${v}`).toMatch(new RegExp(`[^0-9.]${g(v).replace('.', '\\.')}[^0-9]`));
  });
});
