import test from 'node:test';
import assert from 'node:assert/strict';
import { chatErrorMessage } from '../src/shared/chat-error-message.mjs';

test('DSH errors and credential/cancellation cases never leak a Codex login suggestion', () => {
  for (const code of ['DSH_CHAT_NOT_CONNECTED', 'DSH_BRIDGE_DISCONNECTED', 'MISSING_CREDENTIAL', 'CANCELLED', 'CODEX_EXEC_FAILED']) {
    const message = chatErrorMessage({ code, message: 'Codex未生成有效回复，请检查CLI登录状态。' }, 'dsh');
    assert.doesNotMatch(message, /codex|CLI/i);
    assert.match(message, /DSH/);
  }
  assert.match(chatErrorMessage({ code: 'MISSING_CREDENTIAL' }, 'dsh'), /模型.*凭据/);
  assert.match(chatErrorMessage({ code: 'DSH_BRIDGE_DISCONNECTED' }, 'dsh'), /重连/);
});

test('explicit Codex retains useful safe diagnostics while other sources suppress cross-provider codes', () => {
  const message = 'Codex 初始化失败：权限不足（退出码 1）。';
  assert.equal(chatErrorMessage({ code: 'CODEX_EXEC_FAILED', message }, 'codex'), message);
  assert.doesNotMatch(chatErrorMessage({ code: 'CODEX_NOT_FOUND', message }, 'api'), /Codex/);
  assert.doesNotMatch(chatErrorMessage({ code: 'CODEX_NOT_FOUND', message }, 'unconfigured'), /Codex/);
});
