import type { Vec3 } from '../../core/vec3';
import { ABDOMINAL_ATLAS_GLSL } from '../abdominalAtlas';
import { EMPTY_ATLAS } from '../emptyAtlas';
import { Interface } from '../interfaces';
import type { AnatomyPerson } from '../person';
import { Tissue } from '../tissues';

/** Lado TS de un par TS/GLSL (`tools/twins/registry.ts`). @twin organo-abdomen */
export function digestiveWallMm(label: number, person?: AnatomyPerson): number {
  return person ? person.digestiveWallMm(label) : label === 1 ? 3 : label >= 5 ? 2.5 : 2;
}
/** Five sonographic strata, outer serosa -> inner mucosal interface; estimated resting widths. */
export function digestiveWallTissue(fraction: number): Tissue {
  return fraction < 0.12
    ? Tissue.SoftCapsule
    : fraction < 0.42
      ? Tissue.GutMuscularis
      : fraction < 0.68
        ? Tissue.GutSubmucosa
        : fraction < 0.93
          ? Tissue.Bowel
          : Tissue.GutSubmucosa;
}
/** Static nondependent gas patches, clipped by the SAME lumen, with no assigned flow. */
export function digestiveGasPlane(m: Vec3, label: number, person?: AnatomyPerson): number {
  if (person) return person.digestiveGas(m, label);
  return m[1] - (label === 1 ? 30 : 18) - 7 * Math.sin(m[2] / 17) * Math.cos(m[0] / 21);
}
/**
 * Estómago con algo de líquido (decisión 310): la luz de BodyParts3D es la de un estómago lleno, 45 mm en la transversa epigástrica, y un círculo negro con refuerzo posterior parece un
 * quiste. Se conserva el contorno y crece la pared hacia dentro: serosa, muscular hipoecoica, submucosa ecogénica continua y mucosa hipoecoica, con pliegues (rugae) bajos: la firma de capas del tubo digestivo. No es
 * un antro contraído en ayunas: ese estado pediría otra geometría (ASRA 2019; Van de Putte y Perlas 2014). Grosores y número de pliegues: [EXTRAPOLACIÓN PROPIA].
 */
export const GASTRIC_WALL = {
  baseMm: 4,
  /** Decisión 331: un estómago distendido borra sus pliegues; con 2 mm la luz salía «en coliflor» en la transversa epigástrica */
  foldMm: 0.5,
  folds: 10,
  twistPerMm: 0.035,
  serosaMm: 0.4,
  /**
   * Decisión 332: la muscular propia es la capa más gruesa de la pared gástrica (1,6 mm, de 0,4 a 2 mm) y la submucosa, más fina
   * (0,7–1,3 mm). Con 0,8 mm de muscular, el corte de la epigástrica, a 45° de la pared en elevación, la mezclaba con sus vecinas
   * en el grosor de corte y no se veía oscura (−3,3 dB frente al tejido de delante; ahora −5,6)
   */
  muscularisMm: 2,
  /** Fin de la submucosa, 3 ± 0,3 mm: sube y baja con el pliegue, sin romper su línea */
  submucosaMm: 3,
  submucosaFoldMm: 0.3,
  /** Línea brillante de la mucosa contra la luz: la quinta capa de la firma del tubo digestivo */
  mucosalLineMm: 0.6,
  /** Eje largo del estómago, ajuste lineal a su malla: x e y en z = 0 y por mm de z */
  axisMm: [72.4, -11.6],
  axisPerMm: [0.272, -0.492],
  /** 2·folds·√(1 + |axisPerMm|²), que multiplica a 1/ρ: el doble de la cota puntual, porque esta debe valer en todo el camino hasta la frontera, y la fase se acelera al acercarse al eje */
  phaseRate: 23,
};
export type GastricWall = typeof GASTRIC_WALL;

/**
 * Fase del pliegue en m: 1 en su cresta. Da la vuelta alrededor del eje largo del estómago, con un leve giro a lo largo de él. Sale de la posición y no del gradiente del atlas: la dirección
 * del gradiente filtrado difiere entre CPU y GPU, y ×8 cambia de capa. `rate` acota su variación por mm.
 */
export function gastricFold(m: Vec3): { fold: number; rate: number } {
  const w = GASTRIC_WALL;
  const x = m[0] - w.axisMm[0] - w.axisPerMm[0] * m[2],
    y = m[1] - w.axisMm[1] - w.axisPerMm[1] * m[2];
  return {
    fold: Math.cos(w.folds * Math.atan2(y, x) + w.twistPerMm * m[2]),
    rate: w.phaseRate / Math.max(Math.hypot(x, y), 1e-6) + w.twistPerMm,
  };
}

