import { describe, expect, it } from 'vitest';
import { personShader } from '../anatomy/gpu/personShader';
import { gastricGlsl, gastricWallTissue, GASTRIC_WALL } from '../anatomy/organs/abdomen';
import { GASTRIC_312 } from '../anatomy/people/s0028/cpu';
import { S0028_BUNDLE } from '../anatomy/people/s0028/descriptor';
import { Tissue, TISSUES } from '../anatomy/tissues';
import { FRAG_RAWFIELD } from '../ultrasound/shaders/passes.glsl';
import { strongScatter } from '../ultrasound/speckleField';

const db = (amplitude: number) => 20 * Math.log10(amplitude / TISSUES[Tissue.Liver].backscatter);

// Decisión 332: que el estómago de la epigástrica se lea como víscera hueca. Las cifras del modo B (perfil medio de 18 líneas
// alineadas en la serosa, Metal) están en el informe externo `default-stomach-20261107`; aquí, los contratos que las producen.
describe('estómago por defecto como víscera hueca (decisión 332)', () => {
  it('la muscular propia es la capa más gruesa y la submucosa queda como línea', () => {
    const w = GASTRIC_WALL;
    const muscularis = w.muscularisMm - w.serosaMm;
    // El corte de la epigástrica va a ~45° de la pared en elevación: con un grosor de corte de σ ≈ 1,6 mm, los planos laterales
    // caen ~1,15 mm más dentro o más fuera de la pared. Con 0,8 mm la muscular no llegaba oscura (−3,3 dB); con 1,6 mm, −5,6 dB
    expect(muscularis).toBeGreaterThanOrEqual(1.4);
    // Submucosa ecogénica de 0,7–1,3 mm (pliegue incluido), más fina que la muscular: la firma de capas de la pared gástrica
    expect(w.submucosaMm + w.submucosaFoldMm - w.muscularisMm).toBeLessThan(muscularis);
    expect(w.submucosaMm - w.submucosaFoldMm - w.muscularisMm).toBeGreaterThan(0.5);
    // Cinco capas por la normal, sin pliegue: serosa, muscular, submucosa, mucosa, línea mucosa
    const at = (depth: number) => gastricWallTissue(depth, 0, w.baseMm + 0.25 - depth);
    expect([0.2, 1.2, 2.5, 3.2, 4.0].map(at)).toEqual([
      Tissue.SoftCapsule,
      Tissue.GutMuscularis,
      Tissue.GutSubmucosa,
      Tissue.Bowel,
      Tissue.GutSubmucosa,
    ]);
  });

  it('el contenido es líquido con ecos puntuales y dispersos, no un tapiz de grumos', () => {
    const [fraction, strong, level] = strongScatter(Tissue.GastricContents);
    const back = TISSUES[Tissue.GastricContents].backscatter;
    // Fondo de líquido: ≤ −30 dB frente al hígado (la luz medía −17 dB y gris 46 de 101: una masa hipoecoica)
    expect(db(back * level)).toBeLessThanOrEqual(-30);
    // Ecos puntuales: pocos nodos (≤ 1 %), cada uno al menos tan fuerte como un dispersor del hígado
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThanOrEqual(0.01);
    expect(db(back * strong)).toBeGreaterThanOrEqual(0);
    // Atenúa como antes: sin sombra lisa hasta el fondo (decisión 310)
    expect(TISSUES[Tissue.GastricContents].alpha1).toBe(0.3);
  });

  it('s0028 conserva las capas de la 312 y su contenido sin dispersores fuertes', () => {
    expect([GASTRIC_312.muscularisMm, GASTRIC_312.submucosaMm, GASTRIC_312.submucosaFoldMm]).toEqual([1.2, 2.8, 0.4]);
    const source = FRAG_RAWFIELD;
    expect(source).toContain(gastricGlsl(GASTRIC_WALL));
    expect(source).toMatch(/if \(t == T_GASTRIC_CONTENTS\) return/);
    const s0028 = personShader(source, { person: 's0028', bundle: S0028_BUNDLE });
    expect(s0028).toContain(gastricGlsl(GASTRIC_312));
    expect(s0028).not.toContain(gastricGlsl(GASTRIC_WALL));
    expect(s0028).not.toMatch(/T_GASTRIC_CONTENTS\) return/);
  });
});
