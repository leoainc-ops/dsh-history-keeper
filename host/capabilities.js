/**
 * What this host exposes to a plugin, and what that allows.
 *
 * Two questions, one probe: **which services exist right now**, and **which delivery mode is
 * therefore possible**. The probe never writes anything and never assumes a version: it asks the
 * injected context, which is the only source of truth about the running host.
 *
 * @module host/capabilities
 */

/** Services the keeper can use if the host injects them. */
export const HOST_SERVICES = [
  'sessionPersistence',
  'workspaceRegistry',
  'attachments',
  'agents',
  'sessions',
  'credentials',
  'commands',
  'userQuestions',
]

/**
 * Ask the host which of the known services exist and what each one can do.
 * @param {{get?: (name: string) => any}} ctx the plugin context
 * @returns {{at: string, runtime: {platform: string, node: string, electron: string|null}, services: Record<string, {present: boolean, methods: string[]}>}}
 */
export function probeHost(ctx) {
  const services = {}
  for (const name of HOST_SERVICES) {
    let service = null
    try {
      service = typeof ctx?.get === 'function' ? ctx.get(name) : null
    } catch {
      service = null
    }
    services[name] = service ? { present: true, methods: methodNames(service) } : { present: false, methods: [] }
  }
  return {
    at: new Date().toISOString(),
    runtime: {
      platform: process.platform,
      node: process.versions.node,
      electron: process.versions.electron ?? null,
    },
    services,
  }
}

/**
 * Decide which delivery modes the host allows.
 *
 * `uso` needs both the session writer and the workspace registry: without them the plugin would be
 * writing files again, which is exactly what 2.0 stops doing.
 * @param {ReturnType<typeof probeHost>} probe
 * @returns {{modes: string[], reason: string}}
 */
export function capabilities(probe) {
  const persistence = probe.services.sessionPersistence?.present === true
  const workspaces = probe.services.workspaceRegistry?.present === true
  if (persistence && workspaces) {
    return { modes: ['archivo', 'uso'], reason: 'the host exposes sessionPersistence and workspaceRegistry' }
  }
  if (persistence) {
    return { modes: ['archivo'], reason: 'sessionPersistence is available but workspaceRegistry is not: sessions would publish without a workspace' }
  }
  return { modes: ['archivo'], reason: 'the host exposes no session writer: only the archived path is possible' }
}

/** Public method names of a service, two levels deep, without internals. */
function methodNames(service) {
  const names = new Set()
  let prototype = service
  let depth = 0
  while (prototype && depth < 2) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor' || name.startsWith('_')) continue
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
      if (typeof descriptor?.value === 'function') names.add(name)
    }
    prototype = Object.getPrototypeOf(prototype)
    depth += 1
    if (prototype === Object.prototype) break
  }
  return [...names].sort()
}
