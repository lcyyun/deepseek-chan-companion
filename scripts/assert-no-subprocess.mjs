/** Optional build/test guard: node --import ./scripts/assert-no-subprocess.mjs ... */
import childProcess from 'node:child_process';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
const denied = () => { throw Object.assign(new Error('This verification forbids subprocesses and workers.'), { code: 'SUBPROCESS_FORBIDDEN' }); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = denied;
childProcess.ChildProcess.prototype.spawn = denied;
workerThreads.Worker = class { constructor() { denied(); } };
syncBuiltinESMExports();
