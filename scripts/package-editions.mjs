/** Build/package edition policy. These helpers perform no process or file access. */
export function validateEdition(value, fallback = 'developer') {
  const edition = value === undefined || value === '' ? fallback : value;
  if (!['user', 'developer'].includes(edition)) throw new Error('Edition must be user or developer.');
  return edition;
}

export function parsePackageOptions(args = []) {
  if (args.some(arg => !/^--(?:edition|out-dir)=.+$/.test(arg)) || new Set(args.map(arg => arg.split('=')[0])).size !== args.length)
    throw new Error('Usage: node scripts/package.mjs [--edition=user|developer] [--out-dir=release/PATH]');
  const edition = validateEdition(args.find(arg => arg.startsWith('--edition='))?.slice(10), 'user');
  return { edition, outDir: args.find(arg => arg.startsWith('--out-dir='))?.slice(10) || `release/${edition}` };
}

export const USER_DOCUMENTS = Object.freeze(['user-guide.md', 'audio-sources.md', 'icon-sources.md']);
export const DEVELOPMENT_ROOT_FILES = Object.freeze(['package-lock.json', 'vite.config.ts', 'tsconfig.json', 'index.html', '.gitignore']);
const DEVELOPMENT_SCRIPTS = new Set([
  'assert-no-subprocess.mjs', 'build-in-process.mjs', 'build-restricted.mjs', 'build-extension.mjs', 'create-desktop-shortcut.ps1',
  'install-release.ps1', 'package.mjs', 'package-editions.mjs', 'release.mjs', 'setup-live2d.mjs', 'setup-mouse-input.mjs', 'test.mjs',
]);
export function developmentScriptAllowed(name) {
  return DEVELOPMENT_SCRIPTS.has(name) || /^(?:benchmark|verify)-[a-z0-9-]+\.cjs$/.test(name);
}
export function editionArchiveName(version, edition) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) throw new Error('Unsafe package version.');
  return `DeepSeek-chan-${version}-${validateEdition(edition)}-win32-x64.zip`;
}
export function validatePackageEdition({ marker, packageInfo, appManifest, rendererInfo }) {
  const edition = validateEdition(marker?.edition);
  if (!marker?.edition || packageInfo?.edition !== edition || appManifest?.companionEdition !== edition || rendererInfo?.edition !== edition)
    throw new Error('Package edition metadata does not match the renderer. Rebuild this edition before exporting.');
  return edition;
}
