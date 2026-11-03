'use strict';
// Development ZIPs contain current sources and hashes, but no Git repository.
// Git metadata is optional for current-source probes; historical baselines must
// explicitly fail instead of silently substituting today's source.
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const NO_GIT_REVISION = 'working-tree/no-git';
function baselineError(cause) {
  return new Error('Historical baseline comparison requires a Git checkout containing the requested revision. Clone the repository and fetch that history, or use --variant=after for the current source.', cause ? { cause } : undefined);
}
function options(root) { return { cwd:root, encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe'], timeout:10000 }; }
function readBenchmarkRevision({ root, variant='after', baselineRef, run=execFileSync, exists=existsSync }={}) {
  if(!exists(path.join(root,'.git'))) {
    if(variant==='baseline')throw baselineError();
    return NO_GIT_REVISION;
  }
  try {
    const revision=run('git',['rev-parse',variant==='baseline'?baselineRef:'HEAD'],options(root)).trim();
    if(!revision)throw new Error('Empty Git revision');
    return revision;
  } catch(cause) {
    if(variant==='baseline')throw baselineError(cause);
    return NO_GIT_REVISION;
  }
}
function readBenchmarkBaseline({ root, baselineRef, file='src/renderer/live2d.ts', run=execFileSync, exists=existsSync }={}) {
  if(!exists(path.join(root,'.git')))throw baselineError();
  try { return run('git',['show',`${baselineRef}:${file}`],options(root)); }
  catch(cause) { throw baselineError(cause); }
}
module.exports={readBenchmarkRevision,readBenchmarkBaseline,NO_GIT_REVISION};
