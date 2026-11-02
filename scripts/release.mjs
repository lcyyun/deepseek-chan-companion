/** Export only a generated portable app. ZIP entries carry data, not NTFS ACLs. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Zip, ZipDeflate } from 'fflate';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markerName = '.companion-package.json';
const privateDirectories = new Set([
  '.git', '.codegraph', '.local', '.dsh', '.codex', 'dsh-backup',
  'deepseek-chan-data', 'userdata', 'user-data', 'profiles', 'sessions',
  'cache', 'caches', 'gpucache', 'code cache', 'logs', 'models',
]);
const privateFiles = new Set([
  'bridge-token', 'settings.json', 'desktop.json', 'secrets.json', 'auth.json',
  'credentials.json', 'cookies', 'cookies-journal', 'login data', 'web data',
]);

/** Kept pure so CI can exercise privacy/path rules without launching a shell. */
export function rejectedReleasePath(relative) {
  if (!relative || relative.includes('\\') || relative.startsWith('/') || relative.includes(':') || /[\x00-\x1f]/.test(relative)) return 'invalid relative path';
  const parts = relative.toLowerCase().split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return 'invalid path component';
  if (parts.some((part, index) => privateDirectories.has(part) && !/^resources\/app\/node_modules\/hono\/dist\/(?:(?:cjs|types)\/)?middleware\/cache$/.test(parts.slice(0, index + 1).join('/')))) return 'user data or cache directory';
  const name = parts.at(-1);
  if (privateFiles.has(name) || (name.startsWith('.env') && name !== '.env.example')) return 'private settings or credentials';
  if (/\.(?:moc3|cmo3|psd|zip|7z|rar|pem|key|pfx|log)$/i.test(name) || /\.(?:model3|motion3|exp3|physics3|vtube)\.json$/i.test(name)) return 'model, source archive, credential, or log file';
  return null;
}

export function assertReleaseChild(parent, candidate) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error(`Path is outside the release directory: ${candidate}`);
  return candidate;
}

export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Bounded memory, no child processes, no executable/script-policy dependency. */
export async function writeReleaseZip(source, supplement, manifest, destination) {
  if (manifest.bytes > 3.9 * 1024 ** 3 || manifest.files.length > 60000) throw new Error('This exporter supports ZIP32 packages below 3.9 GiB and 60,000 entries.');
  const entries = [...manifest.files, { path: 'release-manifest.json' }];
  const output = await open(destination, 'wx');
  const chunks = [];
  let failure, complete = false;
  const zip = new Zip((error, chunk, final) => { if (error) failure = error; else chunks.push(chunk); complete ||= final; });
  async function flush() {
    if (failure) throw failure;
    while (chunks.length) {
      const chunk = chunks.shift();
      let offset = 0;
      while (offset < chunk.length) offset += (await output.write(chunk, offset, chunk.length - offset)).bytesWritten;
    }
  }
  try {
    for (const entry of entries) {
      if (rejectedReleasePath(entry.path)) throw new Error(`Invalid ZIP entry: ${entry.path}`);
      const supplemental = ['release-manifest.json', 'Install.ps1'].includes(entry.path);
      const sourceFile = path.join(supplemental ? supplement : source, entry.path);
      if ((await lstat(sourceFile)).isSymbolicLink()) throw new Error(`Refusing a ZIP source link: ${entry.path}`);
      const compressed = new ZipDeflate(entry.path, { level: 6 });
      compressed.os = 0;
      compressed.attrs = 0;
      zip.add(compressed);
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of createReadStream(sourceFile, { highWaterMark: 256 * 1024 })) {
        hash.update(chunk);
        bytes += chunk.length;
        compressed.push(chunk, false);
        await flush();
      }
      compressed.push(new Uint8Array(0), true);
      await flush();
      const digest = hash.digest('hex');
      if (entry.sha256 && (digest !== entry.sha256 || bytes !== entry.bytes)) throw new Error(`Package changed during export: ${entry.path}`);
    }
    zip.end();
    await flush();
    if (!complete) throw new Error('ZIP compression did not finish.');
  } finally { zip.terminate(); await output.close(); }
}

export async function collectReleaseFiles(source) {
  const files = [];
  async function visit(directory) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(source, absolute).split(path.sep).join('/');
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`Refusing a symbolic link or junction: ${relative}`);
      if (relative === markerName) continue; // Contains the producer's absolute workspace path.
      if (relative === 'release-manifest.json' || relative === 'Install.ps1') throw new Error(`Reserved release metadata already exists in the package: ${relative}`);
      const reason = rejectedReleasePath(relative);
      if (reason) throw new Error(`Release audit rejected ${relative}: ${reason}`);
      if (metadata.isDirectory()) await visit(absolute);
      else if (metadata.isFile()) files.push({ path: relative, bytes: metadata.size, sha256: await hashFile(absolute) });
      else throw new Error(`Refusing a non-regular file: ${relative}`);
    }
  }
  if ((await lstat(source)).isSymbolicLink()) throw new Error('The package root must not be a symbolic link or junction.');
  await visit(source);
  return files;
}

