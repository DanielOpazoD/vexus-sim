import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { stripThreeSerialization, stubThreeSubsystem } from '../../tools/build/threeUnusedSubsystems';

const THREE = join(process.cwd(), 'node_modules/three/src');
const read = (path: string) => readFileSync(join(THREE, path), 'utf8');
const id = (path: string) => `/x/node_modules/three/src/${path}`;

/** Lista independiente de la del transformador: lo que el renderizador lee de cada subsistema retirado. */
const CONSUMERS = {
  'renderers/webxr/WebXRManager.js': {
    pattern: /\b(?:_this\.|renderer\.)?xr\.(\w+)/g,
    files: ['renderers/WebGLRenderer.js', 'renderers/webgl/WebGLBackground.js'],
    provided: ['enabled', 'isPresenting', 'cameraAutoUpdate', 'setAnimationLoop', 'getEnvironmentBlendMode', 'hasDepthSensing', 'dispose'],
    // Heredados de EventDispatcher, o detrás de `xr.enabled === true`, que el sustituto deja siempre en falso.
    guarded: ['addEventListener', 'removeEventListener', 'updateCamera', 'getCamera', 'getDepthSensingMesh'],
  },
  'renderers/webgl/WebGLShadowMap.js': {
    pattern: /\b(?:renderer\.)?shadowMap\.(\w+)/g,
    files: ['renderers/WebGLRenderer.js', 'renderers/webgl/WebGLPrograms.js'],
    provided: ['enabled', 'autoUpdate', 'needsUpdate', 'type', 'render'],
    guarded: [],
  },
  'renderers/webgl/WebGLUniformsGroups.js': {
    pattern: /\buniformsGroups\.(\w+)/g,
    files: ['renderers/WebGLRenderer.js'],
    provided: ['dispose'],
    // Solo recorriendo `material.uniformsGroups`, vacío sin un bloque de uniformes.
    guarded: ['update', 'bind'],
  },
} as const;

function productSources(dir: string): Array<[string, string]> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): Array<[string, string]> => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [[path, readFileSync(path, 'utf8')]] : [];
  });
}

function threeModules(dir = THREE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return threeModules(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

function classMethods(code: string, name: string): string[] {
  const source = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node)) for (const m of node.members) if (ts.isMethodDeclaration(m)) out.push(m.name.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('subsistemas de Three sin consumidores', () => {
  it('un módulo cambiado falla en vez de perder algo en silencio', () => {
    for (const path of [...Object.keys(CONSUMERS), 'extras/PMREMGenerator.js']) {
      expect(stubThreeSubsystem(read(path), id(path))).not.toBeNull();
      expect(() => stubThreeSubsystem(`${read(path)}\n// cambio`, id(path))).toThrow(/Three 0\.186\.1 cambió/);
    }
    expect(stubThreeSubsystem(read('core/Object3D.js'), id('core/Object3D.js'))).toBeNull();
  });

  for (const [path, spec] of Object.entries(CONSUMERS))
    it(`${path}: cubre todo lo que lee el renderizador`, () => {
      const stub = stubThreeSubsystem(read(path), id(path))!;
      const seen = new Set(spec.files.flatMap((file) => [...read(file).matchAll(spec.pattern)].map((m) => m[1])));
      expect([...seen].sort()).toEqual([...spec.provided, ...spec.guarded].sort());
      for (const name of spec.provided) expect(stub, name).toMatch(new RegExp(`\\b${name}\\b`));
    });

  it('`xr.enabled` queda en falso, y lo que hay detrás de él no se alcanza', () => {
    const renderer = read('renderers/WebGLRenderer.js');
    expect(stubThreeSubsystem(read('renderers/webxr/WebXRManager.js'), id('renderers/webxr/WebXRManager.js'))).toMatch(/enabled = false/);
    for (const name of ['updateCamera', 'getCamera', 'getDepthSensingMesh']) {
      const at = renderer.indexOf(`xr.${name}(`);
      expect(renderer.lastIndexOf('xr.enabled === true', at), name).toBeGreaterThan(at - 400);
    }
    // El bucle de animación propio del renderizador no depende de XR.
    expect(renderer).toMatch(
      /xr\.setAnimationLoop\( callback \);\s*\( callback === null \) \? animation\.stop\(\) : animation\.start\(\);/,
    );
  });

  it('el producto no toca ninguno de ellos', () => {
    const banned = /\.xr\b|castShadow|receiveShadow|\.shadowMap\b|\.environment\b|\benvMap\b|uniformsGroups|PMREM|\.toJSON\(|fromJSON/;
    const src = join(process.cwd(), 'src');
    // El diccionario de empaquetado de GLSL nombra tokens de Three: es texto, no un consumidor.
    const offenders = productSources(src)
      .filter(([path]) => !path.endsWith('core/glslPacking.ts'))
      .filter(([, code]) => banned.test(code))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('quita `toJSON`/`fromJSON` de las clases y nada más, en todos los módulos', () => {
    let stripped = 0;
    for (const path of threeModules()) {
      const code = readFileSync(path, 'utf8');
      const out = stripThreeSerialization(code, path);
      if (out === null) continue;
      stripped++;
      const before = classMethods(code, path);
      const after = classMethods(out, path);
      expect(after, path).toEqual(before.filter((m) => m !== 'toJSON' && m !== 'fromJSON'));
      const source = ts.createSourceFile(path, out, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      expect((source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics, path).toEqual([]);
    }
    expect(stripped).toBeGreaterThan(30);
    const material = stripThreeSerialization(read('materials/Material.js'), id('materials/Material.js'))!;
    expect(classMethods(material, 'Material.js')).toContain('copy');
    expect(material).not.toMatch(/\btoJSON\( ?meta/);
  });

  it('solo actúa sobre módulos de Three', () => {
    expect(stripThreeSerialization('class A { toJSON() {} }', '/x/src/ui/a.js')).toBeNull();
    expect(stubThreeSubsystem('x', '/x/src/extras/PMREMGenerator.js')).toBeNull();
  });
});
