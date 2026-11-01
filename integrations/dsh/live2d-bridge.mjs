/** Optional DeepSeek Harness Cordis plugin. It observes committed session events only. */
import { mkdir } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { resolveCompanionChatCwd } from './home-paths.mjs';
import { dshWireFailure } from './chat-errors.mjs';

export const name = 'deepseek-chan-bridge';
export const inject = ['sessionController', 'tools'];

export function apply(ctx, config = {}) {
  const baseUrl = String(config.baseUrl || process.env.L2D_BRIDGE_URL || 'http://127.0.0.1:39181').replace(/\/$/, '');
  const token = config.token || process.env.L2D_BRIDGE_TOKEN;
  if (!token) throw new Error('Set L2D_BRIDGE_TOKEN before loading the DeepSeek-chan bridge.');
  const parsed = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.protocol !== 'http:') throw new Error('The Live2D bridge must use a loopback HTTP URL.');
  const active = new Map();
  let lastState = '', lastSession = '', disposed = false;
  const inflight = new Set();
  async function send(state, sessionId = lastSession) {
    if (disposed) return;
    const controller = new AbortController(); inflight.add(controller);
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      await fetch(`${baseUrl}/api/bridge/event`, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ source: 'dsh', sessionId, ...(state ? { state } : {}) }),
      });
    } catch { /* A closed companion must never break the agent's work. */ }
    finally { clearTimeout(timer); inflight.delete(controller); }
  }
  function update(sessionId, state) {
    if (config.sessionId && config.sessionId !== sessionId) return;
    lastSession = sessionId;
    if (state === lastState) return;
    lastState = state;
    void send(state, sessionId);
  }
  ctx.on('session/event', (session, event) => {
    const id = String(session.id);
    if (config.sessionId && config.sessionId !== id) return;
    if (event.type === 'turn/start') { active.set(id, true); update(id, 'thinking'); }
    else if (event.type === 'tool/call') {
      // Do not react to the character's own MCP calls.
      if (/mcp__live2d__|avatar_/i.test(event.data?.name || '')) return;
      update(id, 'thinking');
    } else if (event.type === 'turn/end') {
      active.delete(id);
      const failed = /error|fail/i.test(JSON.stringify(event.data?.reason || ''));
      update(id, active.size ? 'thinking' : failed ? 'error' : 'idle');
    }
  });
  ctx.effect(() => {
    void send();
    const heartbeat = setInterval(() => void send(), 20000);
    heartbeat.unref?.();
    return () => { disposed = true; clearInterval(heartbeat); for (const controller of inflight) controller.abort(); };
  });
  if (config.chat !== false) attachChatBridge(ctx, { ...config, baseUrl, token });
}

