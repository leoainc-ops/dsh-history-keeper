/**
 * dsh-history-keeper — plugin entry (scaffold).
 *
 * Status: 0.0.1. This release only proves the bundle mounts. The engine
 * (snapshot / verify / restore) lands in the next milestones; see docs/PLAN.md.
 *
 * Design rules this file must keep honoring as it grows:
 *  - no external binaries (node: only)
 *  - fail closed: never degrade to plaintext, never overwrite a session
 *  - never touch a live session log directly; read through the host when available
 */

export const name = 'dsh-history-keeper'

export const version = '0.0.1'

/** No service is required yet: a missing host service must not break boot. */
export const inject = []

/**
 * Mount the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx host context
 */
export function apply(ctx) {
  const dispose = () => {}

  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => dispose)
  }
}
