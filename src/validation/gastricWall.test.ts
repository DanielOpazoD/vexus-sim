import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ABDOMINAL_FIELDS } from '../anatomy/abdominalAtlasData';
import { Interface } from '../anatomy/interfaces';
import { ABDOMEN_GLSL, GASTRIC_WALL, abdomenQuery, digestiveGasPlane, gastricBoundary, gastricFold } from '../anatomy/organs/abdomen';
import { TISSUES, Tissue } from '../anatomy/tissues';
import type { Vec3 } from '../core/vec3';
import { abdominalAtlasValue, setAbdominalAtlas } from './support/legacyPerson/abdominalAtlas';
import { fixturePerson } from './support/legacyPerson/state';

beforeAll(() => {
  const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
  setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
});
afterAll(() => setAbdominalAtlas());

/** Puntos del estómago del atlas: su distancia, su normal y su clasificación, los que no ocupa otro órgano. */
function stomachPoints(step: number): Array<{ p: Vec3; d: number; c: NonNullable<ReturnType<typeof abdomenQuery>> }> {
  const f = ABDOMINAL_FIELDS[1];
  const out = [];
  for (let z = 0; z < f.dimensions[2]; z += step)
    for (let y = 0; y < f.dimensions[1]; y += step)
      for (let x = 0; x < f.dimensions[0]; x += step) {
        // Fuera de la rejilla del atlas, donde las capas caen en cualquier parte del vóxel
        const p = f.originMm.map((v, i) => v + ([x, y, z][i] + 0.37) * f.pitchMm) as Vec3;
        const q = abdominalAtlasValue(p, 1);
        if (q.d >= 0 || q.label !== 1) continue;
        const c = abdomenQuery(p, fixturePerson().cpu);
        // otro órgano del atlas puede ocupar un vóxel de la superficie
        if (!c || ![Interface.BowelSerosa, Interface.BowelLumen].includes(c.interface)) continue;
        out.push({ p, d: q.d, c });
      }
  return out;
}

type Query = NonNullable<ReturnType<typeof abdomenQuery>>;
const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

