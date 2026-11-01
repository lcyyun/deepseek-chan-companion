import { randomUUID } from 'node:crypto';
import { makeMessages, normalizeReply } from './protocol.mjs';

export function createDshManager(onChange = () => {}) {
  let connection = null, info = null, everConnected = false;
  const pending = new Map();
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
    return { connected, chatAvailable: connected && info?.chatAvailable === true,
      everConnected, reconnecting: everConnected && !connected,
      sessionId: info?.sessionId || '', searchAvailable: connected && info?.chatAvailable === true && info?.searchAvailable === true };
  }
  function register(ws, metadata) {
    if (connection && connection !== ws && connection.readyState === 1) throw fail('已有DSH聊天桥连接，请先关闭旧桥。', 'DSH_BRIDGE_CONFLICT');
    connection = ws;
    // Old official bridge versions validate the Session Controller before
    // registering chat:true, so omission remains compatible. Explicit false
    // never advertises chat availability.
    info = { chatAvailable: metadata.chat === true && metadata.sessionControllerAvailable !== false,
      sessionId: String(metadata.sessionId || ''), searchAvailable: metadata.searchAvailable === true };
    if (info.chatAvailable) everConnected = true;
    ws.send(JSON.stringify({ type: 'bridge-ready', name: 'dsh' }));
    onChange();
  }
  function disconnected(ws) {
    if (connection !== ws) return;
    connection = null;
    for (const entry of [...pending.values()]) entry.finish(fail('DSH已断线，正在等待聊天桥重连。', 'DSH_BRIDGE_DISCONNECTED', 502));
    onChange();
  }
  function result(ws, message) {
    if (ws !== connection) return;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    if (message.type === 'chat-progress') { entry.onProgress?.({ stage: message.stage || 'thinking' }); return; }
    if (message.type !== 'chat-result') return;
    if (message.error) return entry.finish(remoteFailure(message));
    try {
      const reply = normalizeReply(message.reply);
      const searchUsed = message.searchUsed === true;
      entry.finish(null, { ...reply, sources: searchUsed ? reply.sources : [], provider: 'dsh', searchAvailable: info?.searchAvailable === true, searchAttempted: message.searchAttempted === true, searchUsed });
    } catch { entry.finish(remoteFailure({ code: 'DSH_INVALID_REPLY' })); }
  }
  function chat({ settings, request, history, signal, onProgress }) {
    if (!state().chatAvailable) throw fail(everConnected ? 'DSH已断线，正在等待聊天桥重连。' : 'DSH聊天桥未启用。请在DeepSeek Harness插件中启用chat: true并确认Session Controller可用。', everConnected ? 'DSH_BRIDGE_DISCONNECTED' : 'DSH_CHAT_NOT_CONNECTED');
    const { messages } = makeMessages({ ...request, verbosity: request.verbosity || settings.verbosity, history });
    const searchAllowed = info?.searchAvailable === true && settings.webSearch;
    messages[0].content += searchAllowed ? '\n只允许使用桥接插件已授权的网页检索工具。不允许执行Shell、读写本地文件或调用角色工具。' : '\n当前没有授权网页检索工具。不要声称已经搜索，sources必须为空数组。禁止调用其他工具。';
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(fail('DSH回合已取消。', 'DSH_TURN_CANCELLED', 499));
      const socket = connection;
      const abort = () => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'chat-cancel', requestId })); finish(fail('DSH回合已取消。', 'DSH_TURN_CANCELLED', 499)); };
      const finish = (err, reply) => { if (!pending.has(requestId)) return; pending.delete(requestId); signal?.removeEventListener('abort', abort); err ? reject(err) : resolve(reply); };
      pending.set(requestId, { finish, onProgress });
      signal?.addEventListener('abort', abort, { once: true });
      socket.send(JSON.stringify({ type: 'chat-request', requestId, messages, searchAllowed }));
    });
  }
  return { register, disconnected, result, chat, state };
}
