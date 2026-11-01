/** Reduce untrusted CLI output to known diagnostic categories. No raw log leaves this module. */
export function codexFailureDetails(text = '', exitCode = null, signal = null) {
  const sample = String(text).slice(-16000);
  const denied = /access.{0,8}denied|permission.{0,8}denied|\bEACCES\b|\bEPERM\b|拒绝访问|权限不足|os error (?:5|13)\b/i.test(sample);
  const initialize = /failed to initialize|initializ(?:e|ation).{0,60}(?:failed|error)|in-process app-server/i.test(sample);
  const cleanup = /clean up stale arg0|(?:temp|temporary).{0,50}(?:clean|directory)/i.test(sample);
  const osErrors = [...new Set([...sample.matchAll(/os error (\d{1,5})/gi)].map(match => Number(match[1])))].slice(0, 3);
  let code = 'CODEX_EXEC_FAILED', message = 'Codex运行未生成有效回复。请查看运行环境、模型配置或网络。';
  let diagnostic = '未获得有效助手回复';
  if (denied) {
    code = 'CODEX_PERMISSION_DENIED';
    message = initialize ? 'Codex进程初始化被拒绝访问。请检查当前作业的进程权限和临时目录访问权限。' : 'Codex运行被拒绝访问。请检查当前作业的进程权限和临时目录访问权限。';
    diagnostic = [initialize ? '进程内 app-server 初始化失败' : '进程或文件访问失败', cleanup ? '临时目录清理失败' : '', '拒绝访问'].filter(Boolean).join('；');
  } else if (/model_not_found|model.{0,80}not supported/i.test(sample)) {
    code = 'CODEX_MODEL_UNAVAILABLE'; message = 'Codex模型不可用。请在设置中选择当前账户支持的模型。'; diagnostic = '模型不存在或不受支持';
  } else if (/newer version|upgrade.{0,40}codex/i.test(sample)) {
    code = 'CODEX_UPGRADE_REQUIRED'; message = '当前模型需要更新版本的Codex CLI。请更新运行时后重试。'; diagnostic = '运行时版本不兼容';
  } else if (/not logged|unauthori[sz]ed|\b401\b|authentication|login.{0,30}(?:fail|expir|required)/i.test(sample)) {
    code = 'CODEX_AUTH_REQUIRED'; message = 'Codex登录不可用。请在同一用户环境完成codex login后重试。'; diagnostic = '认证失败';
  } else if (/quota|usage limit|rate.limit|\b429\b/i.test(sample)) {
    code = 'CODEX_RATE_LIMITED'; message = 'Codex额度或请求频率受限，请稍后重试。'; diagnostic = '额度或请求频率限制';
  } else if (/output.schema|schema.{0,30}invalid|invalid.{0,30}schema/i.test(sample)) {
    code = 'CODEX_SCHEMA_REJECTED'; message = 'Codex拒绝了结构化输出格式。请检查运行时版本。'; diagnostic = '输出格式校验失败';
  } else if (initialize) {
    code = 'CODEX_INIT_FAILED'; message = 'Codex进程初始化失败。请检查当前运行环境与CLI版本。'; diagnostic = '进程内 app-server 初始化失败';
  } else if (/network|connect|timeout|timed out|ENOTFOUND|ECONNREFUSED/i.test(sample)) {
    code = 'CODEX_NETWORK_ERROR'; message = 'Codex无法连接模型服务，请检查网络。'; diagnostic = '连接失败或超时';
  }
  if (osErrors.length) diagnostic += `；OS错误号 ${osErrors.join('/')}`;
  const safeSignal = typeof signal === 'string' && /^SIG[A-Z0-9]{1,12}$/.test(signal) ? signal : null;
  const safeExit = Number.isInteger(exitCode) && Math.abs(exitCode) <= 0xffffffff ? exitCode : null;
  if (safeExit !== null) message += `（退出码 ${safeExit}）`;
  if (safeSignal) diagnostic += `；信号 ${safeSignal}`;
  return { code, message, diagnostic, exitCode: safeExit, provider: 'codex' };
}
