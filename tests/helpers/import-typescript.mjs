import { readFile } from 'node:fs/promises';
import ts from 'typescript';

/** Test the production module without starting esbuild or a compiler process. */
export async function importTypeScript(url) {
  const source = await readFile(url, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: url.pathname,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: { before: [context => root => ts.visitNode(root, function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
        return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
          context.factory.createStringLiteral(new URL(node.moduleSpecifier.text, url).href), node.attributes);
      }
      return ts.visitEachChild(node, visit, context);
    })] },
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputText).toString('base64'));
}
