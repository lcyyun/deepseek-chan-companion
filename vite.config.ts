import { defineConfig } from 'vite';
import { validateEdition } from './scripts/package-editions.mjs';
import { editionExtension } from './scripts/build-extension.mjs';
const edition = validateEdition(process.env.COMPANION_EDITION);
export default defineConfig({
  base: './', define: { __COMPANION_EDITION__: JSON.stringify(edition) },
  plugins: [{ name: 'companion-edition', async generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'edition.json', source: JSON.stringify({ edition }) });
    for (const [name, source] of Object.entries(await editionExtension(edition))) this.emitFile({ type: 'asset', fileName: `extension/${name}`, source: String(source) });
  } }],
  build: { outDir: 'dist', sourcemap: edition === 'developer', target: 'es2022' }, server: { host: '127.0.0.1' },
});
