import { S0028_BUNDLE as B } from '../anatomyBundle';
import { S0028_CHART_OFFSETS } from './s0028WallChart';

const offsets = (rows: readonly (readonly number[])[]) => rows.map((v) => `ivec3(${v.join(',')})`).join(',');

/** Carta bilineal S−dN, en la reserva P1; identidad nearest independiente de geometría D/E. */
export const S0028_WALL_GLSL = /* glsl */ `
const ivec3 S28_WALL_OFF[16]=ivec3[](${offsets(B.wall.placements)});
const ivec3 S28_CHART_OFF[16]=ivec3[](${offsets(S0028_CHART_OFFSETS)});
struct S28Chart {vec3 s;vec3 n;vec3 sr;vec3 sc;vec3 nr;vec3 nc;};
void s28ChartNode(ivec2 q,out vec3 s,out vec3 n){
  q.x=(q.x%512+512)%512;
  int band=min(1,q.y/90),tile=band*8+q.x/64;
  ivec3 at=S28_CHART_OFF[tile]+ivec3(q.x%64,q.y-band*90,0);
  s=vec3(texelFetch(uAbdominalAtlas,at,0).rg+texelFetch(uAbdominalAtlas,at+ivec3(0,0,1),0).rg,float(q.y)*1.5-210.0);
  vec2 e=texelFetch(uAbdominalAtlas,at+ivec3(0,0,2),0).rg;
  n=vec3(e,1.0-abs(e.x)-abs(e.y));
  n.xy-=mix(vec2(-1.0),vec2(1.0),greaterThanEqual(n.xy,vec2(0.0)))*clamp(-n.z,0.0,1.0);
  n=normalize(n);
}
S28Chart s28Chart(vec2 rc){
  vec2 q=vec2(mod(rc.x,512.0),clamp(rc.y,0.0,180.0));
  ivec2 ij=ivec2(floor(q));ij.y=min(179,ij.y);vec2 f=q-vec2(ij);
  vec3 s0,s1,s2,s3,n0,n1,n2,n3;
  s28ChartNode(ij,s0,n0);s28ChartNode(ij+ivec2(1,0),s1,n1);
  s28ChartNode(ij+ivec2(0,1),s2,n2);s28ChartNode(ij+ivec2(1,1),s3,n3);
  S28Chart o;
  o.s=mix(mix(s0,s1,f.x),mix(s2,s3,f.x),f.y);
  o.n=mix(mix(n0,n1,f.x),mix(n2,n3,f.x),f.y);
  o.sr=mix(s2-s0,s3-s1,f.x);o.sc=mix(s1-s0,s3-s2,f.y);
  float len=length(o.n);o.n/=len;
  vec3 nr=mix(n2-n0,n3-n1,f.x),nc=mix(n1-n0,n3-n2,f.y);
  o.nr=(nr-o.n*dot(o.n,nr))/len;o.nc=(nc-o.n*dot(o.n,nc))/len;
  return o;
}
vec4 s28Solve(vec3 p,vec2 rc){
  S28Chart f=s28Chart(rc);float d=dot(f.s-p,f.n);
  for(int i=0;i<12;i++){
    f=s28Chart(rc);vec3 e=p-f.s+d*f.n;
    if(length(e)<0.000001)break;
    vec3 a=f.sr-d*f.nr,b=f.sc-d*f.nc,c=-f.n,bc=cross(b,c);
    float det=dot(a,bc);if(abs(det)<0.0000001)break;
    rc.y=clamp(rc.y+clamp(dot(e,bc)/det,-4.0,4.0),-0.5,180.5);
    rc.x+=clamp(dot(e,cross(c,a))/det,-4.0,4.0);
    d+=clamp(dot(e,cross(a,b))/det,-10.0,10.0);
  }
  f=s28Chart(rc);return vec4(rc,d,length(p-f.s+d*f.n));
}
vec2 s28Seed(vec3 p){
  float row=clamp((p.z+210.0)/1.5,0.0,180.0);
  float cy=textureLod(uAbdominalAtlas,(vec3(48.0,row,398.0)+0.5)/vec3(textureSize(uAbdominalAtlas,0)),0.0).g;
  return vec2(mod(atan(p.y-cy,p.x),6.283185307179586)*81.48733086305042,row);
}
bool s28WallKnown(vec4 codes){
  return all(greaterThan(mod(floor(codes/8.0),4.0),vec4(0.0)))&&
    all(greaterThan(mod(floor(codes/32.0),4.0),vec4(0.0)))&&
    all(greaterThan(mod(floor(codes/128.0),4.0),vec4(0.0)));
}
// xyz=fronteras, w=código nearest; NaN expresa U sin fabricar una superficie.
vec4 s28WallSurface(vec2 rc){
  float nan=uintBitsToFloat(0x7fc00000u);
  if(rc.y<0.0||rc.y>180.0)return vec4(nan);
  rc.x=mod(rc.x,512.0);ivec2 ij=ivec2(floor(rc));ij.y=min(179,ij.y);
  vec2 f=rc-vec2(ij);int band=ij.y/90;
  ivec3 at=S28_WALL_OFF[band*8+ij.x/64]+ivec3(ij.x%64,ij.y-band*90,0),inside=at+ivec3(0,0,1);
  vec4 codes=vec4(texelFetch(uAbdominalAtlas,inside,0).g,texelFetch(uAbdominalAtlas,inside+ivec3(1,0,0),0).g,
    texelFetch(uAbdominalAtlas,inside+ivec3(0,1,0),0).g,texelFetch(uAbdominalAtlas,inside+ivec3(1,1,0),0).g);
  if(!s28WallKnown(codes))return vec4(nan);
  vec3 uv=(vec3(at)+vec3(f,0.0)+0.5)/vec3(textureSize(uAbdominalAtlas,0));
  vec2 ft=textureLod(uAbdominalAtlas,uv,0.0).rg;
  float pe=textureLod(uAbdominalAtlas,uv+vec3(0.0,0.0,1.0/float(textureSize(uAbdominalAtlas,0).z)),0.0).r;
  return vec4(ft,pe,codes[(f.y>=0.5?2:0)+(f.x>=0.5?1:0)]);
}
// xyzw = outer/inner/interface/depth; valid conserva sólo la geometría, nunca exige identidad muscular.
vec4 s28WallAt(vec3 p,out bool valid){
  vec3 g=s28DepthGradient(p),surface=p-torsoDepth(p)*g/max(dot(g,g),0.000001);
  vec4 q=s28Solve(p,s28Seed(surface));
  if(q.w>0.001){vec4 b=s28Solve(p,s28Seed(p));if(b.w<q.w)q=b;}
  vec4 bounds=s28WallSurface(q.xy);
  valid=q.w<=0.1&&q.z>=-6.0&&!isnan(bounds.x);
  return vec4(bounds.xyz,q.z);
}
float s28Inside(vec3 m){bool valid;vec4 q=s28WallAt(m,valid);return valid?q.w-q.z:-1000.0;}
`;

