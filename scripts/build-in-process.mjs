/** Build helpers that never start a process, shell, or worker. */
import { readFile, writeFile, mkdir, cp, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import ts from 'typescript';
import { unzipSync } from 'fflate';
import { validateEdition } from './package-editions.mjs';
import { writeEditionExtension } from './build-extension.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function transpileTypescript(defines = {}) {
  return {
    name: 'in-process-typescript',
    transform(source, id) {
      if (id.includes('\0')) return null;
      // React's browser production exports are CommonJS. No environment shim is
      // shipped to the renderer and no build-time executable is needed.
      if (/\.[cm]?jsx?$/.test(id) && id.includes('node_modules')) {
        return { code: source.replace(/\bprocess\.env\.NODE_ENV\b/g, '"production"'), map: null };
      }
      const hasDefines = Object.keys(defines).some(name => source.includes(name));
      if (!/\.tsx?$/.test(id) && !hasDefines) return null;
      const replaceDefines = context => root => {
        const visit = node => {
          const parent = node.parent;
          const declarationName = parent && (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node;
          return ts.isIdentifier(node) && Object.hasOwn(defines, node.text) && !declarationName
            ? ts.factory.createStringLiteral(defines[node.text]) : ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(root, visit);
      };
      const result = ts.transpileModule(source, { fileName: id, reportDiagnostics: true,
        transformers: hasDefines ? { before: [replaceDefines] } : undefined, compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, sourceMap: true, allowJs: true,
        inlineSources: true, removeComments: false,
      } });
      const errors = result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) || [];
      if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
        getCurrentDirectory: () => projectRoot, getCanonicalFileName: name => name, getNewLine: () => '\n',
      }));
      return { code: result.outputText.replace(/\n\/\/# sourceMappingURL=.*?(?:\r?\n|$)/g, '\n'), map: result.sourceMapText || null };
    },
  };
}

export async function bundleTypescript({ input, entrySource, outfile, css = false, defines = {}, sourcemap = true }) {
  const virtualEntry = '\0in-process-entry';
  const styles = new Map();
  const bundle = await rollup({
    input: entrySource === undefined ? input : virtualEntry,
    plugins: [
      { name: 'inline-entry', resolveId: id => id === virtualEntry ? id : null, load: id => id === virtualEntry ? entrySource : null },
      { name: 'plain-css',
        async load(id) {
          if (!id.endsWith('.css')) return null;
          if (!css) throw new Error(`Unexpected CSS import in SDK build: ${id}`);
          const source = await readFile(id, 'utf8');
          if (/@import\b|url\(/i.test(source)) throw new Error(`Restricted build supports plain CSS only; bundle CSS URLs/imports explicitly: ${id}`);
          styles.set(id, source);
          return { code: '', moduleSideEffects: 'no-treeshake' };
        },
        generateBundle() {
          if (!css) return;
          const visited = new Set(), ordered = [];
          const visit = id => {
            if (visited.has(id)) return;
            visited.add(id);
            for (const dependency of this.getModuleInfo(id)?.importedIds || []) visit(dependency);
            if (styles.has(id)) ordered.push(`/* ${path.relative(projectRoot, id).replaceAll('\\', '/')} */\n${styles.get(id)}`);
          };
          visit(input);
          this.emitFile({ type: 'asset', fileName: path.basename(outfile).replace(/\.js$/, '.css'), source: ordered.join('\n') });
        },
      },
      nodeResolve({ browser: true, preferBuiltins: false, extensions: ['.mjs', '.js', '.json', '.ts', '.tsx'] }),
      transpileTypescript(defines),
      commonjs({ include: /node_modules/ }),
    ],
    onwarn(warning, warn) {
      if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
      // Cubism has intentional type/runtime cycles; Rollup retains them.
      if (warning.code !== 'CIRCULAR_DEPENDENCY') warn(warning);
    },
  });
  try {
    await mkdir(path.dirname(outfile), { recursive: true });
    await bundle.write({ file: outfile, format: 'es', sourcemap, generatedCode: 'es2015' });
  } finally { await bundle.close(); }
}

export async function buildRenderer({ outDir = path.join(projectRoot, 'dist'), edition = process.env.COMPANION_EDITION } = {}) {
  edition = validateEdition(edition);
  outDir = path.resolve(outDir);
  if ([projectRoot, path.join(projectRoot, 'public'), path.join(projectRoot, 'src'), path.join(projectRoot, 'scripts')].some(folder => outDir === folder || folder !== projectRoot && outDir.startsWith(folder + path.sep))) throw new Error('Build output must not overwrite application source directories.');
  const outfile = path.join(outDir, 'assets', 'index-restricted.js');
  await bundleTypescript({ input: path.join(projectRoot, 'src', 'renderer', 'main.tsx'), outfile, css: true,
    defines: { __COMPANION_EDITION__: edition }, sourcemap: edition === 'developer' });
  await cp(path.join(projectRoot, 'public'), outDir, { recursive: true, filter: file => edition === 'developer' || !file.endsWith('.map') });
  await writeFile(path.join(outDir, 'edition.json'), JSON.stringify({ edition }));
  await writeEditionExtension({ outDir, edition });
  const source = await readFile(path.join(projectRoot, 'index.html'), 'utf8');
  if (!source.includes('src="/src/renderer/main.tsx"')) throw new Error('Renderer HTML entry changed; update the restricted build entry.');
  const html = source.replace('href="/icons/', 'href="./icons/')
    .replace('<script type="module" src="/src/renderer/main.tsx"></script>', '<link rel="stylesheet" href="./assets/index-restricted.css"><script type="module" src="./assets/index-restricted.js"></script>');
  await writeFile(path.join(outDir, 'index.html'), html);
  return { outDir, edition, engine: 'rollup-typescript-in-process' };
}

/** Called only after the official SDK archive's SHA-256 has been verified. */
export async function extractSdkZip(bytes, target) {
  let entries = 0, totalSize = 0;
  const files = unzipSync(bytes, { filter: file => {
    if (file.originalSize > 256 * 1024 * 1024) throw new Error('SDK ZIP entry exceeds the extraction limit.');
    totalSize += file.originalSize;
    if (++entries > 20000 || totalSize > 512 * 1024 * 1024) throw new Error('SDK ZIP exceeds the extraction limit.');
    return true;
  } });
  if (Object.keys(files).length > 20000 || Object.values(files).reduce((sum, data) => sum + data.length, 0) > 512 * 1024 * 1024) throw new Error('SDK ZIP exceeds the extraction limit.');
  await mkdir(target, { recursive: true });
  const root = await realpath(target);
  for (const [name, data] of Object.entries(files)) {
    const clean = name.replaceAll('\\', '/');
    if (path.posix.isAbsolute(clean) || /^[A-Za-z]:/.test(clean) || clean.split('/').includes('..')) throw new Error('Unsafe path in SDK ZIP.');
    const destination = path.resolve(root, clean);
    const relative = path.relative(root, destination);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Unsafe path in SDK ZIP.');
    // Never follow pre-existing symlinks/junctions while extracting.
    let cursor = root;
    for (const part of relative.split(path.sep)) {
      cursor = path.join(cursor, part);
      try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('SDK extraction refuses symbolic links.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (clean.endsWith('/')) await mkdir(destination, { recursive: true });
    else { await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, data); }
  }
}
