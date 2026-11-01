export function thinkingRequestForCommand(
  command: { type?: string; state?: string; requestId?: string } | null | undefined,
  pendingRequestId: string | null,
): string | null | undefined;
