/** Optional DeepSeek Harness Cordis plugin. It observes committed session events only. */
import { mkdir } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebSocket } from 'ws';
import { resolveCompanionChatCwd } from './home-paths.mjs';
import { dshWireFailure } from './chat-errors.mjs';
import { bridgeHost, probeCompanionMcp, registeredAvatarTools, RECOVERY_PROTOCOL } from './recovery-tools.mjs';
import { CHAT_PROTOCOL, readChatInput, chatRules, chatPageContext } from './chat-prompt.mjs';

export const name = 'deepseek-chan-bridge';
export const inject = ['sessionController', 'tools', 'systemPrompt'];

export function apply(ctx, config = {}) {
  const baseUrl = String(config.baseUrl || process.env.L2D_BRIDGE_URL || 'http://127.0.0.1:39181').replace(/\/$/, '');
  let token = config.token || process.env.L2D_BRIDGE_TOKEN;
  if (!token && config.tokenFile) {
    try { token = readFileSync(String(config.tokenFile), 'utf8').trim(); } catch (error) {
      throw new Error(`Cannot read the DeepSeek-chan bridge token file: ${error.message}`);
    }
  }
  if (!token) throw new Error('Set a bridge token or tokenFile before loading the DeepSeek-chan bridge.');
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.tokenFile ? readFileSync(String(config.tokenFile), 'utf8').trim() : token}` },
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

/** DSH 0.2.1-rc.2: Session Controller, systemPrompt.section and agent inbox admission. */
export function attachChatBridge(ctx, config) {
  if (!ctx.sessionController?.create || !ctx.sessionController?.prompt || !ctx.sessionController?.cancel || !ctx.tools?.guard) throw new Error('This DSH version lacks the required Session Controller or tool guard API. Update DSH or set chat:false.');
  if (!ctx.systemPrompt?.section) throw new Error('This DSH version lacks systemPrompt.section. Update DSH to enable hidden companion instructions, or set chat:false.');
  // Bind this bridge to its launch profile before an asynchronous chat arrives.
  // Reusing a session never creates a companion workspace.
  const chatCwd = config.chatSessionId ? undefined : resolveCompanionChatCwd(config);
  const pending = new Map(), turns = new Map(), ownedSessions = new Set(), activeTurns = new Map(), cancelledInputs = new Map();
  let ws, reconnect, disposed = false, sessionPromise;
  const availableTools = new Set((ctx.tools.definitions?.() || []).map(t => t.name || t.schema?.name).filter(Boolean));
  const searchNames = new Set((config.searchTools || []).filter(name => typeof name === 'string' && availableTools.has(name) && !/run_code|shell|exec|write|delete/i.test(name)));
  const send = (value, socket = ws) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  let knownSessionId = config.chatSessionId || '';
  if (!knownSessionId && config.sessionFile) {
    try { const saved = readFileSync(String(config.sessionFile), 'utf8').trim(); if (/^session-[A-Za-z0-9-]+$/.test(saved)) knownSessionId = saved; } catch {}
  }
  const matching = id => {
    const operation = activeTurns.get(id);
    return operation && pending.get(operation.requestId) === operation && !operation.controller.signal.aborted && operation.turn === turns.get(id) ? operation : undefined;
  };
  // Register once. The host assembles sections before committing user/message;
  // inbox/claimed is its supported admission event at that earlier boundary.
  // A pending queue entry must never modify another turn in the user's session.
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    const requestId = message?.source?.rpcId, id = String(agent?.id || '');
    const operation = pending.get(requestId);
    if (operation?.sessionId === id) { operation.queuedAgent = agent; operation.queuedMessageId = message.id; }
    // Admission can finish after cancellation. Remove exactly that queued item
    // durably, so a later host restart cannot accidentally execute it.
    if (cancelledInputs.get(requestId) === id) {
      try { agent.inbox.remove(message.id); } catch { /* Claim/pre-step race is handled below. */ }
    }
  });
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const operation = pending.get(message?.source?.rpcId);
    const id = String(agent?.id || '');
    if (!operation || operation.sessionId !== id || operation.controller.signal.aborted) return;
    operation.turn = turn;
    activeTurns.set(id, operation);
  });
  ctx.on('agent/inbox/discarded', ({ agent, message }) => {
    const requestId = message?.source?.rpcId;
    if (cancelledInputs.get(requestId) === String(agent?.id || '')) cancelledInputs.delete(requestId);
  });
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    const cancelled = message => cancelledInputs.get(message?.source?.rpcId) === String(agent?.id || '');
    const offered = messages.filter(cancelled);
    if (!offered.length) return decision;
    const filtered = decision.messages.filter(message => !cancelled(message));
    for (const message of offered) cancelledInputs.delete(message.source.rpcId);
    // Do not wake a model with only runtime context after its sole user request
    // was cancelled while queued. Unrelated admitted user input stays intact.
    if (offered.length === messages.length) return { kind: 'reject' };
    return { ...decision, messages: filtered };
  });
  const scoped = context => {
    if (!context.agent || context.scope !== context.agent || context.signal?.aborted) return;
    return matching(String(context.agent.id));
  };
  ctx.systemPrompt.section({ name: 'live2d:chat-rules', order: 11000, interpolate: false,
    text: context => scoped(context)?.rules || '' });
  ctx.systemPrompt.section({ name: 'live2d:page-context', order: 11001, interpolate: false,
    text: context => scoped(context)?.pageContext || '' });
  // The companion session can only use the exact, explicitly configured web tools.
  // This protects page analysis independently of the model following a prompt.
  ctx.tools.guard(exec => {
    const id = String(exec.agent?.id || '');
    const operation = matching(id);
    if (!operation && !ownedSessions.has(id)) return;
    if (operation?.searchAllowed && searchNames.has(exec.name)) return;
    if (config.native === true && /(^|__)avatar_reply$/i.test(String(exec.name || ''))) return;
    return 'Desktop companion chat only permits its configured search tools and, in native mode, avatar_reply. Do not run code, access files, modify anything, or call other avatar tools.';
  });
  async function session() {
    if (config.chatSessionId) return knownSessionId = String(config.chatSessionId);
    if (!sessionPromise) sessionPromise = (async () => {
      if (config.sessionFile) {
        try {
          const saved = readFileSync(String(config.sessionFile), 'utf8').trim();
          if (/^session-[A-Za-z0-9-]+$/.test(saved)) { ownedSessions.add(saved); knownSessionId = saved; return saved; }
        } catch {}
      }
      await mkdir(chatCwd, { recursive: true });
      const result = await ctx.sessionController.create({ cwd: chatCwd, ...(config.agentPreset ? { agentPreset: config.agentPreset } : {}) });
      const id = String(result.sessionId);
      knownSessionId = id;
      ownedSessions.add(id);
      if (config.sessionFile) {
        const file = String(config.sessionFile);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, id, { mode: 0o600 });
      }
      return id;
    })().catch(err => { sessionPromise = null; throw err; });
    return sessionPromise;
  }
  function finish(operation, problem) {
    if (pending.get(operation.requestId) !== operation) return;
    pending.delete(operation.requestId); clearTimeout(operation.timer);
    if (activeTurns.get(operation.sessionId) === operation) activeTurns.delete(operation.sessionId);
    send({ type: 'chat-result', requestId: operation.requestId, ...(problem ? dshWireFailure(problem) : { reply: operation.text, nativeMode: config.native === true, nativePerformed: operation.nativeTool === true, searchAttempted: operation.searchAttempted, searchUsed: operation.searchUsed }) }, operation.socket);
  }
  async function cancel(operation, code = 'DSH_TURN_CANCELLED') {
    const ownsTurn = matching(operation.sessionId) === operation;
    if (operation.submitted && operation.turn == null) cancelledInputs.set(operation.requestId, operation.sessionId);
    operation.failureCode = code;
    operation.controller.abort();
    if (operation.turn == null && operation.queuedAgent) {
      try { operation.queuedAgent.inbox.remove(operation.queuedMessageId); } catch { /* Already claimed: admission filter removes it. */ }
    }
    try { if (ownsTurn) await ctx.sessionController.cancel({ sessionId: operation.sessionId }); } catch {}
    finish(operation, { code });
  }
  async function receive(message) {
    if (message.type === 'chat-cancel') { const operation = pending.get(message.requestId); if (operation) await cancel(operation); return; }
    if (message.type !== 'chat-request') return;
    if (typeof message.requestId !== 'string' || pending.has(message.requestId) || cancelledInputs.has(message.requestId)) return;
    const input = readChatInput(message);
    const operation = { requestId: message.requestId, socket: ws, controller: new AbortController(), sessionId: '', turn: null, text: '', nativeTool: false, searchAllowed: message.searchAllowed === true, searchAttempted: false, searchUsed: false, searchCalls: new Set(), submitted: false };
    operation.rules = chatRules(input, { native: config.native === true, searchAllowed: operation.searchAllowed,
      system: message.messages?.find(m => m.role === 'system')?.content });
    operation.pageContext = chatPageContext(input);
    pending.set(operation.requestId, operation);
    operation.timer = setTimeout(() => void cancel(operation, 'DSH_TURN_TIMEOUT'), 175000); operation.timer.unref?.();
    try {
      operation.sessionId = await session();
      if (operation.controller.signal.aborted) return;
      // Register pending state before prompt: events can arrive before its acknowledgement.
      operation.submitted = true;
      await ctx.sessionController.prompt({ requestId: operation.requestId, sessionId: operation.sessionId, mode: 'queue', content: [{ type: 'text', text: input.text }], clientTimeZone: config.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone }, operation.controller.signal);
    } catch (error) { finish(operation, operation.controller.signal.aborted ? { code: operation.failureCode || 'DSH_TURN_CANCELLED' } : error); }
  }
  ctx.on('session/event', (sessionValue, event) => {
    const id = String(sessionValue.id);
    if (event.type === 'turn/start') turns.set(id, event.data.turn);
    const operation = matching(id);
    if (!operation) return;
    if (operation.turn == null || event.data?.turn !== operation.turn) return;
    if (event.type === 'assistant/message' && !event.data.interrupted) {
      const content = event.data.message?.content || [];
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('');
      if (text.trim()) operation.text = text;
    } else if (event.type === 'tool/call' && /avatar_reply/i.test(String(event.data?.name || ''))) {
      operation.nativeTool = true;
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
    const host = bridgeHost(config);
    let backoff = 500, lifecycle, healthTimer, handshakeTimer;
    const sleep = (ms, signal) => new Promise(resolve => {
      const timer = setTimeout(done, ms);
      function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
      signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done();
    });
    function credential() {
      // A changed local pairing file takes effect on the next connection.
      return config.tokenFile ? readFileSync(String(config.tokenFile), 'utf8').trim() : config.token;
    }
    function connect() {
      if (disposed) return;
      clearTimeout(reconnect);
      lifecycle = new AbortController();
      const signal = lifecycle.signal;
      const socket = ws = new WebSocket(config.baseUrl.replace(/^http/, 'ws') + '/events', { handshakeTimeout: 4000 });
      let instanceId = '', recovery, token = '', pongPending = false;
      function recover(requestId) {
        if (!instanceId || signal.aborted) return;
        if (!recovery) recovery = (async () => {
          const probe = await probeCompanionMcp({ baseUrl: config.baseUrl, token, signal });
          let nativeToolsReady = await registeredAvatarTools(ctx, knownSessionId);
          // MCP plugins may finish loading after the chat bridge. Recheck only
          // the local registry briefly; never wake a model to test tools.
          for (const delay of [250, 500, 1000]) {
            if (nativeToolsReady === true || signal.aborted) break;
            await sleep(delay, signal); nativeToolsReady = await registeredAvatarTools(ctx, knownSessionId);
          }
          return { ...probe, nativeToolsReady, checkedAt: Date.now() };
        })().finally(() => { recovery = null; });
        void recovery.then(value => { if (!signal.aborted) send({ type: 'bridge-recovery', instanceId, ...(requestId ? { requestId } : {}), ...value }, socket); }).catch(() => {});
      }
      socket.on('open', () => {
        try { token = credential(); } catch { socket.close(1008, 'Pairing file unavailable'); return; }
        send({ type: 'auth', token }, socket);
        handshakeTimer = setTimeout(() => socket.terminate(), 5000); handshakeTimer.unref?.();
      });
      socket.on('message', raw => {
        let message; try { message = JSON.parse(raw.toString()); } catch { return; }
        if (message.type === 'auth' && message.ok) {
          instanceId = String(message.instanceId || '');
          send({ type: 'bridge-register', name: 'dsh', chat: true, sessionControllerAvailable: true,
            promptProtocol: CHAT_PROTOCOL, nativeMode: config.native === true,
            sessionId: knownSessionId, searchAvailable: searchNames.size > 0, recoveryProtocol: RECOVERY_PROTOCOL, host }, socket);
        } else if (message.type === 'bridge-ready') {
          clearTimeout(handshakeTimer); backoff = 500;
          instanceId = String(message.instanceId || instanceId);
          recover();
          clearInterval(healthTimer);
          healthTimer = setInterval(() => {
            if (pongPending) { socket.terminate(); return; }
            pongPending = true; send({ type: 'ping' }, socket);
            void registeredAvatarTools(ctx, knownSessionId).then(nativeToolsReady => {
              if (!signal.aborted && instanceId) send({ type: 'bridge-health', instanceId, nativeToolsReady, sessionId: knownSessionId }, socket);
            }).catch(() => {});
          }, 20000); healthTimer.unref?.();
        } else if (message.type === 'bridge-recovery-request' && message.instanceId === instanceId) recover(message.requestId);
        else if (message.type === 'pong') pongPending = false;
        else void receive(message);
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        signal.aborted || lifecycle.abort(); clearTimeout(handshakeTimer); clearInterval(healthTimer);
        if (ws === socket) ws = null;
        for (const operation of [...pending.values()]) if (operation.socket === socket) void cancel(operation);
        if (!disposed) { reconnect = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 5000); reconnect.unref?.(); }
      });
    }
    connect();
    return () => { disposed = true; lifecycle?.abort(); clearTimeout(reconnect); clearTimeout(handshakeTimer); clearInterval(healthTimer); for (const operation of [...pending.values()]) void cancel(operation); ws?.close(); };
  });
}
