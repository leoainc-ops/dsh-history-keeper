/**
 * Extract one conversation from the vault as plain text.
 *
 * This is the one operation that deliberately produces an unprotected file. It is therefore
 * narrow and explicit:
 *  - the destination is required (`--out`), the file is never overwritten, and it is written with
 *    the owner's permissions only;
 *  - a path inside the vault, the session tree or the attachment tree is refused: plaintext does
 *    not belong next to what it was extracted from;
 *  - the secret gate runs over the result; if it matches, nothing is written unless the operator
 *    says `--force` (the report names the rules);
 *  - the file says what it is in its first line.
 *
 * Two formats: `readable` (Markdown transcript) and `jsonl` (the decompressed log, one event per
 * line, which is the faithful content of the session file).
 */
import fs from 'node:fs'
import path from 'node:path'

import { decodePayload } from './payload.js'
import { renderSession } from './render.js'
import { scanText } from './secrets.js'
import { collectSessions } from './verify.js'

/**
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{sessionId: string, out: string, format?: 'readable'|'jsonl', force?: boolean,
 *          maxToolChars?: number, includeReasoning?: boolean}} options
 */
export function extractSession(store, options) {
  const { sessionId, out, format = 'readable', force = false, maxToolChars, includeReasoning } = options
  if (!sessionId) throw new Error('extract needs a session id')
  if (!out) throw new Error('extract needs --out <file>: plaintext is only written where you say')

  const target = path.resolve(out)
  const vault = path.resolve(store.dir)
  const home = path.dirname(vault)
  for (const forbidden of [vault, path.join(home, 'sessions'), path.join(home, 'attachments')]) {
    if (target === forbidden || target.startsWith(forbidden + path.sep)) {
      throw new Error('refusing to write plaintext inside ' + forbidden + ': choose a path outside the vault and the host tree')
    }
  }
  if (fs.existsSync(target) && !force) {
    throw new Error('the file already exists: ' + target + ' (choose another name, or --force to replace it)')
  }

  const { sessions } = collectSessions(store)
  const session = sessions.get(sessionId)
  if (!session) throw new Error('no such session in the vault: ' + sessionId)

  let text
  let stats = null
  if (format === 'jsonl') {
    const decoded = decodePayload(session.buffer)
    if (!decoded.ok) throw new Error('the session cannot be decoded: ' + decoded.failed)
    text = decoded.text
  } else if (format === 'raw') {
    // The exact bytes the host wrote: this file can go back into sessions/ as it is.
    text = session.buffer
  } else if (format === 'readable') {
    const rendered = renderSession(session.buffer, { maxToolChars, includeReasoning })
    if (!rendered.ok) throw new Error('the session cannot be rendered: ' + rendered.error)
    text = rendered.text
    stats = rendered.stats
  } else {
    throw new Error("format must be 'readable', 'jsonl' or 'raw'")
  }

  // For a raw copy the bytes are the host's compressed log; scan what it contains, not the
  // compressed form, so the gate is not bypassed by choosing raw.
  const scannable = format === 'raw' ? decodePayload(session.buffer).text : text
  const matches = scanText(scannable, {})
  const rules = [...new Set(matches.map((match) => match.rule))]
  if (rules.length > 0 && !force) {
    throw new Error(
      'the extraction contains what looks like a credential (' + rules.join(', ') + '); nothing was written. Use --force if you are sure it is safe',
    )
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  // A human-facing copy carries a BOM: Notepad and Excel on Windows then read it as UTF-8.
  // The jsonl copy does not: it is machine-facing and must stay byte-comparable.
  const body = format === 'readable' ? '\uFEFF' + text : text
  fs.writeFileSync(target, body, { mode: 0o600 })
  const isBuffer = Buffer.isBuffer(text)
  return {
    kind: 'keeper-extract',
    version: 1,
    createdAt: new Date().toISOString(),
    sessionId,
    format,
    out: target,
    bytes: isBuffer ? text.length : Buffer.byteLength(text),
    lines: isBuffer ? null : text.split('\n').length,
    stats,
    secretRules: rules,
    replaced: false,
  }
}
