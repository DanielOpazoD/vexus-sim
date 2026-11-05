import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import * as PASSES from '../ultrasound/shaders/passes.glsl';
import { personShader } from '../anatomy/gpu/personShader';
import { RIGID_BASE } from '../anatomy/gpu/anatomy.glsl';
import { S0028_BUNDLE as bundle } from '../anatomy/anatomyBundle';
import { shaderCosts } from '../../tools/anatomy/s0028-shader-metrics';
import { minifyGlslBody } from '../../tools/build/glslMinify';
import baseline from './fixtures/s0028-shader-default.json';

it('conserva los ocho GLSL default byte a byte respecto de main 8ee9fbd', () => {
  for (const [name, hash] of Object.entries(baseline)) {
    const source = Object.entries(PASSES).find(([key]) => key === name)?.[1];
    if (typeof source !== 'string') throw new Error('Programa ausente');
    expect(
      createHash('sha256')
        .update(personShader(source, { person: 'current' }))
        .digest('hex'),
      name,
    ).toBe(hash);
    expect(
      createHash('sha256')
        .update(source + '\n')
        .digest('hex'),
    ).not.toBe(hash);
  }
});

it('s0028 sustituye W global en todos los consumidores alcanzables y lee cuatro soportes geométricos', () => {
  const source = personShader(PASSES.FRAG_RAWFIELD_CLASS, { person: 's0028', bundle });
  expect(source).not.toMatch(/uWall\.x\s*\+\s*uWall\.y\s*\+\s*uWall\.z|skin\s*\+\s*uWall\.y\s*\+\s*uWall\.z/);
  expect(source).toContain('s28WallKnown');
  expect(source).toContain('s28WallAt');
  // Regla directa: sin Newton ni carta S−dN en GPU; la inversa queda offline.
  expect(source).not.toMatch(/s28Solve|s28Chart|S28_CHART_OFF/);
  // Negativo: un consumidor nuevo con W global no se especializa.
  const legacy = PASSES.FRAG_RAWFIELD_CLASS.replace(
    '\nvoid main() {',
    '\nfloat legacyWall(){return uWall.x + uWall.y + uWall.z;}\nvoid main() {',
  );
  expect(legacy).not.toBe(PASSES.FRAG_RAWFIELD_CLASS);
  expect(() => personShader(legacy, { person: 's0028', bundle })).toThrow(/W global/);
});

it('rechaza el sampler 17 en ECHO usando el contrato real intacto', () => {
  const rows = shaderCosts((source) => {
    const changed = personShader(source, { person: 's0028', bundle });
    return source === PASSES.FRAG_RAWFIELD_ECHO ? changed + '\nuniform sampler2D uForbiddenWall;' : changed;
  });
  const echo = rows.find((row) => row.name === 'FRAG_RAWFIELD_ECHO');
  expect(echo?.specialized.samplers).toBe(17);
  expect(echo?.specialized.pass).toBe(false);
});

it('especializa los programas s0028 después de compactar GLSL para producción', () => {
  for (const name of Object.keys(baseline)) {
    const source = Object.entries(PASSES).find(([key]) => key === name)?.[1];
    if (typeof source !== 'string') throw new Error('Programa ausente');
    const compact = minifyGlslBody([source], [], undefined, 'join');
    const specialized = personShader(compact, { person: 's0028', bundle });
    expect(specialized, name).toContain('s28WallAt');
    // P3 r3: dueños, tubos con el riñón fuera y material abdominal sin el bucle de cuatro campos, también compactado.
    expect(specialized, name).toContain('s28POwn(m,q,valid,k,od,b,e)');
    expect(specialized, name).toMatch(/tubeCandidates\(m\);if\(renal\)\w+\.y=0;/);
    expect(specialized, name).toContain('bool s28PAbdomen(');
    expect(specialized, name).not.toMatch(/uWall\.x\s*\+\s*uWall\.y\s*\+\s*uWall\.z/);
  }
});

it('el corazón s0028 usa la normal de la cúpula para su suelo, como heartFloor en la CPU', () => {
  // Con la normal inicial (0,1,0) el factor de pendiente max(1, −0,5/n.z) valía 1 y movía el suelo cardíaco (paridad r2b).
  const source = personShader(PASSES.FRAG_RAWFIELD_CLASS, { person: 's0028', bundle });
  expect(source).toMatch(/if\(k==15\)\{float dome=sdDome\(m,c\.n\),ifd;c\.tissue=thorax\(m,dome,c\.bd,ifd,c\.n\);return;\}/);
});

