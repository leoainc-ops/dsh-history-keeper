/**
 * Render a session log as readable text.
 *
 * The vault stores the host's bytes; this module only *presents* them. It never fails on an event
 * it does not know: it lists it, because a transcript with a gap is worse than one with a note.
 * It is also versioned by the plugin build: when the host adds event types, the renderer grows and
 * old renders keep their meaning.
 *
 * Output is Markdown on purpose: readable in Notepad, and still greppable.
 */
import { decodePayload } from './payload.js'
import { PLUGIN_VERSION } from './version.js'

const WHEN = (ms) =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '?'

/** Text of a message's content array (text parts only). */
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n\n')
}

/** Reasoning parts of an assistant message, if any. */
function reasoningOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part && (part.type === 'reasoning' || part.type === 'thinking') && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n\n')
}

/** Tool calls embedded in an assistant message. */
function callsOf(content) {
  if (!Array.isArray(content)) return []
  return content.filter((part) => part && part.type === 'tool-call')
}

/**
 * @param {Buffer} buffer the session file as the host wrote it
 * @param {{maxToolChars?: number, includeReasoning?: boolean}} [options]
 * @returns {{ok: boolean, text: string, error?: string, stats: any}}
 */
export function renderSession(buffer, options = {}) {
  const { maxToolChars = 2_000, includeReasoning = true } = options
  const decoded = decodePayload(buffer)
  if (!decoded.ok) return { ok: false, text: '', error: decoded.failed, stats: null }

  const truncate = (value) => {
    const text = String(value ?? '')
    return text.length > maxToolChars ? text.slice(0, maxToolChars) + '\n…[' + (text.length - maxToolChars) + ' more characters]' : text
  }

  const body = []
  const unknown = new Set()
  let header = null
  let title = null
  let systemChars = 0
  let turns = 0
  let users = 0
  let assistants = 0
  let toolCalls = 0
  let toolResults = 0
  const seenCalls = new Set()

  for (const line of decoded.text.split('\n')) {
    if (line.length === 0) continue
    let doc
    try {
      doc = JSON.parse(line)
    } catch {
      continue
    }
    const rows = doc.type === 'batch' && Array.isArray(doc.rows) ? doc.rows : [doc]
    for (const row of rows) {
      const data = row.data ?? {}
      switch (row.type) {
        case 'session':
          header = row
          break
        case 'session/title':
          if (typeof data.title === 'string' && data.title.length > 0) title = data.title
          break
        case 'system/message':
          systemChars += textOf(data.message?.content).length
          break
        case 'turn/start':
          turns += 1
          body.push('')
          body.push('## Turn ' + (data.turn ?? turns) + ' — ' + WHEN(row.time))
          break
        case 'turn/end':
        case 'step/start':
        case 'step/end':
          break
        case 'user/message': {
          users += 1
          body.push('')
          body.push('### user — ' + WHEN(row.time))
          body.push(textOf(data.content))
          break
        }
        case 'assistant/message': {
          assistants += 1
          const message = data.message ?? {}
          const content = message.content ?? []
          body.push('')
          body.push('### assistant — ' + WHEN(row.time))
          const text = textOf(content)
          if (text) body.push(text)
          for (const call of callsOf(content)) {
            const callId = call.id ?? null
            if (callId && seenCalls.has(callId)) continue
            if (callId) seenCalls.add(callId)
            toolCalls += 1
            body.push('- tool call: ' + (call.name ?? '?') + ' ' + truncate(call.arguments ?? ''))
          }
          const reasoning = includeReasoning ? reasoningOf(content) : ''
          if (reasoning) body.push('', '<details><summary>reasoning</summary>', '', truncate(reasoning), '', '</details>')
          break
        }
        case 'tool/call':
          if (data.callId && seenCalls.has(data.callId)) break
          if (data.callId) seenCalls.add(data.callId)
          toolCalls += 1
          body.push('- tool call: ' + (data.name ?? '?') + ' ' + truncate(data.arguments ?? ''))
          break
        case 'tool/result': {
          toolResults += 1
          const message = data.message ?? {}
          const text = textOf(message.content)
          body.push('- tool result' + (message.isError ? ' (error)' : '') + ': ' + truncate(text))
          break
        }
        default:
          unknown.add(row.type)
      }
    }
  }

  const preamble = ['# PLAINTEXT COPY — not protected by the vault', '']
  if (header) {
    preamble.push('- session: ' + header.id)
    preamble.push('- workspace: ' + (header.cwd ?? '(none)'))
    preamble.push('- created: ' + WHEN(header.createdAt))
    preamble.push('- log format: v' + (header.version ?? '?'))
  }
  if (title) {
    preamble.push('- title: ' + title)
  }
  if (systemChars > 0) {
    preamble.push('- system prompt: ' + systemChars + ' characters (not included)')
  }
  if (header) {
  }
  preamble.push('- rendered: ' + new Date().toISOString().slice(0, 19) + ' by keeper ' + PLUGIN_VERSION)
  if (unknown.size > 0) preamble.push('- event types not rendered: ' + [...unknown].sort().join(', '))

  const text = [...preamble, ...body].join('\n') + '\n'
  return {
    ok: true,
    text,
    stats: { turns, users, assistants, toolCalls, toolResults, title, systemChars, unknown: [...unknown].sort(), bytes: Buffer.byteLength(text) },
  }
}
