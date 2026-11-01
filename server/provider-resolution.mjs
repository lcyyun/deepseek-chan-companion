/** Resolve conversation routing separately from the stateless MCP activity lane. */
export function resolveProvider(settings, { dsh = {}, performance = {} } = {}) {
  const providerSource = settings.providerSource === 'user' ? 'user' : 'auto';
  const dshReady = dsh.connected === true && dsh.chatAvailable === true;
  const remembered = settings.autoProvider === 'dsh' || dsh.everConnected === true;
  let providerEffective = providerSource === 'user' ? settings.provider : 'unconfigured';
  let providerReason = providerSource === 'user' ? 'user-choice' : 'awaiting-provider';
  if (providerSource === 'auto') {
    if (dshReady) { providerEffective = 'dsh'; providerReason = 'dsh-chat-connected'; }
    else if (dsh.connected) { providerEffective = 'dsh'; providerReason = 'dsh-chat-unavailable'; }
    else if (remembered) { providerEffective = 'dsh'; providerReason = 'dsh-remembered'; }
    else if (performance.dshConnected) { providerEffective = 'dsh'; providerReason = 'dsh-performance-only'; }
  }
  if (!['api', 'codex', 'dsh'].includes(providerEffective)) providerEffective = 'unconfigured';
  let chatAvailable = false, chatStatus = 'unconfigured';
  let chatMessage = '尚未连接对话来源。等待 DSH 聊天桥接入，或手动选择对话来源。';
  if (providerEffective === 'dsh') {
    if (dshReady) {
      chatAvailable = true; chatStatus = 'ready';
      const performanceLabel = performance.connected ? '已连接'
        : performance.registered || performance.dshConnected ? '已接入（空闲）' : '尚未连接';
      chatMessage = `当前由 DSH 提供对话；MCP 表演通道${performanceLabel}。`;
    } else if (dsh.connected) {
      chatStatus = 'bridge-disabled'; chatMessage = 'DSH 聊天桥尚未就绪。请启用 chat: true 并检查 Session Controller。';
    } else if (remembered || dsh.reconnecting) {
      chatStatus = 'disconnected'; chatMessage = 'DSH 已断线，正在等待聊天桥重连…';
    } else if (performance.dshConnected) {
      chatStatus = 'bridge-disabled'; chatMessage = 'DSH 表演已连接，聊天桥未启用。请在桥配置中启用 chat: true。';
    } else {
      chatStatus = 'disconnected'; chatMessage = 'DSH 聊天桥未连接。请在桥配置中启用 chat: true。';
    }
  } else if (providerEffective === 'api') {
    chatAvailable = Boolean(settings.baseUrl && settings.model);
    chatStatus = chatAvailable ? 'ready' : 'not-configured';
    chatMessage = chatAvailable ? '当前使用已配置的对话 API。' : '请填写对话 API 地址和模型名称。';
  } else if (providerEffective === 'codex') {
    // Only an explicit selection reaches this branch. Do not launch CLI probes
    // at startup or equate a bundled executable with a usable logged-in model.
    chatAvailable = true; chatStatus = 'ready';
    chatMessage = '当前已手动选择 Codex；发送时使用本机 CLI。';
  }
  return { providerEffective, providerSource, providerReason, chatAvailable, chatStatus, chatMessage };
}
