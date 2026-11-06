import ts from 'typescript';

/** El grafo sólo puede cerrar rutas si todos los import() de aplicación son resolubles. */
export function assertLiteralImports(code: string, id: string): void {
  const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const target = node.arguments[0];
      if (!target || !ts.isStringLiteralLike(target)) throw new Error(`Import dinámico no resoluble: ${id}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
