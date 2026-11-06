import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = resolve('src');
const files = new Map<string, string>();
function read(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'validation') read(path);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.set(path, readFileSync(path, 'utf8'));
  }
}
read(root);

/** Toda función diferida default, además de la entrada Worker; no sólo el primer cuadro. */
function closure(entries: string[]): string[] {
  const seen = new Set<string>();
  const visit = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const code = files.get(path);
    if (!code) throw new Error(`Módulo sin resolver: ${path}`);
    const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
    const follow = (specifier: string, dynamic: boolean): void => {
      if (!specifier.startsWith('.')) return;
      // Sólo las dos entradas privadas aprobadas pueden ser podadas; nunca un import estático.
      const importer = relative(root, path);
      if (
        dynamic &&
        ((importer === 'anatomy/loadPerson.ts' && specifier === './people/s0028/runtime') ||
          (importer === 'ui/cutMapWorker.ts' && specifier === '../anatomy/people/s0028/cpu'))
      )
        return;
      const base = resolve(dirname(path), specifier);
      const target = [base, `${base}.ts`, join(base, 'index.ts')].find((p) => files.has(p));
      if (target) visit(target);
    };
    const walk = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        const bindings = node.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings) || bindings.elements.some((e) => !e.isTypeOnly))
          follow(node.moduleSpecifier.text, false);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        follow(node.moduleSpecifier.text, false);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0]))
        follow(node.arguments[0].text, true);
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  entries.forEach((p) => visit(join(root, p)));
  return [...seen].map((p) => relative(root, p)).sort();
}

it('la clausura default completa no contiene implementaciones privadas s0028', () => {
  const modules = closure(['main.ts', 'ui/cutMapWorker.ts']);
  expect(modules.length).toBeGreaterThan(100);
  expect(modules.filter((p) => /(?:^|\/)s0028|\/personShader\.ts$/.test(p))).toEqual([]);
});

it('el Worker sólo alcanza la entrada CPU privada después de init', () => {
  const code = files.get(join(root, 'ui/cutMapWorker.ts'))!;
  expect(code).toMatch(/import\(['"][^'"]*people\/s0028\/cpu['"]\)/);
  expect(code).not.toMatch(/from ['"][^'"]*(?:s0028|personShader|loadS0028)/);
  expect(code).toContain("'ready'");
  expect(code).toContain('assetKey');
  expect(code).toContain('epoch');
});
