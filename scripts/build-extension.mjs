/** The paired browser extension stays on the exact loopback port of its edition. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEdition } from './package-editions.mjs';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['background.js', 'popup.js', 'popup.html', 'popup.css', 'manifest.json'];

export async function editionExtension(edition, sourceDir = path.join(projectRoot, 'extension')) {
  edition = validateEdition(edition);
  const port = edition === 'developer' ? 39182 : 39181;
  const files = Object.fromEntries(await Promise.all(FILES.map(async name => [name, await readFile(path.join(sourceDir, name), 'utf8')])));
  const base = /^const BASE = 'http:\/\/127\.0\.0\.1:3918[12]';/;
  if (!base.test(files['background.js'])) throw new Error('Extension base URL changed; update the edition builder before shipping.');
  files['background.js'] = files['background.js'].replace(base, `const BASE = 'http://127.0.0.1:${port}';`);
  const manifest = JSON.parse(files['manifest.json']);
  manifest.name = `大肥鱼 · 一起看${edition === 'developer' ? '（开发版）' : ''}`;
  manifest.action.default_title = `和大肥鱼一起看这页${edition === 'developer' ? '（开发版）' : ''}`;
  manifest.host_permissions = [`http://127.0.0.1:${port}/*`];
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  files['popup.html'] = files['popup.html'].replaceAll('小鲸', '大肥鱼').replaceAll('（开发版）', '');
  if (edition === 'developer') files['popup.html'] = files['popup.html'].replace('</title>', '（开发版）</title>').replace('</h1>', '（开发版）</h1>');
  return files;
}
export async function writeEditionExtension({ outDir, edition, sourceDir }) {
  const files = await editionExtension(edition, sourceDir);
  const directory = path.join(outDir, 'extension');
  await mkdir(directory, { recursive: true });
  for (const [name, source] of Object.entries(files)) await writeFile(path.join(directory, name), source);
}
