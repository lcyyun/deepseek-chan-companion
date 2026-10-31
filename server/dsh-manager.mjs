import { randomUUID } from 'node:crypto';
import { makeMessages, normalizeReply } from './protocol.mjs';

export function createDshManager(onChange = () => {}) {
  let connection = null, info = null;
  const pending = new Map();
  const fail = (message, code = 'DSH_CHAT_NOT_CONNECTED', status = 409) => Object.assign(new Error(message), { code, status });
  function register(ws, metadata) {
    if (connection && connection !== ws && connection.readyState === 1) throw fail('已有DSH聊天桥连接，请先关闭旧桥。', 'DSH_BRIDGE_CONFLICT');
    connection = ws;
    info = { connected: true, sessionId: String(metadata.sessionId || ''), searchAvailable: metadata.searchAvailable === true };
    ws.send(JSON.stringify({ type: 'bridge-ready', name: 'dsh' }));
    onChange();
  }
  function disconnected(ws) {
    if (connection !== ws) return;
    connection = null; info = null;
    for (const entry of pending.values()) entry.finish(fail('DSH聊天桥已断开。请重新启动桥接插件。', 'DSH_BRIDGE_DISCONNECTED', 502));
    onChange();
  }
  function result(ws, message) {
    if (ws !== connection) return;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    if (message.type === 'chat-progress') { entry.onProgress?.({ stage: message.stage || 'thinking' }); return; }
    if (message.type !== 'chat-result') return;
    if (message.error) return entry.finish(fail('DSH未完成回复。请在Harness中检查模型配置、会话状态或权限提示。', String(message.code || 'DSH_CHAT_FAILED').slice(0, 80), 502));
    try {
      const reply = normalizeReply(message.reply);
      const searchUsed = message.searchUsed === true;
      entry.finish(null, { ...reply, sources: searchUsed ? reply.sources : [], provider: 'dsh', searchAvailable: info?.searchAvailable === true, searchAttempted: message.searchAttempted === true, searchUsed });
    } catch (err) { entry.finish(err); }
  }
  function chat({ settings, request, history, signal, onProgress }) {
    if (!connection || connection.readyState !== 1) throw fail('DSH聊天桥未连接。请按agent-integration文档启动配套插件，或选择Codex/API。');
    const { messages } = makeMessages({ ...request, verbosity: request.verbosity || settings.verbosity, history });
    const searchAllowed = info?.searchAvailable === true && settings.webSearch;
    messages[0].content += searchAllowed ? '\n只允许使用桥接插件已授权的网页检索工具。不允许执行Shell、读写本地文件或调用角色工具。' : '\n当前没有授权网页检索工具。不要声称已经搜索，sources必须为空数组。禁止调用其他工具。';
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(fail('请求已取消。', 'CANCELLED', 499));
      const socket = connection;
      const abort = () => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'chat-cancel', requestId })); finish(fail('请求已取消。', 'CANCELLED', 499)); };
      const finish = (err, reply) => { if (!pending.has(requestId)) return; pending.delete(requestId); signal?.removeEventListener('abort', abort); err ? reject(err) : resolve(reply); };
      pending.set(requestId, { finish, onProgress });
      signal?.addEventListener('abort', abort, { once: true });
      socket.send(JSON.stringify({ type: 'chat-request', requestId, messages, searchAllowed }));
    });
  }
  return { register, disconnected, result, chat, state: () => info || { connected: false, searchAvailable: false } };
}
