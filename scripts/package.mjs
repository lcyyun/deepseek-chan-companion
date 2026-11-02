/** Assemble a portable Windows app using the already-installed Electron runtime. */
import { access, cp, mkdir, mkdtemp, readFile, realpath, readdir, rename, rm, stat, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mouseInput from '../desktop/mouse-input.cjs';

const run = promisify(execFile);
const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const releaseRoot = path.join(root, 'release');
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !arg.startsWith('--out-dir='))) throw new Error('Usage: node scripts/package.mjs [--out-dir=release/candidate]');
const release = args[0] ? path.resolve(root, args[0].slice('--out-dir='.length)) : releaseRoot;
if (release !== releaseRoot) assertInside(releaseRoot, release);
const folderName = 'DeepSeek-chan-win32-x64';
const markerName = '.companion-package.json';
const runtimeSource = path.join(root, 'node_modules', 'electron', 'dist');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const exists = async value => { try { await access(value); return true; } catch { return false; } };

function contained(parent, value) {
  const rel = path.relative(parent, value);
  return Boolean(rel) && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

function assertInside(parent, value) {
  const resolved = path.resolve(value);
  if (!contained(parent, resolved)) throw new Error(`Refusing path outside the intended directory: ${resolved}`);
  return resolved;
}

async function checkedExisting(parent, value) {
  assertInside(parent, value);
  if ((await lstat(value)).isSymbolicLink()) throw new Error(`Refusing a symbolic-link package target: ${value}`);
  const actual = await realpath(value);
  assertInside(parent, actual);
  return actual;
}

async function removeGenerated(value) {
  const actual = await checkedExisting(release, value);
  const marker = JSON.parse(await readFile(path.join(actual, markerName), 'utf8'));
  if (marker.workspace !== root || marker.package !== manifest.name) throw new Error(`Refusing to remove an unrecognized directory: ${actual}`);
  await rm(actual, { recursive: true, force: false });
}

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This packaging command requires Windows x64 and a local Windows x64 Electron installation.');
await checkedExisting(root, runtimeSource);
const executableBytes = await readFile(path.join(runtimeSource, 'electron.exe'));
if (executableBytes[0] !== 0x4d || executableBytes[1] !== 0x5a) throw new Error('The installed Electron executable is not a Windows PE executable.');
const peOffset = executableBytes.readUInt32LE(0x3c);
if (peOffset + 6 > executableBytes.length || executableBytes.readUInt32LE(peOffset) !== 0x00004550 || executableBytes.readUInt16LE(peOffset + 4) !== 0x8664) throw new Error('The installed Electron executable is not Windows x64.');
// Separate candidate builds avoid replacing or deleting a running installation.
await mkdir(releaseRoot, { recursive: true });
await checkedExisting(root, releaseRoot);
let ancestor = releaseRoot;
for (const component of path.relative(releaseRoot, release).split(path.sep).filter(Boolean)) {
  ancestor = path.join(ancestor, component);
  if (await exists(ancestor)) await checkedExisting(releaseRoot, ancestor);
  else await mkdir(ancestor);
}
await checkedExisting(root, release);

console.log('Preparing the Windows mouse-button observer…');
await mouseInput.ensureMouseInput();

console.log('Building the interface using the local Vite installation…');
const buildResult = await run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
if (buildResult.stdout.trim()) console.log(buildResult.stdout.trim());
if (buildResult.stderr.trim()) console.error(buildResult.stderr.trim());

for (const file of ['dist/index.html', 'dist/vendor/live2dcubismcore.min.js', 'dist/vendor/cubism-framework.js', 'dist/vendor/Cubism-Core-LICENSE.md', 'dist/vendor/Cubism-Framework-LICENSE.md', 'dist/vendor/Cubism-Core-RedistributableFiles.txt']) {
  if (!(await exists(path.join(root, file)))) throw new Error(`Required runtime asset is missing: ${file}. Run npm run setup:live2d, then retry.`);
}

const target = assertInside(release, path.join(release, folderName));
const stage = await mkdtemp(path.join(release, '.package-'));
await checkedExisting(release, stage);
const marker = { package: manifest.name, version: manifest.version, workspace: root, createdAt: new Date().toISOString() };
await writeFile(path.join(stage, markerName), JSON.stringify(marker, null, 2));
let published = false;

try {
  console.log('Copying the installed Electron runtime; no runtime download is needed…');
  await cp(runtimeSource, stage, { recursive: true, force: true, filter: source => !path.basename(source).startsWith('default_app.') });
  await rename(path.join(stage, 'electron.exe'), path.join(stage, 'DeepSeek-chan.exe'));
  // Edit only our staged copy. Keep the installed Electron runtime untouched.
  const resourceEditor = await checkedExisting(root, path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'));
  await run(resourceEditor, [path.join(stage, 'DeepSeek-chan.exe'),
    '--set-icon', path.join(root, 'public', 'icons', 'app.ico'),
    '--set-version-string', 'ProductName', '大肥鱼 · DeepSeek-chan',
    '--set-version-string', 'FileDescription', '大肥鱼 · DeepSeek-chan 桌面伙伴',
    '--set-version-string', 'OriginalFilename', 'DeepSeek-chan.exe',
    '--set-version-string', 'InternalName', 'DeepSeek-chan',
    '--set-version-string', 'CompanyName', '',
    '--set-file-version', manifest.version, '--set-product-version', manifest.version,
  ], { cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  const appRoot = path.join(stage, 'resources', 'app');
  await mkdir(appRoot, { recursive: true });

  for (const item of ['desktop', 'server', 'dist', 'extension', 'integrations', 'docs', 'src/shared', 'package.json', 'README.md']) {
    const source = path.join(root, item);
    await checkedExisting(root, source);
    await cp(source, path.join(appRoot, item), { recursive: true, dereference: false });
  }
  await cp(path.join(root, 'README.md'), path.join(stage, 'README.md'));
  await cp(path.join(root, 'docs'), path.join(stage, 'docs'), { recursive: true });

  const nodeModules = await realpath(path.join(root, 'node_modules'));
  const copied = new Map();
  async function resolveDependency(name, from) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error(`Invalid dependency name: ${name}`);
    let cursor = from;
    while (cursor === root || contained(root, cursor)) {
      const candidate = path.join(cursor, 'node_modules', name);
      if (await exists(path.join(candidate, 'package.json'))) {
        const actual = await realpath(candidate);
        assertInside(nodeModules, actual);
        return actual;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    return null;
  }

  async function copyDependency(name, from, optional = false) {
    const source = await resolveDependency(name, from);
    if (!source) {
      if (optional) return;
      throw new Error(`Production dependency ${name} is not installed. Run npm install before packaging.`);
    }
    if (copied.has(source)) return;
    const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
    copied.set(source, { name: pkg.name, version: pkg.version });
    const destination = path.join(appRoot, 'node_modules', path.relative(nodeModules, source));
    assertInside(appRoot, destination);
    // Copy package files; nested dependencies are copied through the closure below.
    await cp(source, destination, {
      recursive: true, dereference: true,
      filter: candidate => candidate === source || !path.relative(source, candidate).split(path.sep).includes('node_modules'),
    });
    for (const dependency of Object.keys(pkg.dependencies ?? {})) await copyDependency(dependency, source, Object.hasOwn(pkg.optionalDependencies ?? {}, dependency));
    for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) await copyDependency(dependency, source, true);
    for (const dependency of Object.keys(pkg.peerDependencies ?? {})) await copyDependency(dependency, source, pkg.peerDependenciesMeta?.[dependency]?.optional === true);
  }
  for (const dependency of Object.keys(manifest.dependencies ?? {})) await copyDependency(dependency, root);
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) await copyDependency(dependency, root, true);

  let totalBytes = 0, fileCount = 0;
  async function audit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in output: ${file}`);
      if (entry.isDirectory()) await audit(file);
      else {
        if (/\.(?:moc3|cmo3|psd|zip)$/i.test(entry.name) || /\.(?:model3|motion3|exp3|physics3|vtube)\.json$/i.test(entry.name)) throw new Error(`A model/source archive must not be included in the package: ${file}`);
        totalBytes += (await stat(file)).size;
        fileCount += 1;
      }
    }
  }
  await audit(stage);
  // Import only; this does not call createService or open any Electron windows.
  const smokeCode = `await import(${JSON.stringify(pathToFileURL(path.join(appRoot, 'server', 'index.mjs')).href)}); await import(${JSON.stringify(pathToFileURL(path.join(appRoot, 'src', 'shared', 'model-tuning.mjs')).href)}); console.log('Packaged server and model tuning imports OK');`;
  const check = await run(process.execPath, ['--input-type=module', '-e', smokeCode], { cwd: appRoot, windowsHide: true, maxBuffer: 1024 * 1024 });
  console.log(check.stdout.trim());
  let codexVersion;
  if (manifest.dependencies?.['@openai/codex']) {
    const codex = path.join(appRoot, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    if (!(await exists(codex))) throw new Error('The Codex Windows x64 native optional dependency is missing from the package.');
    const version = await run(codex, ['--version'], { cwd: appRoot, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
    codexVersion = version.stdout.trim();
    if (!codexVersion) throw new Error('The bundled Codex executable did not return its version.');
    console.log(`Bundled native CLI: ${codexVersion}`);
  }
  await writeFile(path.join(stage, 'package-info.json'), JSON.stringify({ version: manifest.version, platform: 'win32-x64', createdAt: marker.createdAt, fileCount, bytes: totalBytes, codexVersion, productionPackages: [...copied.values()].sort((a, b) => a.name.localeCompare(b.name)), modelIncluded: false }, null, 2));

  let previous;
  if (await exists(target)) {
    await checkedExisting(release, target);
    const oldMarker = JSON.parse(await readFile(path.join(target, markerName), 'utf8'));
    if (oldMarker.workspace !== root || oldMarker.package !== manifest.name) throw new Error(`Existing output is not a package generated by this workspace: ${target}`);
    previous = assertInside(release, path.join(release, `.previous-${Date.now()}`));
    await rename(target, previous);
  }
  try { await rename(stage, target); published = true; }
  catch (error) { if (previous) await rename(previous, target); throw error; }
  if (previous) await removeGenerated(previous);
  console.log(`Ready: ${path.join(target, 'DeepSeek-chan.exe')}`);
  console.log(`${copied.size} production packages; ${(totalBytes / 1024 / 1024).toFixed(1)} MiB; no model files or SDK source archives included.`);
} finally {
  if (!published && await exists(stage)) await removeGenerated(stage);
}
