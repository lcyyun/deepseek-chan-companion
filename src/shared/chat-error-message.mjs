/** A late/misrouted backend error must not advertise a different chat provider. */
export function chatErrorMessage(error, provider) {
  const code = String(error?.code || ''), message = String(error?.message || '');
  if (provider === 'dsh') {
    if (['DSH_CHAT_NOT_CONNECTED', 'DSH_CHAT_UNAVAILABLE'].includes(code)) return 'DSH 聊天桥未连接，请在 DSH 插件中启用 chat: true。';
    if (code === 'DSH_BRIDGE_DISCONNECTED') return 'DSH 已断线，正在重连…';
    if (['MISSING_CREDENTIAL', 'DSH_MISSING_CREDENTIAL', 'DSH_MODEL_NOT_CONFIGURED'].includes(code)) return 'DSH 模型尚未配置，请在 DeepSeek Harness 中配置模型和凭据。';
    if (['CANCELLED', 'DSH_CANCELLED', 'DSH_TURN_CANCELLED'].includes(code)) return 'DSH 回合已取消。';
    if (!message || /codex/i.test(message) || /^CODEX_/.test(code)) return 'DSH 未完成回复，请检查聊天桥、模型配置和会话状态。';
    return message;
  }
  if (provider === 'codex') {
    if (/^DSH_/.test(code)) return 'Codex 请求未完成，请检查当前对话连接。';
    return message || 'Codex 请求未完成，请检查设置。';
  }
  if (provider === 'api') return /^CODEX_|^DSH_/.test(code) ? '对话 API 请求未完成，请检查当前接口配置。' : message || '对话 API 暂时不可用。';
  return '尚未连接对话来源，请先完成智能体接入。';
}
