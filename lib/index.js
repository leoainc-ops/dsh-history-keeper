/**
 * dsh-history-keeper — plugin entry.
 *
 * Mounts the `/keeper` command and the automatic capture hooks. Mounting never throws:
 * a misconfigured plugin still loads and reports the problem when a command runs, because
 * a plugin that fails inside `apply` disappears from the profile without a trace.
 *
 * Design rules this file must keep honoring as it grows:
 *  - no external binaries (node: only);
 *  - fail closed: never degrade to plaintext, never overwrite a session;
 *  - capture reads the store and writes sealed objects; it never edits a session log;
 *  - restore stays in the CLI, where DSH is closed.
 */
import { mountKeeper } from './plugin.js'

export const name = 'dsh-history-keeper'

export const version = '0.1.0-rc.9'

/** The command registry is the one service this plugin cannot work without. */
export const inject = ['commands']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx host context
 * @param {any} [config] row config from cordis.patch.yml
 */
export function apply(ctx, config) {
  return mountKeeper(ctx, config ?? {})
}