it('sin cortina pulmonar procedural en s0028: A0 no toma la pared regional por pleura ni B pone aire bajo ella', () => {
  // Gemelo de lungEdgeMm (null) e inLungRecess (pulmón fuente) de la CPU desde r2a.
  for (const name of ['FRAG_TRANS_HITS', 'FRAG_TRANS_HITS_INITIAL', 'FRAG_RAWFIELD', 'FRAG_RAWFIELD_ECHO']) {
    const source = Object.entries(PASSES).find(([key]) => key === name)?.[1];
    if (typeof source !== 'string') throw new Error('Programa ausente');
    const specialized = personShader(source, { person: 's0028', bundle });
    if (/lungCurtainEdgeMm\s*\(/.test(source)) expect(specialized, name).toContain('float lungCurtainEdgeMm(vec3 m){return -1000.0;}');
    if (/bool\s+inLungRecess\s*\(/.test(source)) expect(specialized, name).toContain('return s28PT(m,2)<0.0;');
    expect(specialized, name).not.toMatch(/m\.z\s*-\s*min\(uCurtain\.x,\s*domeHeight/);
  }
});

it('la reverberación tras gas de s0028 no eleva bases negativas: sin NaN detrás del pulmón o del gas', () => {
  // pow(x, 2) con x < 0 es indefinido en GLSL ES; Metal da NaN y B lo extendía desde el gas hasta el final de la línea.
  for (const [name, source] of Object.entries(PASSES)) {
    if (typeof source !== 'string' || !/pow\(\(r - rk\) \/ 1\.2, 2\.0\)/.test(source)) continue;
    const specialized = personShader(source, { person: 's0028', bundle });
    expect(specialized, name).not.toMatch(/pow\(\s*\(r\s*-\s*rk\)/);
    expect(specialized, name).toContain('exp(-0.5*((r-rk)/1.2)*((r-rk)/1.2))');
    // El default conserva su texto (hash por variante idéntico a main).
    expect(personShader(source, { person: 'current' }), name).toBe(source);
  }
  // También en el GLSL compactado de producción.
  const compact = minifyGlslBody([PASSES.FRAG_RAWFIELD], [], undefined, 'join');
  expect(personShader(compact, { person: 's0028', bundle })).not.toMatch(/pow\(\s*\(r\s*-\s*rk\)/);
});

it('la GPU s0028 pesa la celda U con la rampa por profundidad de su fila y la celda D/E como antes (gemelo de la CPU)', () => {
  // s0028RespiratoryWall / rampAt (s0028Wall.ts): celda D/E smoothstep(0, 25, −τ − cara interna); U smoothstep(p10, p90, −τ)
  // con la fila de la proyección recortada a [0, 180] y una lectura filtrada en la columna derivada.
  const source = personShader(PASSES.FRAG_RAWFIELD, { person: 's0028', bundle });
  const [x, y, z] = bundle.wallDerived.ramps.placement;
  expect(source).toContain(
    `vec2 s28Ramp(float row){\n  return textureLod(uAbdominalAtlas,(vec3(${x}.0+row,${y}.0,${z}.0)+0.5)/vec3(textureSize(uAbdominalAtlas,0)),0.0).rg;\n}`,
  );
  expect(source).toMatch(
    /float s28RespWall\(vec3 m\)\{\s*float depth;vec3 g,s;vec2 xy,f;vec4 o,i,e;\s*vec2 rc=s28Project\(m,depth,g,s,xy\);\s*vec4 b=s28WallSurface\(rc,o,i,e,f\);\s*if\(s28Valid\(g,s,depth,b\)\)return smoothstep\(0\.0,25\.0,-depth-b\.z\);\s*vec2 r=s28Ramp\(rc\.y\);\s*return smoothstep\(r\.x,r\.y,-depth\);\s*\}/,
  );
  expect(source).toContain(
    'float respWeight(vec3 m){return s28RespWall(m)*smoothstep(uSpine.z+5.0,uSpine.z+35.0,length(m.xy-uSpine.xy));}',
  );
  expect(source).toMatch(/if\(s28Valid\(g,s,depth,b\)\)gi=s28Grad\(e,f,g,xy\);\s*else\{ramp=s28Ramp\(rc\.y\);inside=-depth;gi=-g;\}/);
  // El default no cambia (hash por programa en la prueba de arriba).
  expect(personShader(PASSES.FRAG_RAWFIELD, { person: 'current' })).not.toContain('s28Ramp');
});

it('compresión rígida s0028 (r3): el perfil se evalúa sobre σ(d) con la tabla (κ, d₁, L) del tramo; el default no la lee', () => {
  for (const name of ['FRAG_RAWFIELD', 'FRAG_TRANS_HITS', 'FRAG_RAWFIELD_CLASS', 'FRAG_COLOR'] as const) {
    const source = personShader(PASSES[name], { person: 's0028', bundle });
    expect(source, name).toContain(`s28R=mix(sceneTexel(${RIGID_BASE}+i).xyz,sceneTexel(${RIGID_BASE}+i+1).xyz,t);`);
    expect(source, name).toContain(
      'float g=compressionProfile0(wall?depth:v.z+s28R.x*(depth-v.z-clamp(depth-s28R.y,0.0,s28R.z)),v,gd,gp);',
    );
    expect(source, name).toContain('gd*=wall?1.0:depth>s28R.y&&depth<s28R.y+s28R.z?0.0:s28R.x;');
    expect(PASSES[name], name).not.toContain('s28R');
  }
});