export function gastricWallTissue(depthMm: number, fold: number, inner: number, w = GASTRIC_WALL): Tissue {
  return depthMm < w.serosaMm
    ? Tissue.SoftCapsule
    : depthMm < w.muscularisMm
      ? Tissue.GutMuscularis
      : depthMm < w.submucosaMm + w.submucosaFoldMm * fold
        ? Tissue.GutSubmucosa
        : inner < w.mucosalLineMm
          ? Tissue.GutSubmucosa
          : Tissue.Bowel;
}

/** Distancia a la frontera dentro del estómago, `depth` bajo el contorno, `inner` sobre la luz. La distancia es 1-lipschitziana y el pliegue varía a lo más a `rate` por mm. */
export function gastricBoundary(depth: number, inner: number, fold: number, rate: number, gasMm: number, w = GASTRIC_WALL): number {
  if (depth < w.muscularisMm) return Math.min(depth, Math.abs(depth - w.serosaMm), w.muscularisMm - depth) / 2;
  const toInner = Math.max(Math.abs(inner) / (1 + 0.5 * w.foldMm * rate), depth - w.baseMm - w.foldMm);
  if (inner < 0) return Math.min(toInner, gasMm) / 2;
  const toMucosa = Math.abs(depth - w.submucosaMm - w.submucosaFoldMm * fold) / (1 + w.submucosaFoldMm * rate);
  const toLine = Math.abs(inner - w.mucosalLineMm) / (1 + 0.5 * w.foldMm * rate);
  return Math.min(toInner, depth - w.muscularisMm, toMucosa, toLine) / 2;
}

export function abdomenQuery(m: Vec3, person?: AnatomyPerson) {
  let field = -1,
    d = 16,
    label = 0;
  for (let k = 0; k < 4; k++) {
    const q = (person?.atlas ?? EMPTY_ATLAS).abdominalAtlasValue(m, k);
    if (q.d < d) {
      field = k;
      d = q.d;
      label = q.label;
    }
  }
  if (field < 0 || d >= 0) return null;
  const n = (person?.atlas ?? EMPTY_ATLAS).abdominalAtlasGradient(m, field);
  if (field === 0 || field === 3)
    return {
      tissue: -d < 0.35 ? Tissue.SoftCapsule : field === 0 ? Tissue.Pancreas : Tissue.Spleen,
      boundaryDistance: Math.min(-d, Math.abs(d + 0.35)) / 2,
      interface: field === 0 ? Interface.PancreasCapsule : Interface.SpleenCapsule,
      interfaceDistance: -d,
      boundaryNormal: n,
      curvature: 0,
    };
  const stomach = field === 1 && label === 1,
    layers = person?.gastricWall;
  const { fold, rate } = stomach ? gastricFold(m) : { fold: 0, rate: 0 };
  const wall =
      field === 2 ? 2.5 : stomach ? GASTRIC_WALL.baseMm + GASTRIC_WALL.foldMm * (0.5 + 0.5 * fold) : digestiveWallMm(label, person),
    inner = d + wall;
  if (field === 2)
    return {
      tissue: inner < 0 ? Tissue.Fluid : Tissue.BladderWall,
      boundaryDistance: Math.min(-d, Math.abs(inner)) / 2,
      interface: Interface.BladderLumen,
      interfaceDistance: Math.abs(inner),
      boundaryNormal: n,
      curvature: 0,
    };
  // Source labels 5–9 are cecum/colon/rectum. Their non-gaseous contents are
  // an estimated particulate suspension; source geometry and gas placement stay fixed.
  const gas = inner < 0 && digestiveGasPlane(m, label, person) > 0;
  // Decisión 331: con los pliegues borrados (0,5 mm) la mucosa contra la luz es lisa y da su eco de interfaz, la primera capa
  // brillante de la firma digestiva, como en el resto del tubo (antes, con 2 mm, solo la serosa)
  const iface = Math.abs(d) < Math.abs(inner) ? Interface.BowelSerosa : Interface.BowelLumen;
  return {
    tissue:
      inner >= 0
        ? stomach
          ? gastricWallTissue(-d, fold, inner, layers)
          : digestiveWallTissue(-d / wall)
        : gas
          ? Tissue.BowelGas
          : stomach
            ? Tissue.GastricContents
            : (person ? person.isColon(label) : label >= 5 && label <= 9)
              ? Tissue.ColonicContents
              : Tissue.Fluid,
    boundaryDistance: stomach
      ? gastricBoundary(-d, inner, fold, rate, inner < 0 ? Math.abs(digestiveGasPlane(m, label, person)) / 2 : 1e3, layers)
      : Math.min(-d, Math.abs(inner), inner < 0 ? Math.abs(digestiveGasPlane(m, label, person)) / 2 : wall * 0.03) / 2,
    interface: iface,
    interfaceDistance: Math.abs(iface === Interface.BowelSerosa ? d : inner),
    boundaryNormal: n,
    curvature: 0,
  };
}
/**
 * GLSL de las capas del estómago con las medidas `w` (decisión 332): la fuente lleva las de la persona por defecto y `personShader`
 * cambia este mismo texto por el de s0028, que conserva las de la decisión 312. Pliegue y grosor total, comunes, van como literales
 * (`gastricWall.test.ts` los ata a `GASTRIC_WALL`).
 */
