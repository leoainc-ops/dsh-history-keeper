/**
 * Grouping: put the published session where the host expects it.
 *
 * A session that exists but belongs to no workspace is "inside but invisible". The registry is the
 * only thing that makes it visible, and `attachSession` is the only supported way to add it. This
 * module does that, idempotently, and says exactly what it could not do instead of failing silently.
 *
 * @module host/workspaces
 */

/**
 * Resolve or create the workspace for a working directory and attach the session to it.
 *
 * @param {{workspaceRegistry: any, sessionId: string, cwd: string|null, title?: string}} options
 * @returns {Promise<{status: 'attached'|'already-attached'|'created-and-attached'|'no-cwd'|'unavailable'|'failed',
 *          workspaceId?: string, workspacePath?: string, created?: boolean, code?: string, message?: string}>}
 */
export async function attachToWorkspace(options) {
  const { workspaceRegistry, sessionId, cwd = null, title = null } = options ?? {}
  if (!workspaceRegistry || typeof workspaceRegistry.resolveByPath !== 'function') {
    return { status: 'unavailable', code: 'NO_WORKSPACE_REGISTRY', message: 'the host exposes no workspace registry: the session will stay ungrouped' }
  }
  if (!cwd) {
    return { status: 'no-cwd', code: 'NO_CWD', message: 'the session declares no working directory to attach to' }
  }

  let workspace
  let created = false
  try {
    workspace = await workspaceRegistry.resolveByPath(cwd)
  } catch (error) {
    // The registry refuses paths that do not exist: that is a destination problem, not a crash.
    return { status: 'no-cwd', code: 'CWD_UNRESOLVED', message: error?.message ?? String(error) }
  }

  if (!workspace) {
    if (typeof workspaceRegistry.create !== 'function') {
      return { status: 'failed', code: 'CREATE_UNAVAILABLE', message: 'the registry cannot create the workspace ' + cwd }
    }
    try {
      workspace = await workspaceRegistry.create(cwd, title ?? undefined)
      created = true
    } catch (error) {
      return { status: 'failed', code: 'WORKSPACE_CREATE_FAILED', message: error?.message ?? String(error) }
    }
  }

  const workspaceId = workspace?.id ?? null
  const already = Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId)
  if (already) return { status: 'already-attached', workspaceId, workspacePath: cwd, created }

  if (typeof workspace?.attachSession !== 'function') {
    return { status: 'failed', code: 'ATTACH_UNAVAILABLE', message: 'the workspace exposes no attachSession' }
  }
  try {
    await workspace.attachSession(sessionId)
  } catch (error) {
    // A second attach of the same session is not an error worth propagating.
    if (isAlreadyAttached(error)) return { status: 'already-attached', workspaceId, workspacePath: cwd, created }
    return { status: 'failed', code: 'ATTACH_FAILED', message: error?.message ?? String(error), workspaceId }
  }
  return { status: created ? 'created-and-attached' : 'attached', workspaceId, workspacePath: cwd, created }
}

function isAlreadyAttached(error) {
  const message = String(error?.message ?? '')
  return /already (attached|accounted|belongs)/i.test(message) || /includes?/i.test(message)
}

/**
 * Undo an attach: take the session out of its workspace, leaving the session itself alone.
 *
 * `undo` deletes the files it created; the registry entry is a separate effect and deserves its own
 * operation, because a session can be published without being grouped.
 * @param {{workspaceRegistry: any, sessionId: string, cwd: string|null}} options
 */
export async function detachFromWorkspace(options) {
  const { workspaceRegistry, sessionId, cwd = null } = options ?? {}
  if (!workspaceRegistry || typeof workspaceRegistry.resolveByPath !== 'function') {
    return { status: 'unavailable', code: 'NO_WORKSPACE_REGISTRY' }
  }
  if (!cwd) return { status: 'no-cwd', code: 'NO_CWD' }
  let workspace
  try {
    workspace = await workspaceRegistry.resolveByPath(cwd)
  } catch (error) {
    return { status: 'no-cwd', code: 'CWD_UNRESOLVED', message: error?.message ?? String(error) }
  }
  if (!workspace) return { status: 'not-found' }
  if (typeof workspace.detachSession !== 'function') {
    return { status: 'failed', code: 'DETACH_UNAVAILABLE', message: 'the workspace exposes no detachSession' }
  }
  try {
    await workspace.detachSession(sessionId)
    return { status: 'detached', workspaceId: workspace.id ?? null }
  } catch (error) {
    if (/not (attached|accounted)|does not include/i.test(String(error?.message ?? ''))) {
      return { status: 'already-detached', workspaceId: workspace.id ?? null }
    }
    return { status: 'failed', code: 'DETACH_FAILED', message: error?.message ?? String(error) }
  }
}