async function checkedOutputDirectory(releaseRoot, requested) {
  const output = assertReleaseChild(releaseRoot, path.resolve(workspace, requested));
  // Check each existing ancestor before mkdir: never follow a junction outside release/.
  let current = releaseRoot;
  for (const component of path.relative(releaseRoot, output).split(path.sep)) {
    current = path.join(current, component);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Output ancestor is not a regular directory: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(output, { recursive: true });
  assertReleaseChild(releaseRoot, await realpath(output));
  return output;
}

export async function exportRelease(args = process.argv.slice(2)) {
  if (args.some(arg => !/^--(?:out-dir|package-dir)=.+/.test(arg)) || new Set(args.map(arg => arg.split('=')[0])).size !== args.length) throw new Error('Usage: node scripts/release.mjs [--out-dir=release/distributables] [--package-dir=release/DeepSeek-chan-win32-x64]');
  const root = await realpath(workspace);
  const releaseRoot = path.join(root, 'release');
  if ((await lstat(releaseRoot)).isSymbolicLink()) throw new Error('release/ must not be a symbolic link or junction.');
  const source = path.resolve(root, args.find(arg => arg.startsWith('--package-dir='))?.slice('--package-dir='.length) || 'release/DeepSeek-chan-win32-x64');
  assertReleaseChild(releaseRoot, source);
  let sourceAncestor = releaseRoot;
  for (const component of path.relative(releaseRoot, source).split(path.sep)) {
    sourceAncestor = path.join(sourceAncestor, component);
    const info = await lstat(sourceAncestor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Package ancestor is not a regular directory: ${sourceAncestor}`);
  }
  assertReleaseChild(releaseRoot, await realpath(source));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const marker = JSON.parse(await readFile(path.join(source, markerName), 'utf8'));
  const packageInfo = JSON.parse(await readFile(path.join(source, 'package-info.json'), 'utf8'));
  if (marker.package !== pkg.name || marker.version !== pkg.version || path.resolve(marker.workspace) !== root || packageInfo.version !== pkg.version || packageInfo.platform !== 'win32-x64' || packageInfo.modelIncluded !== false) throw new Error('The portable package is stale or was not generated by this workspace. Run npm run package first.');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(pkg.version)) throw new Error('Unsafe package version.');
  const output = await checkedOutputDirectory(releaseRoot, args.find(arg => arg.startsWith('--out-dir='))?.slice('--out-dir='.length) || 'release/distributables');
  if (output === source || output.startsWith(`${source}${path.sep}`)) throw new Error('Release artifacts must be outside the portable package directory.');
  const archiveName = `DeepSeek-chan-${pkg.version}-win32-x64.zip`;
  const checksumName = `${archiveName}.sha256`;
  for (const name of [archiveName, checksumName]) {
    try { await lstat(path.join(output, name)); throw new Error(`Refusing to overwrite an existing release file: ${name}. Use a new --out-dir.`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  console.log('Auditing the portable application and hashing every file...');
  const files = await collectReleaseFiles(source);
  const installer = path.join(root, 'scripts', 'install-release.ps1');
  files.push({ path: 'Install.ps1', bytes: (await lstat(installer)).size, sha256: await hashFile(installer) });
  for (const required of ['DeepSeek-chan.exe', 'resources/app/package.json', 'package-info.json']) if (!files.some(file => file.path === required)) throw new Error(`Required package file is missing: ${required}`);
  const manifest = {
    schemaVersion: 1, package: pkg.name, version: pkg.version, platform: 'win32-x64',
    createdAt: new Date().toISOString(), modelIncluded: false, userDataIncluded: false,
    fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), files,
  };
  const staging = assertReleaseChild(output, path.join(output, `.export-${randomUUID()}`));
  await mkdir(staging);
  try {
    const manifestPath = path.join(staging, 'release-manifest.json');
    const stagedArchive = path.join(staging, archiveName);
    await copyFile(installer, path.join(staging, 'Install.ps1'), constants.COPYFILE_EXCL);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await writeReleaseZip(source, staging, manifest, stagedArchive);
    console.log('Hashing the completed ZIP...');
    const digest = await hashFile(stagedArchive);
    // COPYFILE_EXCL keeps existing files safe even if another export wins the race.
    await copyFile(stagedArchive, path.join(output, archiveName), constants.COPYFILE_EXCL);
    await writeFile(path.join(output, checksumName), `${digest}  ${archiveName}\n`, { flag: 'wx' });
    console.log(`Ready: ${path.join(output, archiveName)}`);
    console.log(`SHA256: ${digest}`);
    console.log(`${files.length} audited files; ${(manifest.bytes / 1024 / 1024).toFixed(1)} MiB before compression. No model, user data, or NTFS ACL metadata included.`);
    return { archive: path.join(output, archiveName), checksum: path.join(output, checksumName), sha256: digest, manifest };
  } finally {
    // This fresh, uniquely named staging directory is the only recursive removal.
    assertReleaseChild(output, staging);
    if ((await lstat(staging)).isSymbolicLink()) throw new Error('Refusing to remove a changed release staging directory.');
    await rm(staging, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  exportRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
}