export function gastricGlsl(w: GastricWall): string {
  const [s, m, sub, f, line] = [w.serosaMm, w.muscularisMm, w.submucosaMm, w.submucosaFoldMm, w.mucosalLineMm].map((v) => v.toFixed(2));
  return /* glsl */ `int gastricWallTissue(float depth,float fold,float inner){return depth<${s}?T_SOFT_CAPSULE:depth<${m}?T_GUT_MUSCULARIS:depth<${sub}+${f}*fold||inner<${line}?T_GUT_SUBMUCOSA:T_BOWEL;}
float gastricBoundary(float depth,float inner,float fold,float rate,float gas){
  if(depth<${m})return min(min(depth,abs(depth-${s})),${m}-depth)/2.0;
  float toInner=max(abs(inner)/(1.0+0.25*rate),depth-4.50);
  if(inner<0.0)return min(toInner,gas)/2.0;
  return min(min(min(toInner,depth-${m}),abs(depth-${sub}-${f}*fold)/(1.0+${f}*rate)),abs(inner-${line})/(1.0+0.25*rate))/2.0;
}`;
}
/** GLSL de las funciones del abdomen (mismos nombres, decisión 46). @twin organo-abdomen */
export const ABDOMEN_GLSL = /* glsl */ `
${ABDOMINAL_ATLAS_GLSL}
// Shared acoustic layers and static nondependent gas. No assigned flow in a hollow organ.
float digestiveWallMm(float label){return label==1.0?3.0:label>=5.0?2.5:2.0; }
int digestiveWallTissue(float fraction){return fraction<0.12?T_SOFT_CAPSULE:fraction<0.42?T_GUT_MUSCULARIS:fraction<0.68?T_GUT_SUBMUCOSA:fraction<0.93?T_BOWEL:T_GUT_SUBMUCOSA; }
${gastricGlsl(GASTRIC_WALL)}
float digestiveGasPlane(vec3 m,float label){return m.y-(label==1.0?30.0:18.0)-7.0*sin(m.z/17.0)*cos(m.x/21.0); }
bool abdomenQuery(vec3 m,inout Cls c){
  if(uAbdominalAtlasEnabled==0)return false; 
  int field=-1; float d=16.0,label=0.0; 
  for(int k=0; k<4; k++){vec2 q=abdominalAtlasValue(m,k); if(q.x<d){field=k; d=q.x; label=q.y; }}
  if(field<0||d>=0.0)return false; 
  c.n=abdominalAtlasGradient(m,field); c.kc=0.0; 
  if(field==0||field==3){
    c.tissue=-d<0.35?T_SOFT_CAPSULE:field==0?T_PANCREAS:T_SPLEEN; 
    c.bd=min(-d,abs(d+0.35))/2.0; c.iface=field==0?IF_PANCREAS_CAPSULE:IF_SPLEEN_CAPSULE; c.ifd=-d; return true; 
  }
  bool stomach=field==1&&label==1.0;
  vec2 a=m.xy-vec2(72.4,-11.6)-vec2(0.272,-0.492)*m.z;
  float fold=stomach?cos(10.0*atan(a.y,a.x)+0.035*m.z):0.0,rate=23.0/max(length(a),0.000001)+0.035;
  float wall=field==2?2.5:stomach?4.0+0.5*(0.5+0.5*fold):digestiveWallMm(label),inner=d+wall; 
  if(field==2){c.tissue=inner<0.0?T_FLUID:T_BLADDER_WALL; c.bd=min(-d,abs(inner))/2.0; c.iface=IF_BLADDER_LUMEN; c.ifd=abs(inner); return true; }
  bool gas=inner<0.0&&digestiveGasPlane(m,label)>0.0; 
  c.tissue=inner>=0.0?(stomach?gastricWallTissue(-d,fold,inner):digestiveWallTissue(-d/wall)):gas?T_BOWELGAS:stomach?T_GASTRIC_CONTENTS:label>=5.0&&label<=9.0?T_COLONIC_CONTENTS:T_FLUID;
  c.bd=stomach?gastricBoundary(-d,inner,fold,rate,inner<0.0?abs(digestiveGasPlane(m,label))/2.0:1e3):min(min(-d,abs(inner)),inner<0.0?abs(digestiveGasPlane(m,label))/2.0:wall*0.03)/2.0; 
  c.iface=abs(d)<abs(inner)?IF_BOWEL_SEROSA:IF_BOWEL_LUMEN; c.ifd=abs(c.iface==IF_BOWEL_SEROSA?d:inner); return true; 
}
`;