describe('estómago con algo de líquido (decisión 310)', () => {
  it('la pared sigue el orden real, del contorno a la luz, y el grosor de los pliegues está entre sus límites', () => {
    const pts = stomachPoints(3);
    expect(pts.length).toBeGreaterThan(500);
    const counts = new Map<Tissue, number>();
    for (const { p, d, c } of pts) {
      const depth = -d;
      const { fold } = gastricFold(p);
      const wall = GASTRIC_WALL.baseMm + GASTRIC_WALL.foldMm * (0.5 + 0.5 * fold);
      counts.set(c.tissue, (counts.get(c.tissue) ?? 0) + 1);
      if (depth < GASTRIC_WALL.serosaMm) expect(c.tissue).toBe(Tissue.SoftCapsule);
      else if (depth < GASTRIC_WALL.muscularisMm) expect(c.tissue).toBe(Tissue.GutMuscularis);
      else if (depth < wall)
        expect(c.tissue).toBe(
          depth < GASTRIC_WALL.submucosaMm + GASTRIC_WALL.submucosaFoldMm * fold || wall - depth < GASTRIC_WALL.mucosalLineMm
            ? Tissue.GutSubmucosa
            : Tissue.Bowel,
        );
      else expect(c.tissue).toBe(digestiveGasPlane(p, 1, fixturePerson().cpu) > 0 ? Tissue.BowelGas : Tissue.GastricContents);
    }
    for (const t of [Tissue.GutMuscularis, Tissue.GutSubmucosa, Tissue.Bowel, Tissue.GastricContents])
      expect(counts.get(t) ?? 0).toBeGreaterThan(50);
    expect(GASTRIC_WALL.muscularisMm).toBeLessThan(GASTRIC_WALL.baseMm);
  });

  it('la pared no es exagerada: fina, con pliegues bajos y una submucosa continua, no lóbulos brillantes (decisión 312)', () => {
    const w = GASTRIC_WALL;
    expect(w.baseMm + w.foldMm).toBeLessThanOrEqual(6);
    expect(w.foldMm).toBeLessThanOrEqual(2);
    // En toda la vuelta queda línea de submucosa y queda mucosa bajo ella
    expect(w.submucosaMm - w.submucosaFoldMm).toBeGreaterThan(w.muscularisMm);
    expect(w.submucosaMm + w.submucosaFoldMm).toBeLessThan(w.baseMm - w.mucosalLineMm);
    const band = stomachPoints(3).filter(({ d }) => -d >= w.muscularisMm && -d < w.submucosaMm - w.submucosaFoldMm);
    expect(band.length).toBeGreaterThan(100);
    for (const { c } of band) expect(c.tissue).toBe(Tissue.GutSubmucosa);
  });

  it('el contenido no es una cavidad anecoica ni una masa: ecos puntuales y dispersos, y atenúa como el líquido', () => {
    const g = TISSUES[Tissue.GastricContents];
    // Ecos puntuales: pocos dispersores dominantes, mucho más que el colon; por debajo del hígado en potencia, por encima del líquido
    expect(g.speckleClump).toBeGreaterThan(TISSUES[Tissue.ColonicContents].speckleClump!);
    expect(g.backscatter).toBeGreaterThan(TISSUES[Tissue.Fluid].backscatter * 10);
    expect(g.backscatter).toBeLessThan(TISSUES[Tissue.Liver].backscatter / 2);
    // Sin sombra lisa hasta el fondo: una travesía de 30 mm a 3,5 MHz, ida y vuelta, queda bajo 10 dB
    expect(g.alpha1 * 3.5 ** g.b * 3 * 2).toBeLessThan(10);
  });

  it('moverse 0,95 × la frontera declarada no cambia de tejido en ninguna capa, tampoco en los testigos de las revisiones', () => {
    const dirs: Vec3[] = Array.from({ length: 16 }, (_, i) => {
      const z = 1 - (2 * (i + 0.5)) / 16;
      const r = Math.sqrt(1 - z * z);
      const a = i * 2.399963229728653;
      return [r * Math.cos(a), r * Math.sin(a), z];
    });
    const moved = (p: Vec3, d: Vec3, s: number) => abdomenQuery([p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s], fixturePerson().cpu);
    // Otro órgano del atlas puede quedar a menos de la frontera del estómago: esa cara no es de esta pared
    const changed = (c: Query, after: Query | null) =>
      after !== null && after.interface === Interface.BowelSerosa && after.tissue !== c.tissue;
    const check = (p: Vec3, c: Query) => dirs.filter((d) => changed(c, moved(p, d, 0.95 * c.boundaryDistance))).length;
    // Revisiones de Sol: la fase del pliegue saltaba de capa dentro de la frontera declarada
    for (const p of [
      [21, 54, -117],
      [36, 54, -117],
    ] as Vec3[])
      expect(check(p, abdomenQuery(p, fixturePerson().cpu)!)).toBe(0);
    const witness: Vec3 = [13.5, 39, -117];
    const c = abdomenQuery(witness, fixturePerson().cpu)!;
    expect(changed(c, moved(witness, [-0.429857439, 0.393784626, 0.8125], 0.95 * c.boundaryDistance))).toBe(false);
    // Revisión de Sol: junto al eje la fase se acelera, y la frontera debe encogerse con ella
    const nearAxis: Vec3 = [40.8481, 45.472, -116];
    expect(check(nearAxis, abdomenQuery(nearAxis, fixturePerson().cpu)!)).toBe(0);
    for (const rho of [0.0001, 0.001, 0.01, 0.1])
      for (let i = 0; i < 32; i++) {
        const a = (i * Math.PI) / 16;
        const m: Vec3 = [
          GASTRIC_WALL.axisMm[0] + GASTRIC_WALL.axisPerMm[0] * -116 + rho * Math.cos(a),
          GASTRIC_WALL.axisMm[1] + GASTRIC_WALL.axisPerMm[1] * -116 + rho * Math.sin(a),
          -116,
        ];
        const q = abdomenQuery(m, fixturePerson().cpu);
        if (q) expect(check(m, q), `ρ ${rho}, ángulo ${i}`).toBe(0);
      }
    let trials = 0;
    let band = 0;
    let changes = 0;
    for (const { p, d, c } of stomachPoints(5)) {
      trials += dirs.length;
      if (-d >= GASTRIC_WALL.muscularisMm && -d < GASTRIC_WALL.baseMm + GASTRIC_WALL.foldMm) band += dirs.length;
      changes += check(p, c);
    }
    expect(trials).toBeGreaterThan(2000);
    expect(band).toBeGreaterThan(2000);
    expect(changes).toBe(0);
  });

  it('el pliegue no depende de la dirección del gradiente del atlas y su frontera es útil: la franja no se declara casi cero', () => {
    const bands = stomachPoints(5).filter(
      ({ d, c }) => -d >= GASTRIC_WALL.muscularisMm && -d < GASTRIC_WALL.baseMm && c.tissue !== Tissue.GastricContents,
    );
    expect(bands.length).toBeGreaterThan(100);
    // Decisión 332 (evolución): la cota absoluta 0,1 mm era la de las capas de la 312; con la muscular de 1,6 mm la franja tiene capas
    // más finas y la frontera ideal baja (mediana 0,145 → 0,114 mm). Lo que se fija es lo que la cota del pliegue le quita: frente a
    // la frontera sin pliegue (rate 0), la declarada conserva ≥ 75 % (0,836 en main, 0,855 aquí; con phaseRate ×4, 0,62)
    const ideal = bands.map(({ p, d }) => {
      const { fold } = gastricFold(p);
      return gastricBoundary(-d, d + GASTRIC_WALL.baseMm + GASTRIC_WALL.foldMm * (0.5 + 0.5 * fold), fold, 0, 1e3);
    });
    expect(median(bands.map(({ c }) => c.boundaryDistance)) / median(ideal)).toBeGreaterThan(0.75);
    // La fase varía a lo más a su ritmo declarado: la cota de la que sale la frontera
    for (const { p } of bands) {
      const { fold, rate } = gastricFold(p);
      for (const d of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as Vec3[]) {
        const h = 0.01;
        const slope = Math.abs(gastricFold([p[0] + d[0] * h, p[1] + d[1] * h, p[2] + d[2] * h]).fold - fold) / h;
        expect(slope).toBeLessThanOrEqual(rate * 1.1);
      }
    }
  });

  // Decisión 331 (evolución del contrato de la 310: «solo la serosa da eco»). Su defecto: con pliegues de 2 mm la luz no era
  // lisa y la normal del contorno no servía; con el estómago distendido (pliegues de 0,5 mm) la mucosa contra la luz es la
  // primera capa brillante de la firma digestiva, y sin ella la pared no se veía. Se conserva el negativo: la mitad de fuera
  // de la pared sigue siendo de la serosa, y la de la luz es de la mucosa, como en el resto del tubo.
  it('la serosa da la cara de fuera y la mucosa lisa, la de la luz, con la normal del contorno', () => {
    let serosa = 0,
      lumen = 0;
    for (const { p, d, c } of stomachPoints(5)) {
      const { fold } = gastricFold(p);
      const inner = d + GASTRIC_WALL.baseMm + GASTRIC_WALL.foldMm * (0.5 + 0.5 * fold);
      expect(c.interface).toBe(Math.abs(d) < Math.abs(inner) ? Interface.BowelSerosa : Interface.BowelLumen);
      if (c.interface === Interface.BowelSerosa) serosa++;
      else lumen++;
    }
    expect(serosa).toBeGreaterThan(100);
    expect(lumen).toBeGreaterThan(100);
    expect(ABDOMEN_GLSL).toContain('c.iface=abs(d)<abs(inner)?IF_BOWEL_SEROSA:IF_BOWEL_LUMEN');
    expect(ABDOMEN_GLSL).not.toContain('stomach||abs(d)<abs(inner)');
  });

  it('estómago distendido (decisión 331): la luz es lisa, sin contorno «en coliflor»', () => {
    // Grosor medido: desde la serosa, hacia dentro por la normal del contorno, hasta el contenido (o el gas)
    const thickness: number[] = [];
    for (const { p, d, c } of stomachPoints(2)) {
      if (-d > 0.3) continue;
      const n = c.boundaryNormal;
      let s = 0;
      for (; s < 12; s += 0.05) {
        const q = abdomenQuery([p[0] - n[0] * s, p[1] - n[1] * s, p[2] - n[2] * s], fixturePerson().cpu);
        if (q && (q.tissue === Tissue.GastricContents || q.tissue === Tissue.BowelGas)) break;
      }
      // fuera de los rincones donde la normal sale de la pared (curvatura alta, junto a otro órgano)
      if (s < 12) thickness.push(s - d);
    }
    expect(thickness.length).toBeGreaterThan(200);
    const sorted = [...thickness].sort((a, b) => a - b),
      q = (f: number) => sorted[Math.floor(f * (sorted.length - 1))];
    // Recorrido p10–p90 del grosor: 2,54 mm con los pliegues de 2 mm de la 312, 1,40 con 0,5 mm y 1,30 sin pliegues (el suelo
    // de la medida: la normal del atlas no es la de la pared en toda la vuelta). La cota separa pliegues de más de ~1 mm
    expect(q(0.9) - q(0.1), JSON.stringify({ p10: q(0.1), p50: q(0.5), p90: q(0.9) })).toBeLessThan(1.8);
  });

  it('la GLSL usa las mismas capas y el mismo pliegue', () => {
    const w = GASTRIC_WALL;
    expect(ABDOMEN_GLSL).toContain(`cos(${w.folds.toFixed(1)}*atan(a.y,a.x)+${w.twistPerMm.toFixed(3)}*m.z)`);
    expect(ABDOMEN_GLSL).not.toContain('atan(c.n.y,c.n.x)');
    expect(ABDOMEN_GLSL).toContain(`${w.baseMm.toFixed(1)}+${w.foldMm.toFixed(1)}*(0.5+0.5*fold)`);
    expect(ABDOMEN_GLSL).toContain(
      `depth<${w.submucosaMm.toFixed(2)}+${w.submucosaFoldMm.toFixed(2)}*fold||inner<${w.mucosalLineMm.toFixed(2)}?T_GUT_SUBMUCOSA:T_BOWEL`,
    );
    expect(ABDOMEN_GLSL).toContain(`depth<${w.serosaMm.toFixed(2)}?T_SOFT_CAPSULE:depth<${w.muscularisMm.toFixed(2)}?T_GUT_MUSCULARIS`);
    expect(ABDOMEN_GLSL).toContain('T_GASTRIC_CONTENTS');
    // Decisión 332: eje, pliegue y grosor total van como literales en la GLSL (los comparten las dos personas); los ata esta prueba
    const axis = `vec2(${w.axisMm.map((v) => v.toFixed(1)).join(',')})-vec2(${w.axisPerMm.map((v) => v.toFixed(3)).join(',')})*m.z`;
    expect(ABDOMEN_GLSL).toContain(axis);
    expect(ABDOMEN_GLSL).toContain(`rate=${w.phaseRate.toFixed(1)}/max(length(a),0.000001)+${w.twistPerMm.toFixed(3)};`);
    expect(ABDOMEN_GLSL).toContain(`abs(inner)/(1.0+${(0.5 * w.foldMm).toFixed(2)}*rate),depth-${(w.baseMm + w.foldMm).toFixed(2)})`);
    expect(ABDOMEN_GLSL).toContain(`abs(inner-${w.mucosalLineMm.toFixed(2)})/(1.0+${(0.5 * w.foldMm).toFixed(2)}*rate)`);
  });
});
