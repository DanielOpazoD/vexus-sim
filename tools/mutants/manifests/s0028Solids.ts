import type { MutantManifest } from '../manifest';

/**
 * Dueños independientes, grasa compatible D y bloque P3 de s0028 (P3, CPU).
 *
 * Equivalente documentado, fuera del manifiesto: `banda-desde-0mm` (`q.depthMm >= 1.5` → `>= 0` en la banda de pared).
 * `scene.ts` clasifica como piel todo punto con profundidad < 1,5 mm antes de llamar a `s0028Owners`, y `depthMm` es esa
 * misma profundidad: el mutante no cambia ningún resultado observable (revisión de #334).
 */
export const s0028Solids: MutantManifest = {
  module: 'src/anatomy/s0028Solids.ts',
  mutants: [
    {
      name: 'conflicto-por-precedencia',
      origin: 'P3 r2 (decisión 321); reanclado tras la cara renal de r3',
      breaks: 'Dos dueños se resuelven por el orden de la tabla (gana el primero) en vez de quedar en conflicto con todos conservados.',
      from: "  return { state: owners.length > 1 ? 'conflict' : owners.length ? 'known' : 'U', owners, kidneyMm };",
      to: "  return { state: owners.length ? 'known' : 'U', owners: owners.slice(0, 1), kidneyMm };",
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'grasa-sobre-mascara-fuente',
      origin: 'P3 r2 (decisión 321); reanclado tras la exclusión de vasos de r2c',
      breaks: 'La grasa compatible D reclama puntos que ya tienen una máscara fuente: comparte punto con un órgano.',
      from: "  if (!owners.some((o) => o.id !== 'wall') && s0028CompatibleFat(p) && !insideVessel(p))",
      to: '  if (s0028CompatibleFat(p) && !insideVessel(p))',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'hueso-contra-pared-como-choque',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'El hueso dentro de la banda de pared cuenta como segundo dueño (conflicto) en vez de contenido del complejo P2.',
      from: 'q.depthMm < q.interfaceMm && !skeleton)',
      to: 'q.depthMm < q.interfaceMm)',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'U-sin-duenos-como-conocido',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'Un punto sin ningún dueño se declara conocido en vez de U.',
      from: "owners.length > 1 ? 'conflict' : owners.length ? 'known' : 'U'",
      to: "owners.length > 1 ? 'conflict' : 'known'",
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'grasa-sin-verificar',
      origin: 'P3 r2 (decisión 321)',
      breaks: 'La carga acepta un bloque de grasa P3 con bytes no enteros, fuera de 0…255 o con relleno no nulo.',
      from: "    if (i < S.byteCount ? !(v >= 0 && v <= 255 && v === Math.floor(v)) : words[i] !== 0) throw new Error('Grasa P3 corrupta');\n",
      to: '',
      tests: ['src/validation/s0028SolidsPackage.test.ts'],
    },
    {
      name: 'grasa-solo-sin-dueno',
      origin: 'revisión adversarial de #331, r2c (decisión 321)',
      breaks: 'La grasa D sólo cuenta donde no hay ningún dueño: desaparece el conflicto grasa D + banda de pared conocida.',
      from: "!owners.some((o) => o.id !== 'wall') && s0028CompatibleFat(p)",
      to: '!owners.length && s0028CompatibleFat(p)',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'grasa-en-lamina-de-vasos',
      origin: 'revisión adversarial de #331, r2c (decisión 321)',
      breaks: 'La grasa compatible D reclama la lámina subvóxel de aorta, VCI y porta/esplénica (sale grasa dentro del vaso).',
      from: 's0028CompatibleFat(p) && !insideVessel(p)',
      to: 's0028CompatibleFat(p)',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'nearest-por-suelo',
      origin: 'revisión adversarial de #331, r2c (decisión 321)',
      breaks: 'La grasa lee el vóxel por suelo en vez del nearest: medio vóxel de desplazamiento en las mitades de celda.',
      from: '    const bit = (Math.round(x) * ny + Math.round(y)) * nz + Math.round(z);',
      to: '    const bit = (Math.floor(x) * ny + Math.floor(y)) * nz + Math.floor(z);',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'cajas-sin-OR',
      origin: 'revisión adversarial de #331, r2c (decisión 321)',
      breaks: 'Donde las dos cajas de grasa se solapan decide la primera que cubre el punto en vez del OR de ambas.',
      from: '    if ((HALF[fat[b.byteOffset + (bit >> 3)]] >> (bit & 7)) & 1) return true;',
      to: '    return ((HALF[fat[b.byteOffset + (bit >> 3)]] >> (bit & 7)) & 1) === 1;',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'certeza-pared-invertida',
      origin: 'revisión adversarial de #331, r2c (decisión 321)',
      breaks: 'La certeza de la pared se invierte: U hasta la cara externa conocida y D de ahí a la interfaz.',
      from: "certainty: q.depthMm < q.outerMm ? 'D' : 'U'",
      to: "certainty: q.depthMm < q.outerMm ? 'U' : 'D'",
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'hueso-duplicado',
      origin: 'revisión adversarial de #334 (decisión 322, punto 8)',
      breaks: 'Sin deduplicar el hueso, un punto en lumbosacro y sacro a la vez (432 muestras) tiene dos dueños óseos y sale conflicto.',
      from: "    if (owner !== 'bone' || !owners.some((o) => o.id === 'bone')) owners.push({ id: owner, d, certainty });",
      to: '    owners.push({ id: owner, d, certainty });',
      tests: ['src/validation/s0028SolidsClassify.test.ts'],
    },
    {
      name: 'fuera-de-cajas-false',
      origin: 'revisión adversarial de #334 (decisión 322, punto 8)',
      breaks: 'Fuera de las dos cajas de grasa la consulta responde «no es grasa» (false) en vez de «sin dato» (null).',
      from: '  return covered ? false : null;',
      to: '  return false;',
      tests: ['src/validation/s0028SolidsPackage.test.ts'],
    },
  ],
};
