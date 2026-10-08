import { abdominalAtlasValue, abdominalAtlasGradient, ABDOMINAL_ATLAS_GLSL } from '../abdominalAtlas';
import { Tissue } from '../tissues';
import { Interface } from '../interfaces';
import type { Vec3 } from '../../core/vec3';

export function digestiveWallMm(label: number): number {
  return label === 1 ? 3 : label >= 5 ? 2.5 : 2;
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
export function digestiveGasPlane(m: Vec3, label: number): number {
  return m[1] - (label === 1 ? 30 : 18) - 7 * Math.sin(m[2] / 17) * Math.cos(m[0] / 21);
}
export function abdomenQuery(m: Vec3) {
  let field = -1,
    d = 16,
    label = 0;
  for (let k = 0; k < 4; k++) {
    const q = abdominalAtlasValue(m, k);
    if (q.d < d) {
      field = k;
      d = q.d;
      label = q.label;
    }
  }
  if (field < 0 || d >= 0) return null;
  const n = abdominalAtlasGradient(m, field);
  if (field === 0 || field === 3)
    return {
      tissue: -d < 0.35 ? Tissue.SoftCapsule : field === 0 ? Tissue.Pancreas : Tissue.Spleen,
      boundaryDistance: Math.min(-d, Math.abs(d + 0.35)) / 2,
      interface: field === 0 ? Interface.PancreasCapsule : Interface.SpleenCapsule,
      interfaceDistance: -d,
      boundaryNormal: n,
      curvature: 0,
    };
  const wall = field === 2 ? 2.5 : digestiveWallMm(label),
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
  const gas = inner < 0 && digestiveGasPlane(m, label) > 0;
  const iface = Math.abs(d) < Math.abs(inner) ? Interface.BowelSerosa : Interface.BowelLumen;
  return {
    tissue: inner >= 0 ? digestiveWallTissue(-d / wall) : gas ? Tissue.BowelGas : Tissue.Fluid,
    boundaryDistance: Math.min(-d, Math.abs(inner), inner < 0 ? Math.abs(digestiveGasPlane(m, label)) / 2 : wall * 0.03) / 2,
    interface: iface,
    interfaceDistance: Math.abs(iface === Interface.BowelSerosa ? d : inner),
    boundaryNormal: n,
    curvature: 0,
  };
}
export {
  registeredDomeHeight,
  registeredDomeValue,
  hepaticDomeValue,
  abdominalAtlasSdf,
  abdominalAtlasValue,
  abdominalAtlasGradient,
} from '../abdominalAtlas';
export const ABDOMEN_GLSL = /* glsl */ `
${ABDOMINAL_ATLAS_GLSL}
// Shared acoustic layers and static nondependent gas. No assigned flow in a hollow organ.
float digestiveWallMm(float label){return label==1.0?3.0:label>=5.0?2.5:2.0; }
int digestiveWallTissue(float fraction){return fraction<0.12?T_SOFT_CAPSULE:fraction<0.42?T_GUT_MUSCULARIS:fraction<0.68?T_GUT_SUBMUCOSA:fraction<0.93?T_BOWEL:T_GUT_SUBMUCOSA; }
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
  float wall=field==2?2.5:digestiveWallMm(label),inner=d+wall; 
  if(field==2){c.tissue=inner<0.0?T_FLUID:T_BLADDER_WALL; c.bd=min(-d,abs(inner))/2.0; c.iface=IF_BLADDER_LUMEN; c.ifd=abs(inner); return true; }
  bool gas=inner<0.0&&digestiveGasPlane(m,label)>0.0; 
  c.tissue=inner>=0.0?digestiveWallTissue(-d/wall):gas?T_BOWELGAS:T_FLUID; 
  c.bd=min(min(-d,abs(inner)),inner<0.0?abs(digestiveGasPlane(m,label))/2.0:wall*0.03)/2.0; 
  c.iface=abs(d)<abs(inner)?IF_BOWEL_SEROSA:IF_BOWEL_LUMEN; c.ifd=abs(c.iface==IF_BOWEL_SEROSA?d:inner); return true; 
}
`;