type Replace = (source: string, type: string, name: string, replacement: string) => string;
export function s0028WallShader(source: string, replace: Replace): string {
  let changed = replace(
    source,
    'float',
    'respWeight',
    S0028_WALL_GLSL +
      `
float respWeight(vec3 m){float inside=s28Inside(m);return smoothstep(0.0,25.0,inside)*smoothstep(uSpine.z+5.0,uSpine.z+35.0,length(m.xy-uSpine.xy));}`,
  );
  changed = replace(changed, 'float', 'insideWallMm', 'float insideWallMm(vec3 m){return s28Inside(m);}');
  changed = replace(
    changed,
    'vec3',
    'respWeightGradient',
    `
vec3 respWeightGradient(vec3 m){vec2 e=vec2(0.05,0.0);return vec3(respWeight(m+e.xyy)-respWeight(m-e.xyy),respWeight(m+e.yxy)-respWeight(m-e.yxy),respWeight(m+e.yyx)-respWeight(m-e.yyx))/0.1;}`,
  );
  changed = replace(
    changed,
    'float',
    'wallFaceSd',
    `
float wallFaceSd(vec3 m,int face){
 if(face==IF_SKIN_FAT)return -torsoDepth(m)-1.5;
 bool valid;vec4 q=s28WallAt(m,valid);
 if(!valid)return uintBitsToFloat(0x7fc00000u);
 return q.w-(face==IF_DEEP_FASCIA?q.x:face==IF_TRANSVERSALIS?q.y:q.z);
}`,
  );
  changed = replace(
    changed,
    'vec3',
    'wallFaceGradient',
    `
vec3 wallFaceGradient(vec3 m,int face){vec2 e=vec2(0.05,0.0);return vec3(wallFaceSd(m+e.xyy,face)-wallFaceSd(m-e.xyy,face),wallFaceSd(m+e.yxy,face)-wallFaceSd(m-e.yxy,face),wallFaceSd(m+e.yyx,face)-wallFaceSd(m-e.yyx,face))/0.1;}`,
  );
  changed = replace(
    changed,
    'bool',
    'classifyWall',
    `
bool classifyWall(vec3 m,out Cls c,out float depth,out vec3 tn){
 c.tissue=T_AIR;c.bd=1e3;c.n=vec3(0,1,0);c.iface=IF_NONE;c.ifd=1e3;c.vessel=-1;
 c.rho=10.0;c.tangent=vec3(0,0,1);c.kc=0.0;c.uRef=0.0;c.rRef=1.0;c.profN=2.0;
 depth=torsoDepth(m);tn=vec3(0,1,0);
 if(m.z<uTorso.z||m.z>uTorso.w||depth>0.0)return true;
 float d=-depth;
 if(d<1.5){c.tissue=T_SKIN;c.bd=min(d,1.5-d);c.iface=IF_SKIN_FAT;c.ifd=1.5-d;return true;}
 vec2 bone=thoracicValue(m);
 if(bone.x<0.0){c.tissue=thoracicMaterial(bone.y)==2?T_VERTEBRA:T_BONE;c.bd=-bone.x;return true;}
 bone=abdominalAtlasValue(m,8);
 if(bone.x<0.0){c.tissue=bone.y<=5.0?T_VERTEBRA:T_BONE;c.bd=-bone.x;return true;}
 bone=s28_sacrum(m);if(bone.x<0.0){c.tissue=T_BONE;c.bd=-bone.x;return true;}
 vec2 cart=s28_cartilage(m);
 if(cart.x<0.0){c.tissue=T_CARTILAGE;c.bd=-cart.x;c.iface=IF_PERICHONDRIUM;c.ifd=-cart.x;return true;}
 bool valid;vec4 q=s28WallAt(m,valid);
 if(!valid||q.w>=q.z)return false;
 bool fat=q.w<q.x;float outer=fat?1.5:q.x,inner=fat?q.x:q.y;
 c.tissue=fat?T_FAT:T_UNSEGMENTED;c.bd=max(0.0,min(q.w-outer,inner-q.w));
 c.iface=fat?IF_DEEP_FASCIA:IF_PERITONEUM;c.ifd=abs(inner-q.w);return true;
}`,
  );
  const start = changed.search(/void\s+classifyInside\s*\(/);
  const body = changed.indexOf('{', start),
    tailRelative = changed.slice(body).search(/float\s+bdBowel\s*=/);
  if (start < 0 || body < 0 || tailRelative < 0) throw new Error('Falta clasificación interior s0028');
  const tail = body + tailRelative;
  let end = body + 1,
    depth = 1;
  for (; depth && end < changed.length; end++) depth += changed[end] === '{' ? 1 : changed[end] === '}' ? -1 : 0;
  if (depth || tail >= end) throw new Error('Clasificación interior s0028 incompleta');
  end--;
  changed =
    changed.slice(0, tail) +
    `
  vec2 muscle=s28_posteriorMuscle(m);
  if(muscle.x<0.0&&muscle.y>0.0){c.tissue=muscle.y<=2.0?T_PSOAS:T_MUSCLE;c.bd=-muscle.x;return;}
  float dome=sdDome(m,dn);
  if(dome>=0.0&&dome<DIAPHRAGM_MM){c.tissue=T_DIAPHRAGM;c.bd=min(dome,DIAPHRAGM_MM-dome);c.n=dn;
    if(dome>0.5*DIAPHRAGM_MM){c.iface=IF_DIAPHRAGM_LIVER;c.ifd=DIAPHRAGM_MM-dome;}return;}
  c.tissue=T_UNSEGMENTED;c.bd=0.0;return;
` +
    changed.slice(end);
  changed = changed.replace(
    /float\s+wall\s*=\s*uWall\.x\s*\+\s*uWall\.y\s*\+\s*uWall\.z\s*;/,
    `
  vec2 lung=s28_lung(m);if(lung.x<0.0){c.tissue=T_LUNG;c.bd=-lung.x;return;}
  if(s28_heart(m).x<0.0){vec3 normal;float dome=sdDome(m,normal),ifd;c.tissue=thorax(m,dome,c.bd,ifd,c.n);return;}
  float wall=-depth-s28Inside(m);`,
  );
  changed = changed.replace(
    /if\s*\(withCurtain\)\s*\{\s*float\s+dCurtain\s*=\s*lungCurtainDistance\(m,\s*-depth\s*-\s*wall\);\s*if\s*\(dCurtain\s*>=\s*0\.0\)\s*\{[^}]+\}\s*\}/,
    '',
  );
  changed = changed.replace(/float\s+dDome\s*=\s*sdDome\(m,\s*dn\);/, 'dn=vec3(0.0,0.0,-0.5);float dDome=1000.0;');
  changed = changed.replace(/float\s+inner\s*=\s*min\(-dLiver,\s*min\(dDia,\s*-depth\s*-\s*wall\)\);/, 'float inner = -dLiver;');
  changed = replace(
    changed,
    'Cls',
    'classifyWith',
    `
Cls classifyWith(vec3 m,bool withCurtain){
 Cls c;float depth;vec3 tn;if(classifyWall(m,c,depth,tn))return c;
 classifyInside(m,withCurtain,depth,tn,1000.0,c);
 vec2 q=thoracicValue(m);
 if(thoracicMaterial(q.y)==0&&q.x>=0.0&&q.x<1.3&&q.x<c.ifd&&c.tissue!=T_LUNG&&c.tissue!=T_FLUID&&c.tissue!=T_BLOOD){
   c.bd=min(c.bd,q.x);c.iface=IF_RIB;c.ifd=q.x;thoracicFrame(m,c.tangent,c.kc);}
 return c;
}`,
  );
  changed = replace(changed, 'float', 'liverInner', 'float liverInner(vec3 m){return -abdominalAtlasSdf(m,4);}');
  changed = replace(changed, 'vec3', 'visceralHeight', 'vec3 visceralHeight(vec2 p){return vec3(0.0);}');
  changed = replace(
    changed,
    'float',
    'wallFaceDepth',
    'float wallFaceDepth(float u,float z,int face){return uintBitsToFloat(0x7fc00000u);}',
  );
  changed = replace(changed, 'vec4', 'wallDepths', 'vec4 wallDepths(float u,float z){return vec4(uintBitsToFloat(0x7fc00000u));}');
  changed = replace(changed, 'float', 'domeSd', 'float domeSd(vec3 m){vec3 n;return max(sdDome(m,n),-s28Inside(m));}');
  changed = replace(changed, 'float', 'ribSd', 'float ribSd(vec3 m,int k){return thoracicSdf(m);}');
  // El pericondrio pertenece al campo de cartílago, no al SDF óseo.
  changed = changed.replace(
    /}\s*else\s+if\s*\(c\.iface\s*==\s*IF_RIB\s*\|\|\s*c\.iface\s*==\s*IF_PERICHONDRIUM\)\s*\{/,
    `} else if(c.iface==IF_PERICHONDRIUM){
    g=vec3(s28_cartilage(m+h.xyy).x-s28_cartilage(m-h.xyy).x,s28_cartilage(m+h.yxy).x-s28_cartilage(m-h.yxy).x,s28_cartilage(m+h.yyx).x-s28_cartilage(m-h.yyx).x);
  } else if(c.iface==IF_RIB){`,
  );
  changed = changed.replace(/float\s+lg\s*=\s*length\(g\);/, 'if(any(isnan(g)))return vec4(0.0);\n  float lg = length(g);');
  if (/uWall\.x\s*\+\s*uWall\.y\s*\+\s*uWall\.z|skin\s*\+\s*uWall\.y\s*\+\s*uWall\.z/.test(changed))
    throw new Error('Consumidor s0028 conserva W global');
  return changed;
}
