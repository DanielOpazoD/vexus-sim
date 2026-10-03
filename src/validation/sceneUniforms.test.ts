import { describe, expect, it } from 'vitest';
import { AnatomyScene } from '../anatomy/scene';
import { CASES } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import {
  SCENE_UNIFORMS,
  SCENE_UNIFORMS_GLSL,
  evaluateSceneUniforms,
  uploadSceneUniforms,
  type UniformSink,
} from '../anatomy/gpu/sceneUniforms';

/**
 * Esquema único de uniforms de la anatomía (Fase 2): ANATOMY_GLSL no declara uniforms a mano,
 * todo uniform que usa está en el esquema, ninguno del esquema sobra, y los valores tienen el
 * tamaño de su tipo para todos los casos.
 */
const body = ANATOMY_GLSL.replace(SCENE_UNIFORMS_GLSL, '');
const declared = new Set([...SCENE_UNIFORMS.map((u) => u.name), 'uSceneTex']);

it('exige highp al leer coordenadas geométricas RGBA32F', () => {
  expect(SCENE_UNIFORMS_GLSL).toContain('uniform highp sampler2D uSceneTex;');
});

describe('Esquema de uniforms de la escena', () => {
  it('ANATOMY_GLSL no contiene declaraciones de uniform escritas a mano', () => {
    expect(body).not.toMatch(/^\s*uniform\s/m);
  });

  it('todo uniform usado en el GLSL está en el esquema y ninguno del esquema sobra', () => {
    // Excluye accesos a campos (`c.uRef`) y nombres declarados como variable local o campo de
    // struct (`float uRef;`, `float uLocal = …`)
    const locals = new Set([...body.matchAll(/\b(?:float|int|bool|vec[234]|mat[34])\s+(u[A-Z]\w*)/g)].map((m) => m[1]));
    const used = new Set((body.match(/(?<![.\w])u[A-Z][A-Za-z0-9]*\b/g) ?? []).filter((n) => !locals.has(n)));
    for (const name of used) expect(declared.has(name), `${name} usado pero no declarado`).toBe(true);
    for (const name of declared) expect(used.has(name), `${name} declarado pero sin uso`).toBe(true);
  });

  it('cada caso da valores finitos del tamaño correcto y la subida llama al setter del tipo', () => {
    for (const c of CASES) {
      const scene = new AnatomyScene(c);
      const sample = new PhysiologyEngine(c, scene.vesselAreas()).step();
      const values = evaluateSceneUniforms(scene, { sample, tubeCount: 40, compression: null });
      expect(values).toHaveLength(SCENE_UNIFORMS.length);
      for (const { spec, data } of values) for (const v of data) expect(Number.isFinite(v), `${spec.name} no finito`).toBe(true);
      const calls: string[] = [];
      const sink: UniformSink = {
        f: (n) => calls.push(`f:${n}`),
        i: (n) => calls.push(`i:${n}`),
        v2: (n) => calls.push(`v2:${n}`),
        v3: (n) => calls.push(`v3:${n}`),
        v4: (n) => calls.push(`v4:${n}`),
        v3v: (n) => calls.push(`v3v:${n}`),
        v4v: (n) => calls.push(`v4v:${n}`),
      };
      uploadSceneUniforms(sink, values);
      expect(calls).toContain('v4v:uRibs');
      expect(calls).toContain('v3v:uKidC');
      expect(calls).toContain('i:uTubeCount');
      expect(calls).toHaveLength(SCENE_UNIFORMS.length);
    }
  });
});
