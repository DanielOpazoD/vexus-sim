/** P2 offline: injerta el lector de superficie en las ocho fuentes P1, sin instalarlo. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { S0028_BUNDLE } from '../../src/anatomy/anatomyBundle';
import * as PASSES from '../../src/ultrasound/shaders/passes.glsl';
import { personShader } from './s0028-p1-specialized';
import { shaderContract, shaderCosts } from './s0028-shader-metrics';

function replaceFunction(source: string, type: string, name: string, replacement: string): string {
  const match = new RegExp(`\\b${type}\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!match) throw new Error('Falta definición ' + name);
  let end = match.index + match[0].length;
  for (let depth = 1; depth && end < source.length; end++) depth += source[end] === '{' ? 1 : source[end] === '}' ? -1 : 0;
  return source.slice(0, match.index) + replacement + source.slice(end);
}

const offsets = Array.from({ length: 16 }, (_, i) => `vec3(0,0,${619 + 2 * i})`).join(',');
const READER = `
const vec3 S28_WALL_OFF[16]=vec3[](${offsets});
vec3 s28WallAddress(float u,float z,float page){
  float col=mod(u/150.0+6.28318530718,6.28318530718)*(512.0/6.28318530718);
  float row=clamp((z+210.0)/1.5,0.0,180.0);
  float zr=min(1.0,floor(row/90.0));
  return S28_WALL_OFF[int(8.0*zr+floor(col/64.0))]+vec3(mod(col,64.0),row-zr*90.0,page);
}
bool s28WallKnown(vec3 at){
  // La última fila usa la pareja 89/90 del halo, sin leer la fila 91 ajena.
  at.y=min(at.y,89.0);
  vec4 codes=vec4(texelFetch(uAbdominalAtlas,ivec3(at),0).g,
    texelFetch(uAbdominalAtlas,ivec3(at)+ivec3(1,0,0),0).g,
    texelFetch(uAbdominalAtlas,ivec3(at)+ivec3(0,1,0),0).g,
    texelFetch(uAbdominalAtlas,ivec3(at)+ivec3(1,1,0),0).g);
  return all(greaterThan(mod(codes,8.0),vec4(0.0))) &&
    all(greaterThan(mod(floor(codes/8.0),4.0),vec4(0.0))) &&
    all(greaterThan(mod(floor(codes/32.0),4.0),vec4(0.0))) &&
    all(greaterThan(mod(floor(codes/128.0),4.0),vec4(0.0)));
}
vec4 s28WallDepths(float u,float z){
  vec3 at=s28WallAddress(u,z,0.0), inside=s28WallAddress(u,z,1.0);
  if(z< -210.0||z>60.0||!s28WallKnown(floor(inside)))return vec4(uintBitsToFloat(0x7fc00000u));
  vec2 ft=textureLod(uAbdominalAtlas,(at+0.5)/vec3(189,256,685),0.0).rg;
  float pe=textureLod(uAbdominalAtlas,(inside+0.5)/vec3(189,256,685),0.0).r;
  // 0,4 es E heredada. El formato no convierte fascia o peritoneo en observación.
  return vec4(1.5+0.4*(ft.x-1.5),ft,pe);
}
float s28SurfaceArc(vec3 m){
  vec3 g=s28DepthGradient(m);
  m-=torsoDepth(m)*g/max(dot(g,g),0.000001);
  float cy=textureLod(uAbdominalAtlas,(vec3(48,0,398)+vec3(0,clamp((m.z+210.0)/1.5,0.0,180.0),0)+0.5)/vec3(189,256,685),0.0).g;
  return atan(m.y-cy,m.x)*150.0;
}
`;

export function wallShader(source: string): string {
  let changed = personShader(source, { person: 's0028', bundle: S0028_BUNDLE });
  changed = replaceFunction(changed, 'float', 'wallArc', READER + '\nfloat wallArc(vec3 m){return s28SurfaceArc(m);}');
  changed = replaceFunction(changed, 'vec4', 'wallDepths', 'vec4 wallDepths(float u,float z){return s28WallDepths(u,z);}');
  changed = changed.replaceAll('uWall.x + uWall.y + uWall.z', 'wallDepths(wallArc(m),m.z).w');
  changed = changed.replaceAll('float wall = skin + uWall.y + uWall.z;', 'float wall = wallDepths(wallArc(m),m.z).w;');
  if (changed.includes('uWall.x + uWall.y + uWall.z') || changed.includes('skin + uWall.y + uWall.z'))
    throw new Error('Consumidor conserva W global');
  return changed;
}

const out = process.argv[2];
if (process.argv[1]?.endsWith('s0028-wall-cost.ts')) {
  if (!out) throw new Error('Indicar carpeta de evidencia P2');
  // Los offsets deben coincidir con el certificado reabierto, nunca con un diseño supuesto.
  const annotation: unknown = JSON.parse(readFileSync(resolve(out, 'annotation/annotation.json'), 'utf8'));
  const placements = Array.from({ length: 16 }, (_, i) => [0, 0, 619 + 2 * i]);
  if (
    !annotation ||
    typeof annotation !== 'object' ||
    !('placements' in annotation) ||
    JSON.stringify(annotation.placements) !== JSON.stringify(placements) ||
    !('centerOffset' in annotation) ||
    JSON.stringify(annotation.centerOffset) !== JSON.stringify([48, 0, 398])
  )
    throw new Error('Packing de pared distinto del candidato medido');
  const rows = shaderCosts(wallShader, (s) => personShader(s, { person: 's0028', bundle: S0028_BUNDLE }));
  for (const row of rows) {
    const source = Object.entries(PASSES).find(([name]) => name === row.name)?.[1];
    if (typeof source !== 'string') throw new Error('Fuente ausente');
    writeFileSync(resolve(out, row.name + '-P2-estimate.glsl'), wallShader(source));
  }
  const result = {
    ...shaderContract,
    rows,
    allPass: rows.every((r) => r.current.pass && r.specialized.pass && r.specialized.samplers === r.current.samplers),
    method: 'P1 current source + offline wall reader; literal shaderLimits helpers and ceilings',
    scope:
      'static estimate of representation and legacy wall query replacement; no runtime/JIT, complete regional classifier or normal/contact proof',
    runtimeInstalled: false,
  };
  writeFileSync(resolve(out, 'shader-cost.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.allPass) process.exitCode = 1;
}
