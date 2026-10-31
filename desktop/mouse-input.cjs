const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');

const run = promisify(execFile);
const SOURCE = path.join(__dirname, 'native', 'MouseButtons.cs');
const EXECUTABLE = path.join(__dirname, 'native', 'MouseButtons.exe');
const failure = (code, message) => Object.assign(new Error(message), { code });
async function exists(file) { try { return (await fs.stat(file)).isFile(); } catch { return false; } }

async function ensureMouseInput({ outputPath = EXECUTABLE, sourcePath = SOURCE, force = false } = {}) {
  if (process.platform !== 'win32') throw failure('MOUSE_PLATFORM_UNSUPPORTED', '全局鼠标状态仅支持 Windows。');
  const source = path.resolve(sourcePath), output = path.resolve(outputPath);
  const sourceStat = await fs.stat(source).catch(() => { throw failure('MOUSE_SOURCE_MISSING', '鼠标输入辅助程序源文件缺失，请重新安装桌宠。'); });
  if (!force && await exists(output) && (await fs.stat(output)).mtimeMs >= sourceStat.mtimeMs) return { path: output, compiled: false };
  const windows = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = ['Framework64', 'Framework'].map(folder => path.join(windows, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe'));
  let compiler;
  for (const candidate of candidates) if (await exists(candidate)) { compiler = candidate; break; }
  if (!compiler) throw failure('MOUSE_COMPILER_MISSING', '缺少鼠标辅助程序及 .NET Framework 编译器；全局按住跟随暂不可用。');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = path.join(path.dirname(output), `.MouseButtons-${randomUUID()}.exe`);
  try {
    await run(compiler, ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+', `/out:${temporary}`, source], {
      windowsHide: true, shell: false, timeout: 30000, maxBuffer: 128 * 1024,
    });
    await fs.rename(temporary, output);
    return { path: output, compiled: true };
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') throw failure('MOUSE_BUILD_LOCKED', '无法更新鼠标辅助程序，请关闭正在运行的桌宠后重试。');
    throw failure('MOUSE_BUILD_FAILED', '鼠标输入辅助程序编译失败；全局按住跟随暂不可用。');
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

/**
 * Only reports the global physical left-button state. Cursor coordinates remain
 * in Electron main, and this module has no service/provider/network connection.
 * stop() is synchronous and immediately releases any previously reported press.
 */
function startMouseInput({ onButton = () => {}, onSample = () => {}, onUnavailable = () => {}, executable, cacheDir, heartbeatTimeoutMs = 3000, spawnImpl = spawn } = {}) {
  let child, timer, killTimer, stopped = false, failed = false, down = false, published = false;
  let buffer = '', lastReceived = 0, lastSequence = -1, resolveReady;
  const timeoutMs = Math.max(250, Number(heartbeatTimeoutMs) || 3000);
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const notify = value => {
    if (published && down === value) return;
    down = value; published = true;
    try { onButton(value); } catch { /* A UI callback must not leave a native observer running. */ }
  };
  const release = () => notify(false);
  function shutdown() {
    clearInterval(timer);
    if (!child) return;
    try { child.stdin.end(); } catch { }
    killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) { try { child.kill(); } catch { } } }, 1200);
    killTimer.unref?.();
  }
  function unavailable(code, message) {
    if (stopped || failed) return;
    failed = true; release(); resolveReady(false); shutdown();
    try { onUnavailable(failure(code, message)); } catch { }
  }
  function stop() {
    if (stopped) return;
    stopped = true; release(); resolveReady(false); shutdown();
  }
  release();
  (async () => {
    if (process.platform !== 'win32') throw failure('MOUSE_PLATFORM_UNSUPPORTED', '全局鼠标状态仅支持 Windows。');
    let file = executable ? path.resolve(executable) : EXECUTABLE;
    if (!executable && !(await exists(file))) {
      const output = path.join(cacheDir || path.join(tmpdir(), 'deepseek-chan-mouse-input'), 'MouseButtons.exe');
      file = (await ensureMouseInput({ outputPath: output })).path;
    }
    if (stopped) return;
    child = spawnImpl(file, ['--parent-pid', String(process.pid)], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    lastReceived = Date.now();
    timer = setInterval(() => {
      if (Date.now() - lastReceived > timeoutMs) unavailable('MOUSE_HEARTBEAT_TIMEOUT', '鼠标状态连接已中断，已停止全局跟随。');
    }, Math.min(250, timeoutMs / 2));
    timer.unref?.();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stopped || failed) return;
      buffer += chunk;
      if (buffer.length > 8192) return unavailable('MOUSE_PROTOCOL_ERROR', '鼠标状态数据异常，已停止全局跟随。');
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { return unavailable('MOUSE_PROTOCOL_ERROR', '鼠标状态数据异常，已停止全局跟随。'); }
        if (!['button', 'heartbeat'].includes(message.type) || message.button !== 'left' || typeof message.down !== 'boolean' || !Number.isSafeInteger(message.seq) || message.seq <= lastSequence) {
          return unavailable('MOUSE_PROTOCOL_ERROR', '鼠标状态数据异常，已停止全局跟随。');
        }
        lastSequence = message.seq; lastReceived = Date.now(); notify(message.down);
        try { onSample({down:message.down,seq:message.seq}); } catch { /* The observer must survive a consumer failure. */ }
        resolveReady(true);
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => unavailable('MOUSE_PIPE_CLOSED', '鼠标状态连接已关闭，已停止全局跟随。'));
    child.on('error', () => unavailable('MOUSE_HELPER_UNAVAILABLE', '无法启动鼠标状态辅助程序，全局按住跟随暂不可用。'));
    child.on('exit', () => { clearTimeout(killTimer); unavailable('MOUSE_HELPER_EXITED', '鼠标状态辅助程序已退出，已停止全局跟随。'); });
  })().catch(error => unavailable(error.code || 'MOUSE_HELPER_UNAVAILABLE', error.code ? error.message : '鼠标状态辅助程序不可用，全局按住跟随暂不可用。'));
  return { stop, ready };
}

module.exports = { startMouseInput, ensureMouseInput };
