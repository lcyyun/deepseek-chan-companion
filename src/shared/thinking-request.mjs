/**
 * Resolve which chat request a generic thinking-state command belongs to.
 * Bridge state commands carry their own command id but no chat request id;
 * that id must never replace the id of an in-flight chat request.
 */
export function thinkingRequestForCommand(command, pendingRequestId) {
  if (!command || command.type !== 'state' || command.state !== 'thinking') return undefined;
  if (command.requestId) return String(command.requestId);
  return pendingRequestId ?? null;
}
