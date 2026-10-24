import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { pruneThreeShaderRegistry } from '../../tools/build/threeShaderFamilies';
import { threeGlslCompact } from '../../tools/build/threeGlslCompact';
import { prepareGlslMangle, transformWithMangle, type SourceModule } from '../../tools/build/glslMinify';
import { packGlslTemplates } from '../../tools/build/glslPacking';

const ROOT = process.cwd();
const THREE = join(ROOT, 'node_modules/three/src/renderers');
const file = (name: string) => join(THREE, 'shaders', name);
const read = (name: string) => readFileSync(file(name), 'utf8');
// Independent expectations, not imported from the transform's removal list.
const REMOVED = ['dashed', 'lambert', 'matcap', 'normal', 'phong', 'points', 'shadow', 'toon'];
const PROGRAMS = ['linedashed', 'meshlambert', 'meshmatcap', 'meshnormal', 'meshphong', 'meshtoon', 'points', 'shadow'];

function sources(dir: string): SourceModule[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'validation' ? [] : sources(path);
    return /\.(?:js|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)
      ? [{ path: realpathSync(path), code: readFileSync(path, 'utf8') }]
      : [];
  });
}

/** Independent AST representation also includes ShaderLib.physical's later assignment. */
function registry(code: string, variable: string): Map<string, string> {
  const source = ts.createSourceFile('registry.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const entries = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === variable &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error('Unexpected registry property');
        entries.set(property.name.getText(source), property.initializer.getText(source));
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.getText(source) === variable
    )
      entries.set(node.left.name.text, node.right.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!entries.size) throw new Error(`Empty registry ${variable}`);
  return entries;
}

