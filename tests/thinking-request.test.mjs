import test from 'node:test';
import assert from 'node:assert/strict';
import { thinkingRequestForCommand } from '../src/shared/thinking-request.mjs';

test('bridge thinking status never replaces an in-flight chat request id', () => {
  const bridgeStatus = { type: 'state', state: 'thinking', id: 'command-id-from-bridge' };
  assert.equal(thinkingRequestForCommand(bridgeStatus, null), null);
  assert.equal(thinkingRequestForCommand(bridgeStatus, 'chat-request-1'), 'chat-request-1');
  assert.notEqual(thinkingRequestForCommand(bridgeStatus, 'chat-request-1'), 'command-id-from-bridge');
});

test('explicit request ids still select their own chat turn', () => {
  assert.equal(thinkingRequestForCommand({ type: 'state', state: 'thinking', requestId: 'chat-request-2' }, 'chat-request-1'), 'chat-request-2');
  assert.equal(thinkingRequestForCommand({ type: 'state', state: 'idle', requestId: 'ignored' }, 'chat-request-1'), undefined);
  assert.equal(thinkingRequestForCommand(null, 'chat-request-1'), undefined);
});
