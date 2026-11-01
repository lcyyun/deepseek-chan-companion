import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Match DSH's documented single-home and narrow tilde-expansion semantics,
// without requiring the optional DSH installation in the standalone app.
// https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/util/home-paths
export function resolveCompanionChatCwd(config = {}, { env = process.env, home = homedir(), cwd = process.cwd() } = {}) {
  const optionalPath = (value, field) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') throw new TypeError(`${field} must be a path string.`);
    return value.trim() ? value : undefined;
  };
  const absolute = value => resolve(cwd, value === '~' ? home : /^~[/\\]/.test(value) ? join(home, value.slice(2)) : value);
  const override = optionalPath(config.chatCwd, 'chatCwd');
  if (override !== undefined) return absolute(override);
  const root = optionalPath(config.dshHome, 'dshHome') ?? optionalPath(env.DSH_HOME, 'DSH_HOME') ?? join(home, '.dsh');
  return join(absolute(root), 'live2d-companion');
}