/** Runtime constructor references, excluding types/comments; aliases and computed access fail closed. */
function materials(code: string, name: string): string[] {
  const source = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true);
  const namespaces = new Set<string>();
  const named = new Map<string, string>();
  const addons = new Set([
    'three/examples/jsm/objects/MarchingCubes.js',
    'three/examples/jsm/geometries/RoundedBoxGeometry.js',
    'three/examples/jsm/utils/BufferGeometryUtils.js',
  ]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith('three/') && !addons.has(specifier)) throw new Error(`Unaudited Three subpath in ${name}`);
    if (specifier !== 'three') continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) throw new Error(`Unaudited Three default import in ${name}`);
    const binding = clause.namedBindings;
    if (binding && ts.isNamespaceImport(binding)) namespaces.add(binding.name.text);
    if (binding && ts.isNamedImports(binding))
      for (const element of binding.elements)
        if (!element.isTypeOnly) named.set(element.name.text, (element.propertyName ?? element.name).text);
  }
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node)) return;
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /^three(?:\/|$)/.test(node.moduleSpecifier.text)
    )
      throw new Error(`Unaudited Three re-export in ${name}`);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const specifier = node.arguments[0];
      if (!specifier || !ts.isStringLiteral(specifier) || /^three(?:\/|$)/.test(specifier.text))
        throw new Error(`Unaudited dynamic import in ${name}`);
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text))
      throw new Error(`Computed Three access in ${name}`);
    if (
      ts.isIdentifier(node) &&
      namespaces.has(node.text) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
    )
      throw new Error(`Three namespace escape in ${name}`);
    let material: string | undefined;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text))
      material = node.name.text;
    else if (ts.isIdentifier(node)) material = named.get(node.text);
    if (material?.endsWith('Material')) {
      if (!ts.isNewExpression(node.parent) || node.parent.expression !== node)
        throw new Error(`Material constructor alias in ${name}: ${material}`);
      found.push(material);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function assertConsumers(lib: Map<string, string>, consumers: readonly string[]): void {
  // Read the vendor's actual dispatch map independently of this transform.
  const ids = registry(readFileSync(join(THREE, 'webgl/WebGLPrograms.js'), 'utf8'), 'shaderIDs');
  for (const consumer of consumers) {
    const text = ids.get(consumer);
    if (!text) throw new Error(`Unknown material dispatch: ${consumer}`);
    const family = text.slice(1, -1); // AST initializer is a single quoted literal in the inspected vendor.
    if (!lib.has(family)) throw new Error(`Consumed shader family removed: ${consumer} -> ${family}`);
  }
}

describe('familias Three sin consumidor del navegador', () => {
  it('conserva las familias consumidas sin fijar los nombres de materiales futuros', () => {
    const vendorPackage: unknown = JSON.parse(readFileSync(join(ROOT, 'node_modules/three/package.json'), 'utf8'));
    expect(vendorPackage).toMatchObject({ version: '0.186.1' });
    const used = [...new Set(sources(join(ROOT, 'src')).flatMap((source) => materials(source.code, source.path)))].sort();
    expect(used.length).toBeGreaterThan(0);
    const lib = registry(pruneThreeShaderRegistry(read('ShaderLib.js'), file('ShaderLib.js'))!, 'ShaderLib');
    assertConsumers(lib, used);
    // The negative has its own witness; the future UI need not keep using Basic.
    assertConsumers(lib, ['MeshBasicMaterial']);
    const newPhysical = materials("import * as THREE from 'three'; new THREE.MeshPhysicalMaterial();", 'retained-family.ts');
    expect(newPhysical).toEqual(['MeshPhysicalMaterial']);
    expect(() => assertConsumers(lib, newPhysical)).not.toThrow();
    expect(() => assertConsumers(lib, ['MeshPhongMaterial'])).toThrow(/Consumed shader family removed/);
    const missingBasic = new Map(lib);
    missingBasic.delete('basic');
    expect(() => assertConsumers(missingBasic, ['MeshBasicMaterial'])).toThrow(/Consumed shader family removed/);
    expect(() => materials("import * as THREE from 'three'; const C = THREE.MeshPhongMaterial; new C();", 'negative.ts')).toThrow(/alias/);
    expect(() => materials("import * as THREE from 'three'; new THREE['MeshPhongMaterial']();", 'negative.ts')).toThrow(/Computed/);
    expect(() =>
      materials("import { MeshPhongMaterial } from 'three/src/materials/MeshPhongMaterial.js'; new MeshPhongMaterial();", 'negative.ts'),
    ).toThrow(/subpath/);
    expect(() => materials("const THREE = await import('three'); new THREE.MeshPhongMaterial();", 'negative.ts')).toThrow(/dynamic import/);
    expect(() => materials("import * as THREE from 'three'; const T = THREE; new T.MeshPhongMaterial();", 'negative.ts')).toThrow(
      /namespace escape/,
    );
  });

  it('sólo retira ocho entradas de familia y sus dieciséis programas; conserva todas las demás', () => {
    for (const [name, variable, removed] of [
      ['ShaderLib.js', 'ShaderLib', REMOVED],
      ['ShaderChunk.js', 'ShaderChunk', PROGRAMS.flatMap((name) => [`${name}_frag`, `${name}_vert`])],
    ] as const) {
      const original = registry(read(name), variable);
      const transformed = registry(pruneThreeShaderRegistry(read(name), file(name))!, variable);
      expect([...original.keys()].filter((key) => !transformed.has(key)).sort()).toEqual([...removed].sort());
      expect([...transformed.keys()].filter((key) => !original.has(key))).toEqual([]);
      for (const [key, value] of transformed) expect(value, `${name}:${key}`).toBe(original.get(key));
    }
    expect(() => pruneThreeShaderRegistry(`${read('ShaderLib.js')}\n`, file('ShaderLib.js'))).toThrow(/registry changed/);
  });

  it('mantiene todos los GLSL del proveedor idénticos tras compactación y empaquetado', () => {
    // Baseline follows the previous algorithm directly; it never invokes the pruning helper.
    const all = sources(THREE);
    const baseline = prepareGlslMangle(all);
    baseline.map.names = new Map([...baseline.map.names].filter(([name]) => !name.endsWith('ToneMapping')));
    const plugin = threeGlslCompact();
    (plugin.configResolved as (config: { root: string }) => void)({ root: ROOT });
    (plugin.buildStart as () => void)();
    const transform = plugin.transform as (code: string, id: string) => { code: string };
    for (const name of ['ShaderLib.js', 'ShaderChunk.js'])
      expect(transform(read(name), file(name)).code).toBe(pruneThreeShaderRegistry(read(name), file(name)));
    let checked = 0;
    for (const source of all) {
      if (!/\/shaders\/(?:ShaderChunk|ShaderLib)\/[^/]+\.glsl\.js$/.test(source.path.replaceAll('\\', '/'))) continue;
      const before = transformWithMangle(source.code, source.path, baseline, { compact: true });
      const after = transform(source.code, source.path).code;
      expect(after, source.path).toBe(before);
      expect(packGlslTemplates(after, source.path, ROOT), source.path).toBe(packGlslTemplates(before, source.path, ROOT));
      checked++;
    }
    expect(checked).toBeGreaterThan(100); // No vacuous equality after an empty traversal.
  });
});