/** Host API contract: sessionController.create/prompt/cancel plus committed session/event. */
export function attachChatBridge(ctx, config) {
  if (!ctx.sessionController?.create || !ctx.sessionController?.prompt || !ctx.sessionController?.cancel || !ctx.tools?.guard) throw new Error('This DSH version lacks the required Session Controller or tool guard API. Update DSH or set chat:false.');
  // Bind this bridge to its launch profile before an asynchronous chat arrives.
  // Reusing a session never creates a companion workspace.
  const chatCwd = config.chatSessionId ? undefined : resolveCompanionChatCwd(config);
  const pending = new Map(), turns = new Map(), ownedSessions = new Set();
  let ws, reconnect, disposed = false, sessionPromise;
  const availableTools = new Set((ctx.tools.definitions?.() || []).map(t => t.name || t.schema?.name).filter(Boolean));
  const searchNames = new Set((config.searchTools || []).filter(name => typeof name === 'string' && availableTools.has(name) && !/run_code|shell|exec|write|delete/i.test(name)));
  const send = value => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
  const matching = id => [...pending.values()].find(p => p.sessionId === id);
  // The companion session can only use the exact, explicitly configured web tools.
  // This protects page analysis independently of the model following a prompt.
  ctx.tools.guard(exec => {
    const id = String(exec.agent?.id || '');
    const operation = matching(id);
    if (!operation && !ownedSessions.has(id)) return;
    if (operation?.searchAllowed && searchNames.has(exec.name)) return;
    return 'Desktop companion chat only permits its configured web search tools. Do not run code, access files, modify anything, or call avatar tools; return the requested JSON answer.';
  });
  async function session() {
    if (config.chatSessionId) return String(config.chatSessionId);
    if (!sessionPromise) sessionPromise = (async () => {
      await mkdir(chatCwd, { recursive: true });
      const result = await ctx.sessionController.create({ cwd: chatCwd, ...(config.agentPreset ? { agentPreset: config.agentPreset } : {}) });
      ownedSessions.add(String(result.sessionId));
      return String(result.sessionId);
    })().catch(err => { sessionPromise = null; throw err; });
    return sessionPromise;
  }
  function finish(operation, problem) {
    if (!pending.has(operation.requestId)) return;
    pending.delete(operation.requestId); clearTimeout(operation.timer);
    send({ type: 'chat-result', requestId: operation.requestId, ...(problem ? dshWireFailure(problem) : { reply: operation.text, searchAttempted: operation.searchAttempted, searchUsed: operation.searchUsed }) });
  }
  async function cancel(operation, code = 'DSH_TURN_CANCELLED') {
    operation.failureCode = code;
    operation.controller.abort();
    try { if (operation.sessionId) await ctx.sessionController.cancel({ sessionId: operation.sessionId }); } catch {}
    finish(operation, { code });
  }
  async function receive(message) {
    if (message.type === 'chat-cancel') { const operation = pending.get(message.requestId); if (operation) await cancel(operation); return; }
    if (message.type !== 'chat-request') return;
    const operation = { requestId: message.requestId, controller: new AbortController(), sessionId: '', turn: null, text: '', searchAllowed: message.searchAllowed === true, searchAttempted: false, searchUsed: false, searchCalls: new Set() };
    pending.set(operation.requestId, operation);
    operation.timer = setTimeout(() => void cancel(operation, 'DSH_TURN_TIMEOUT'), 175000); operation.timer.unref?.();
    try {
      operation.sessionId = await session();
      if (operation.controller.signal.aborted) return;
      const prompt = message.messages.map(m => `${String(m.role).toUpperCase()}:\n${m.content}`).join('\n\n');
      // Register pending state before prompt: events can arrive before its acknowledgement.
      await ctx.sessionController.prompt({ requestId: operation.requestId, sessionId: operation.sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }], clientTimeZone: config.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone }, operation.controller.signal);
    } catch (error) { finish(operation, operation.controller.signal.aborted ? { code: operation.failureCode || 'DSH_TURN_CANCELLED' } : error); }
  }
  ctx.on('session/event', (sessionValue, event) => {
    const id = String(sessionValue.id);
    if (event.type === 'turn/start') turns.set(id, event.data.turn);
    const operation = matching(id);
    if (!operation) return;
    if (event.type === 'user/message' && event.data?.source?.rpcId === operation.requestId) operation.turn = turns.get(id);
    if (operation.turn == null || event.data?.turn !== operation.turn) return;
    if (event.type === 'assistant/message' && !event.data.interrupted) {
      const content = event.data.message?.content || [];
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('');
      if (text.trim()) operation.text = text;
    } else if (event.type === 'tool/call' && searchNames.has(event.data.name)) {
      operation.searchCalls.add(event.data.callId); operation.searchAttempted = true;
      send({ type: 'chat-progress', requestId: operation.requestId, stage: 'searching' });
    } else if (event.type === 'tool/result' && operation.searchCalls.has(event.data.message?.toolCallId) && !event.data.message.isError) operation.searchUsed = true;
    else if (event.type === 'turn/end') {
      const reason = JSON.stringify(event.data.reason || '');
      if (/abort|error|fail|cancel|MISSING_CREDENTIAL|MODEL_NOT_CONFIGURED/i.test(reason) || !operation.text) finish(operation, event.data.reason || { code: 'DSH_CHAT_FAILED' });
      else finish(operation);
    }
  });
  ctx.effect(() => {
    function connect() {
      if (disposed) return;
      ws = new WebSocket(config.baseUrl.replace(/^http/, 'ws') + '/events');
      ws.on('open', () => send({ type: 'auth', token: config.token }));
      ws.on('message', raw => {
        let message; try { message = JSON.parse(raw.toString()); } catch { return; }
        if (message.type === 'auth' && message.ok) send({ type: 'bridge-register', name: 'dsh', chat: true, sessionControllerAvailable: true, sessionId: config.chatSessionId || '', searchAvailable: searchNames.size > 0 });
        else void receive(message);
      });
      ws.on('error', () => {});
      ws.on('close', () => {
        for (const operation of [...pending.values()]) void cancel(operation);
        if (!disposed) { reconnect = setTimeout(connect, 3000); reconnect.unref?.(); }
      });
    }
    connect();
    return () => { disposed = true; clearTimeout(reconnect); for (const operation of [...pending.values()]) void cancel(operation); ws?.close(); };
  });
}
