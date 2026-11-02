import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const RECOVERY_PROTOCOL = 1;
const bootId = randomUUID();
export function bridgeHost(config = {}) {
  const rawHome = String(process.env.DSH_HOME || config.dshHome || join(homedir(), '.dsh'));
  const expanded = rawHome.replace(/^~(?=$|[\\/])/, homedir());
  const home = resolve(expanded).replaceAll('\\', '/');
  const normalized = process.platform === 'win32' ? home.toLowerCase() : home;
  const index = process.argv.indexOf('--port');
  const argumentPort = process.argv.find(value => value.startsWith('--port='))?.slice(7) || (index >= 0 ? process.argv[index + 1] : undefined);
  const requestedPort = argumentPort || config.hostPort;
  const port = Number.isInteger(Number(requestedPort)) && Number(requestedPort) > 0 && Number(requestedPort) <= 65535 ? Number(requestedPort) : null;
  return { bridgeId: bootId, pid: process.pid,
    homeFingerprint: createHash('sha256').update(normalized).digest('hex'),
    profile: String(process.env.DSH_PROFILE || 'web').slice(0, 80),
    port, portSource: port === null ? 'unknown' : argumentPort ? 'command-line' : 'configuration',
    installationId: typeof config.installationId === 'string' ? config.installationId.slice(0, 100) : '' };
}

/** Inspect the host's real tool registry; an MCP probe alone is not host registration. */
export async function registeredAvatarTools(ctx, sessionId) {
  const registry = ctx.tools;
  let agent;
  try { agent = sessionId ? (ctx.agents || ctx.get?.('agents'))?.get?.(sessionId) : undefined; } catch {}
  const scopes = agent ? [undefined, agent] : [undefined];
  let queried = false; const names = new Set();
  for (const scope of scopes) {
    try {
      const result = typeof registry?.schemas === 'function' ? await registry.schemas(scope)
        : typeof registry?.definitions === 'function' ? await registry.definitions(scope) : null;
      if (Array.isArray(result)) { queried = true; for (const tool of result) { const name = tool?.name || tool?.schema?.name; if (typeof name === 'string') names.add(name); } }
    } catch { /* Host startup may not have initialized the registry yet. */ }
  }
  const has = id => [...names].some(name => name === id || name.endsWith('__' + id));
  if (has('avatar_reply') && has('avatar_capabilities')) return true;
  // An empty global registry may hide scoped tools in rc.2. Do not report a
  // broken installation until the actual companion Agent scope was inspected.
  return queried && agent ? false : null;
}

/** Genuine read-only protocol discovery. Does not invoke an avatar or model tool. */
export async function probeCompanionMcp({ baseUrl, token, signal, timeoutMs = 5000 }) {
  const client = new Client({ name: 'deepseek-harness-recovery', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl.replace(/\/$/, '') + '/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-L2D-Client-Id': 'dsh-live2d' } },
  });
  let timer, abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => reject(Object.assign(Error('Recovery cancelled'), { code: 'RECOVERY_CANCELLED' }));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(Object.assign(Error('MCP discovery timed out'), { code: 'MCP_DISCOVERY_TIMEOUT' })), timeoutMs);
    if (signal?.aborted) abort();
  });
  try {
    return await Promise.race([(async () => {
      await client.connect(transport);
      const result = await client.listTools();
      const names = new Set(result.tools.map(tool => tool.name));
      if (!['avatar_capabilities', 'avatar_speak', 'avatar_reply'].every(name => names.has(name))) return { mcpReachable: false, recoveryError: 'MCP_TOOLS_MISSING' };
      return { mcpReachable: true, recoveryError: null };
    })(), interrupted]);
  } catch (error) {
    return { mcpReachable: false, recoveryError: error.code === 'RECOVERY_CANCELLED' ? 'RECOVERY_CANCELLED' : error.code === 'MCP_DISCOVERY_TIMEOUT' ? error.code : 'MCP_DISCOVERY_FAILED' };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    await transport.close().catch(() => {}); await client.close().catch(() => {});
  }
}
