/** Convert host errors to a small wire vocabulary; never send host output or secrets. */
export function dshFailureCode(value) {
  const fields = [value?.code, value?.name, value?.message, value?.error?.code, value?.error?.message,
    value?.cause?.code, value?.cause?.message, value?.reason?.code, value?.reason?.message];
  let serialized = '';
  try { serialized = JSON.stringify(value); } catch {}
  const text = [...fields, typeof value === 'string' ? value : '', serialized].filter(Boolean).join(' ').slice(0, 12000);
  if (/MISSING_CREDENTIAL|MISSING_API_KEY|MODEL_NOT_CONFIGURED|NO_MODEL|MODEL_NOT_FOUND|MODEL_UNAVAILABLE|NO_PROVIDER|API.?KEY.{0,30}(?:missing|required|not configured)|(?:模型|凭据|密钥).{0,20}(?:未配置|未设置|缺失)|no model.{0,20}(?:selected|configured)/i.test(text)) return 'DSH_MODEL_NOT_CONFIGURED';
  if (/AbortError|DSH_TURN_CANCELLED|CANCELLED|CANCELED|\babort(?:ed)?\b|\bcancel(?:led|ed)?\b|已取消/i.test(text)) return 'DSH_TURN_CANCELLED';
  if (/DSH_TURN_TIMEOUT|TIMEOUT|timed out|超时/i.test(text)) return 'DSH_TURN_TIMEOUT';
  if (/DSH_BRIDGE_DISCONNECTED|BRIDGE_DISCONNECTED/i.test(text)) return 'DSH_BRIDGE_DISCONNECTED';
  return 'DSH_CHAT_FAILED';
}

export function dshWireFailure(value) {
  return { error: 'DSH request failed', code: dshFailureCode(value) };
}
