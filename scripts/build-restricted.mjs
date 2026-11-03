/** Usage: node scripts/build-restricted.mjs [--edition=user|developer] [--outdir=output/build-check] */
import { buildRenderer } from './build-in-process.mjs';
const args = process.argv.slice(2);
if (args.some(arg => !/^--(?:edition|outdir)=.+$/.test(arg)) || new Set(args.map(arg => arg.split('=')[0])).size !== args.length) throw new Error('Usage: build-restricted.mjs [--edition=user|developer] [--outdir=PATH]');
const result = await buildRenderer({ outDir: args.find(arg => arg.startsWith('--outdir='))?.slice(9), edition: args.find(arg => arg.startsWith('--edition='))?.slice(10) || process.env.COMPANION_EDITION });
console.log(`Restricted renderer build ready: ${result.outDir} (in-process Rollup + TypeScript; no subprocesses)`);
