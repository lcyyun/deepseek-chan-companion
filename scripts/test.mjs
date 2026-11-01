/** Explicit noninteractive CI and desktop test profiles, without a shell launcher. */
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const profile = process.argv[2] || 'ci';
if (!['ci', 'desktop', 'all'].includes(profile)) throw new Error('Usage: node scripts/test.mjs [ci|desktop|all]');
// These tests launch Electron or the .NET mouse observer. Hidden windows still
// require native process access and a Windows user desktop; they are not CI mocks.
const desktop = new Set([
  'desktop-chat-placement.test.mjs', 'desktop-pointer.test.mjs',
  'desktop-provider.test.mjs',
  'desktop-toggle.test.mjs', 'desktop-tuning.test.mjs',
  'expression-menu.test.mjs', 'pet-pointer.test.mjs',
  'speech-body.test.mjs', 'mouse-input-native.test.mjs',
]);
const available = (await readdir(join(root, 'tests'))).filter(file => file.endsWith('.test.mjs')).sort();
for (const file of desktop) if (!available.includes(file)) throw new Error(`Desktop test profile refers to a missing file: ${file}`);
const files = available.filter(file => profile === 'all' || desktop.has(file) === (profile === 'desktop'));
console.log(`Test profile: ${profile}; ${files.length} files; Node ${process.versions.node}`);
if (profile === 'ci') {
  console.log('Desktop checks intentionally excluded (run npm run test:desktop in an interactive Windows session):');
  for (const file of desktop) console.log(`  ${file}`);
  // CI is fail-closed: importing a future test that starts Electron, a compiler,
  // a shell, or a model CLI cannot silently turn this into a desktop-only suite.
  const childProcess = createRequire(import.meta.url)('node:child_process');
  const deny = () => { throw Object.assign(new Error('CI does not allow child processes. Put native desktop checks in the desktop profile or inject a fake transport.'), { code: 'CI_CHILD_PROCESS_FORBIDDEN' }); };
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = deny;
  childProcess.ChildProcess.prototype.spawn = deny;
  syncBuiltinESMExports();
}
// Since Node 22.8, programmatic isolation:none avoids even the test-runner fork.
// Serial execution keeps temporary global audio mocks and fixture state isolated.
const stream = run({ files: files.map(file => join(root, 'tests', file)), isolation: 'none', concurrency: 1 });
stream.on('test:fail', () => { process.exitCode = 1; });
stream.on('error', error => { console.error(error); process.exitCode = 1; });
stream.compose(spec).pipe(process.stdout);
