import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/vec3';
import { sinusLobules } from '../ultrasound/retroTexture';

// Rejilla aleatorizada fija en el material, sin depender de la sonda, la ventana o el paciente.
let seed = 514;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};
const points: Vec3[] = Array.from({ length: 12000 }, () => [random() * 300 - 150, random() * 300 - 150, random() * 300 - 150]);
const values = points.map(sinusLobules);
function correlation(axis: number, lagMm: number): number {
  const shifted = points.map((p) => sinusLobules(p.map((v, i) => v + (i === axis ? lagMm : 0)) as Vec3));
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const a = mean(values),
    b = mean(shifted);
  return (
    values.reduce((s, v, i) => s + (v - a) * (shifted[i] - b), 0) /
    Math.sqrt(values.reduce((s, v) => s + (v - a) ** 2, 0) * shifted.reduce((s, v) => s + (v - b) ** 2, 0))
  );
}

describe('escala material del seno renal, contrato 215', () => {
  it.fails('pierde la correlación de los grumos gruesos antes de 1,5 mm en los tres ejes', () => {
    // Límite de diseño QA, no medida poblacional: rechaza la correlación ~0,65 del
    // campo de 3 mm observado como islas gruesas. Objetivo: <0,4 sin filtrar la imagen.
    for (const axis of [0, 1, 2]) expect(correlation(axis, 1.5), `eje ${axis}`).toBeLessThan(0.4);
  });
  it('conserva el medio al deslizar 50 micras: la textura fina sigue anclada', () => {
    // Se descarta resolver el defecto con ruido independiente por muestra/cuadro.
    for (const axis of [0, 1, 2]) expect(correlation(axis, 0.05), `eje ${axis}`).toBeGreaterThan(0.99);
  });
});
