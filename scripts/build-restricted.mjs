/** Usage: node scripts/build-restricted.mjs [--outdir=output/build-check] */
import { buildRenderer } from './build-in-process.mjs';
const args = process.argv.slice(2);
if (args.some(arg => !arg.startsWith('--outdir='))) throw new Error('Usage: build-restricted.mjs [--outdir=PATH]');
const result = await buildRenderer({ outDir: args.find(arg => arg.startsWith('--outdir='))?.slice(9) });
console.log(`Restricted renderer build ready: ${result.outDir} (in-process Rollup + TypeScript; no subprocesses)`);
