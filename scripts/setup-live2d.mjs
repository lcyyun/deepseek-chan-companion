/** Download the unmodified official Cubism 5 Web R4 SDK for local development. */
import { mkdir, readFile, writeFile, access, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const restricted = args.includes('--restricted');
if (args.some(arg => arg !== '--restricted' && !/^--(?:outdir|cache-dir|archive)=.+/.test(arg))) throw new Error('Usage: setup-live2d.mjs [--restricted] [--outdir=PATH] [--cache-dir=PATH] [--archive=PATH]');
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const vendor = path.resolve(option('cache-dir') || path.join(root, 'vendor'));
const output = path.resolve(option('outdir') || path.join(root, 'public', 'vendor'));
const archive = path.resolve(option('archive') || path.join(vendor, 'CubismSdkForWeb-5-r.4.zip'));
const extracted = path.join(vendor, 'sdk-extract');
const sdk = path.join(extracted, 'CubismSdkForWeb-5-r.4');
const url = 'https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.4.zip';
const expectedHash = 'd78904d908bd232b800219e01732e4ea2f0562b5e9f35a2670742a1c16d22942';
const exists = async (file) => { try { await access(file); return true; } catch { return false; } };

await mkdir(vendor, { recursive: true });
await mkdir(output, { recursive: true });
console.log('Official SDK terms: https://www.live2d.com/en/sdk/download/web/');
if (!(await exists(archive))) {
  console.log('Downloading official Cubism Web R4 SDK…');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SDK download failed: HTTP ${response.status}`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
}
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
if (digest !== expectedHash) throw new Error('SDK archive checksum mismatch. Download was not used.');
if (!(await exists(path.join(sdk, 'Framework', 'src', 'live2dcubismframework.ts')))) {
  await mkdir(extracted, { recursive: true });
  if (restricted) {
    const { extractSdkZip } = await import('./build-in-process.mjs');
    await extractSdkZip(await readFile(archive), extracted);
  } else if (process.platform === 'win32') {
    const { execFileSync } = await import('node:child_process');
    // Fixed workspace paths are passed as PowerShell literals, without shell interpolation.
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extracted)} -Force`], { stdio: 'inherit', windowsHide: true });
  } else {
    const { execFileSync } = await import('node:child_process');
    execFileSync('unzip', ['-q', '-o', archive, '-d', extracted], { stdio: 'inherit' });
  }
}
const exports = {
  'live2dcubismframework': ['CubismFramework', 'Option', 'LogLevel'],
  'model/cubismmoc': ['CubismMoc'],
  'physics/cubismphysics': ['CubismPhysics'],
  'motion/cubismmotion': ['CubismMotion'],
  'motion/cubismmotionmanager': ['CubismMotionManager'],
  'motion/cubismexpressionmotion': ['CubismExpressionMotion'],
  'math/cubismmatrix44': ['CubismMatrix44'],
  'type/csmvector': ['csmVector'],
  'rendering/cubismrenderer_webgl': ['CubismRenderer_WebGL'],
};
const entry = Object.entries(exports).map(([file, symbols]) =>
  `export { ${symbols.join(', ')} } from ${JSON.stringify(path.join(sdk, 'Framework', 'src', `${file}.ts`).replaceAll('\\', '/'))};`).join('\n');
if (restricted) {
  const { bundleTypescript } = await import('./build-in-process.mjs');
  await bundleTypescript({ entrySource: entry, outfile: path.join(output, 'cubism-framework.js') });
} else {
  const { build } = await import('esbuild');
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    outfile: path.join(output, 'cubism-framework.js'), minify: false, legalComments: 'inline' });
}
await copyFile(path.join(sdk, 'Core', 'live2dcubismcore.min.js'), path.join(output, 'live2dcubismcore.min.js'));
await copyFile(path.join(sdk, 'Core', 'LICENSE.md'), path.join(output, 'Cubism-Core-LICENSE.md'));
await copyFile(path.join(sdk, 'Framework', 'LICENSE.md'), path.join(output, 'Cubism-Framework-LICENSE.md'));
await copyFile(path.join(sdk, 'Core', 'RedistributableFiles.txt'), path.join(output, 'Cubism-Core-RedistributableFiles.txt'));
await writeFile(path.join(output, 'sdk-version.json'), JSON.stringify({ version: 'Cubism 5 SDK for Web R4', source: url, archiveSha256: digest }, null, 2));
console.log(`Official Cubism Core and Framework are ready: ${output}${restricted ? ' (in-process; no subprocesses)' : ''}`);
