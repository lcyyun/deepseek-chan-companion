import { randomUUID } from 'node:crypto';
import { makeMessages, normalizeReply, responseBudget } from './protocol.mjs';
import { CHAT_PROTOCOL } from '../integrations/dsh/chat-prompt.mjs';

export function createDshManager(onChange = () => {}, { instanceId = randomUUID() } = {}) {
  let connection = null, info = null, everConnected = false;
  const pending = new Map();
  const recoveries = new Map();
  const cleanHost = host => ({ bridgeId: String(host?.bridgeId || '').slice(0, 100),
    pid: Number.isInteger(host?.pid) && host.pid > 0 ? host.pid : null,
    homeFingerprint: /^[a-f0-9]{64}$/.test(host?.homeFingerprint || '') ? host.homeFingerprint : '',
    profile: String(host?.profile || '').slice(0, 80),
    port: Number.isInteger(host?.port) && host.port > 0 && host.port <= 65535 ? host.port : null,
    portSource: ['command-line', 'configuration'].includes(host?.portSource) ? host.portSource : 'unknown',
    installationId: String(host?.installationId || '').slice(0, 100) });
  const fail = (message, code = 'DSH_CHAT_NOT_CONNECTED', status = 409) => Object.assign(new Error(message), { code, status, provider: 'dsh' });
  const errors = {
    DSH_MODEL_NOT_CONFIGURED: ['DSH模型或凭据未配置。请在DeepSeek Harness中选择模型并配置其凭据。', 409],
    DSH_TURN_CANCELLED: ['DSH回合已取消。', 499],
    DSH_TURN_TIMEOUT: ['DSH回合超时，请稍后重试。', 504],
    DSH_BRIDGE_DISCONNECTED: ['DSH已断线，正在等待聊天桥重连。', 502],
    DSH_CHAT_FAILED: ['DSH未完成回复。请在DeepSeek Harness中检查本回合的模型、会话状态或权限。', 502],
    DSH_INVALID_REPLY: ['DSH返回的回复格式不符合桌宠约定。请检查专用会话的结构化输出。', 502],
  };
  function remoteFailure(message) {
    // A bridge is untrusted input: it cannot inject Codex codes, arbitrary text,
    // credentials or paths into the selected provider's error surface.
    const aliases = { MISSING_CREDENTIAL: 'DSH_MODEL_NOT_CONFIGURED', MISSING_API_KEY: 'DSH_MODEL_NOT_CONFIGURED', MODEL_NOT_CONFIGURED: 'DSH_MODEL_NOT_CONFIGURED', CANCELLED: 'DSH_TURN_CANCELLED', CANCELED: 'DSH_TURN_CANCELLED' };
    const candidate = aliases[message.code] || message.code;
    const code = Object.hasOwn(errors, candidate) ? candidate : 'DSH_CHAT_FAILED';
    const [text, status] = errors[code];
    return fail(text, code, status);
  }
  function state() {
    const connected = Boolean(connection && connection.readyState === 1);
    const supported = info?.recoveryProtocol === 1;
    return { connected, chatAvailable: connected && info?.chatAvailable === true,
      promptProtocol: info?.promptProtocol || 0,
      everConnected, reconnecting: everConnected && !connected,
      recoveryProtocol: supported ? 1 : 0, recoverySupported: supported,
      recoveryStatus: !connected ? 'disconnected' : !supported ? 'upgrade-required' : info.recoveryStatus,
      mcpReachable: connected && info?.mcpReachable === true,
      nativeToolsReady: connected ? info?.nativeToolsReady ?? null : null,
      toolsReady: connected && info?.mcpReachable === true && info?.nativeToolsReady === true,
      toolsCheckedAt: info?.toolsCheckedAt || null, recoveryError: info?.recoveryError || null,
      instanceId, host: info?.host || null, installationId: info?.host?.installationId || '',
      sessionId: info?.sessionId || '', searchAvailable: connected && info?.chatAvailable === true && info?.searchAvailable === true };
  }
  function register(ws, metadata) {
    if (connection && connection !== ws && connection.readyState === 1) throw fail('已有DSH聊天桥连接，请先关闭旧桥。', 'DSH_BRIDGE_CONFLICT');
    connection = ws;
    // Old official bridge versions validate the Session Controller before
    // registering chat:true, so omission remains compatible. Explicit false
    // never advertises chat availability.
    info = { chatAvailable: metadata.chat === true && metadata.sessionControllerAvailable !== false,
      promptProtocol: metadata.promptProtocol === CHAT_PROTOCOL ? CHAT_PROTOCOL : 0, nativeMode: metadata.nativeMode === true,
      recoveryProtocol: metadata.recoveryProtocol === 1 ? 1 : 0, recoveryStatus: 'checking',
      mcpReachable: false, nativeToolsReady: null, host: cleanHost(metadata.host),
      sessionId: String(metadata.sessionId || ''), searchAvailable: metadata.searchAvailable === true };
    if (info.chatAvailable) everConnected = true;
    ws.send(JSON.stringify({ type: 'bridge-ready', name: 'dsh', instanceId, recoveryProtocol: 1 }));
    onChange();
  }
  function disconnected(ws) {
    if (connection !== ws) return;
    connection = null;
    for (const entry of recoveries.values()) { clearTimeout(entry.timer); entry.resolve({ ...state(), ok: false, message: 'DSH 聊天桥已断开，等待重连。' }); }
    recoveries.clear();
    for (const entry of [...pending.values()]) entry.finish(fail('DSH已断线，正在等待聊天桥重连。', 'DSH_BRIDGE_DISCONNECTED', 502));
    onChange();
  }
  function result(ws, message) {
    if (ws !== connection) return;
    if (message.type === 'bridge-health') {
      if (info && info.recoveryProtocol === 1 && message.instanceId === instanceId) {
        if (typeof message.nativeToolsReady === 'boolean' || message.nativeToolsReady === null) info.nativeToolsReady = message.nativeToolsReady;
        if (typeof message.sessionId === 'string' && message.sessionId) info.sessionId = message.sessionId.slice(0, 200);
        if (info.recoveryStatus !== 'checking') info.recoveryStatus = info.mcpReachable && info.nativeToolsReady === true ? 'ready' : 'partial';
        onChange();
      }
      return;
    }
    if (message.type === 'bridge-recovery') {
      if (!info || info.recoveryProtocol !== 1 || message.instanceId !== instanceId) return;
      // Discard results from a timed-out explicit request; unsolicited startup
      // recovery has no request ID and belongs to this authenticated socket.
      if (message.requestId && !recoveries.has(message.requestId)) return;
      info.mcpReachable = message.mcpReachable === true;
      info.nativeToolsReady = typeof message.nativeToolsReady === 'boolean' ? message.nativeToolsReady : null;
      info.toolsCheckedAt = Date.now();
      info.recoveryError = ['MCP_TOOLS_MISSING','MCP_DISCOVERY_TIMEOUT','MCP_DISCOVERY_FAILED','RECOVERY_CANCELLED'].includes(message.recoveryError) ? message.recoveryError : null;
      info.recoveryStatus = info.mcpReachable && info.nativeToolsReady === true ? 'ready' : 'partial';
      onChange();
      const entry = recoveries.get(message.requestId);
      if (entry) { recoveries.delete(message.requestId); clearTimeout(entry.timer); entry.resolve(recoveryResult()); }
      return;
    }
    const entry = pending.get(message.requestId);
    if (!entry) return;
    if (message.type === 'chat-progress') { entry.onProgress?.({ stage: message.stage || 'thinking' }); return; }
    if (message.type !== 'chat-result') return;
    if (message.error) return entry.finish(remoteFailure(message));
    try {
      const reply = normalizeReply(message.nativeMode === true
        ? { segments: [{ text: String(message.reply || '……'), intent: 'neutral', emotion: 'neutral', gesture: 'none', bodyAnimation: 'none', combination: 'none' }], details: '', sources: [], nativePerformed: message.nativePerformed === true }
        : message.reply);
      const searchUsed = message.searchUsed === true;
      entry.finish(null, { ...reply, nativeMode: message.nativeMode === true, sources: searchUsed ? reply.sources : [], provider: 'dsh', searchAvailable: info?.searchAvailable === true, searchAttempted: message.searchAttempted === true, searchUsed });
    } catch { entry.finish(remoteFailure({ code: 'DSH_INVALID_REPLY' })); }
  }
  function recoveryResult() {
    const value = state();
    return { ...value, ok: value.toolsReady, requiresUpgrade: value.connected && !value.recoverySupported,
      message: !value.connected ? 'DSH 聊天桥尚未连接，正在等待自动恢复。'
        : !value.recoverySupported ? '当前桥可聊天，但不支持快速恢复；首次更新桥插件后重新加载一次即可。'
        : value.toolsReady ? '聊天桥和角色工具已恢复，可直接使用。'
        : value.mcpReachable ? '桌宠 MCP 通道已确认，DSH 角色工具仍待确认；无需重启桌宠。'
        : '聊天桥已连接，正在确认桌宠 MCP 通道。' };
  }
  function requestRecovery({ timeoutMs = 8000 } = {}) {
    if (!state().connected || !state().recoverySupported) return Promise.resolve(recoveryResult());
    if (recoveries.size) return recoveries.values().next().value.promise;
    const requestId = randomUUID();
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const timer = setTimeout(() => {
      recoveries.delete(requestId);
      if (info) info.recoveryStatus = 'partial';
      onChange(); resolve({ ...recoveryResult(), ok: false, timedOut: true, message: '连接恢复检查超时；不会启动模型或重启 DSH。' });
    }, Math.max(100, Math.min(15000, Number(timeoutMs) || 8000)));
    timer.unref?.(); recoveries.set(requestId, { promise, resolve, timer });
    info.recoveryStatus = 'checking'; onChange();
    connection.send(JSON.stringify({ type: 'bridge-recovery-request', requestId, instanceId, recoveryProtocol: 1 }));
    return promise;
  }
  function chat({ settings, request, signal, onProgress }) {
    if (!state().chatAvailable) throw fail(everConnected ? 'DSH已断线，正在等待聊天桥重连。' : 'DSH聊天桥未启用。请在DeepSeek Harness插件中启用chat: true并确认Session Controller可用。', everConnected ? 'DSH_BRIDGE_DISCONNECTED' : 'DSH_CHAT_NOT_CONNECTED');
    const verbosity = request.verbosity || settings.verbosity;
    const input = { text: request.text, mode: request.mode || 'chat', verbosity,
      budget: responseBudget(request.text, verbosity), ...(request.context ? { context: request.context } : {}) };
    // DSH owns a persistent conversation. Never send the companion's mirrored
    // history, even to an older bridge. New native bridges use their tool schema
    // and a short hidden section instead of the full structured-output catalog.
    const messages = info?.nativeMode && info?.promptProtocol === CHAT_PROTOCOL
      ? [{ role: 'user', content: request.text }]
      : makeMessages({ ...request, verbosity, history: [], ...(info?.promptProtocol === CHAT_PROTOCOL ? { context: undefined } : {}) }).messages;
    const searchAllowed = info?.searchAvailable === true && settings.webSearch;
    if (messages[0].role === 'system') messages[0].content += searchAllowed ? '\n只允许使用桥接插件已授权的网页检索工具。不允许执行Shell、读写本地文件或调用角色工具。' : '\n当前没有授权网页检索工具。不要声称已经搜索，sources必须为空数组。禁止调用其他工具。';
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(fail('DSH回合已取消。', 'DSH_TURN_CANCELLED', 499));
      const socket = connection;
      const abort = () => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'chat-cancel', requestId })); finish(fail('DSH回合已取消。', 'DSH_TURN_CANCELLED', 499)); };
      const finish = (err, reply) => { if (!pending.has(requestId)) return; pending.delete(requestId); signal?.removeEventListener('abort', abort); err ? reject(err) : resolve(reply); };
      pending.set(requestId, { finish, onProgress });
      signal?.addEventListener('abort', abort, { once: true });
      socket.send(JSON.stringify({ type: 'chat-request', requestId, input, messages, searchAllowed, promptProtocol: CHAT_PROTOCOL }));
    });
  }
  return { register, disconnected, result, chat, state, requestRecovery };
}
