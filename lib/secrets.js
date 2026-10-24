/**
 * Secret gate.
 *
 * `snapshot` refuses to publish a session whose new bytes look like they contain a
 * credential. It does not rewrite anything: rewriting would break the byte-for-byte
 * promise, so the unit of protection is quarantine — the session stays local and
 * unpublished until the operator decides.
 *
 * The payload is a concatenation of Zstandard frames, so scanning the stored bytes would
 * be useless. This module decompresses the frames of the bytes being published and scans
 * the resulting JSONL text.
 *
 * Honest limitation: these rules catch structured secrets (tokens, key assignments,
 * private key blocks). A password written in prose — which is how real leaks usually
 * happen — is not detectable by pattern. The gate is a safety net, not a guarantee.
 */
import { decodePayload } from './payload.js'

/**
 * Values that announce themselves as placeholders. A fixture such as
 * `PASSPHRASE = 'chain-cache-test-passphrase'` is not a leaked credential, and quarantining a
 * session because the agent wrote a test constant destroys trust in the gate.
 */
const BENIGN = /(?:test|example|dummy|fake|sample|placeholder|redacted|changeme|xxxx)/iu

/** @param {string} value @returns {boolean} true when the value is not treated as a secret */
function benign(value) {
  return BENIGN.test(value)
}

/**
 * Rules are intentionally high-precision: a false positive quarantines a legitimate
 * session and erodes trust in the gate faster than a missed token.
 */
export const RULES = Object.freeze([
  {
    id: 'openai-key',
    description: 'OpenAI-style API key',
    test: (line) => {
      const match = /\bsk-([A-Za-z0-9_-]{20,})\b/u.exec(line)
      return match !== null && !benign(match[1])
    },
  },
  { id: 'github-token', description: 'GitHub token', test: (line) => /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u.test(line) },
  { id: 'github-pat', description: 'GitHub fine-grained token', test: (line) => /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u.test(line) },
  { id: 'aws-key', description: 'AWS access key id', test: (line) => /\bAKIA[0-9A-Z]{16}\b/u.test(line) },
  { id: 'private-key', description: 'PEM private key block', test: (line) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(line) },
  {
    id: 'bearer',
    description: 'Bearer token',
    test: (line) => {
      const match = /\bBearer\s+([A-Za-z0-9._-]{20,})/iu.exec(line)
      return match !== null && !benign(match[1])
    },
  },
  {
    id: 'secret-assignment',
    description: 'Assignment of a secret-looking value',
    test: (line) => {
      const match = /(?:api[_-]?key|apikey|secret|token|passphrase|password)\s*[:=]\s*["']?([A-Za-z0-9_\-./+]{16,})/iu.exec(line)
      return match !== null && !benign(match[1])
    },
  },
  {
    id: 'npm-token',
    description: 'npm token',
    test: (line) => /\bnpm_[A-Za-z0-9]{36}\b/u.test(line),
  },
])

/** Optional rule: long high-entropy runs. Off by default (base64 tool output trips it). */
export const ENTROPY_RULE = Object.freeze({
  id: 'high-entropy',
  description: 'Long high-entropy token',
  test: (line) => {
    for (const candidate of line.match(/[A-Za-z0-9+/=_-]{40,}/gu) ?? []) {
      const counts = new Map()
      for (const char of candidate) counts.set(char, (counts.get(char) ?? 0) + 1)
      let entropy = 0
      for (const count of counts.values()) {
        const p = count / candidate.length
        entropy -= p * Math.log2(p)
      }
      if (entropy >= 4.3) return true
    }
    return false
  },
})

/**
 * Rules that are active for a scan.
 * @param {{allow?: string[], entropy?: boolean}} [options] `allow` disables rule ids
 * @returns {Array<{id: string, description: string, test: (line: string) => boolean}>}
 */
export function activeRules(options = {}) {
  const allow = new Set(options.allow ?? [])
  const rules = RULES.filter((rule) => !allow.has(rule.id))
  if (options.entropy) rules.push(ENTROPY_RULE)
  return rules
}

/**
 * Scan a piece of text, reporting where it matched without ever returning the value.
 * @param {string} text
 * @param {{allow?: string[], entropy?: boolean}} [options]
 * @returns {Array<{rule: string, line: number}>}
 */
export function scanText(text, options = {}) {
  const rules = activeRules(options)
  if (rules.length === 0) return []
  const matches = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.length === 0) continue
    for (const rule of rules) {
      if (rule.test(line)) {
        matches.push({ rule: rule.id, line: index + 1 })
        break
      }
    }
  }
  return matches
}

/**
 * Scan the bytes that are about to be published: decompress the frames, scan the text.
 * @param {Buffer} buffer frame-aligned bytes from a session log
 * @param {{allow?: string[], entropy?: boolean}} [options]
 * @returns {{ok: boolean, matches: Array<{rule: string, line: number}>, failed: string|null}}
 */
export function scanPayload(buffer, options = {}) {
  const decoded = decodePayload(buffer)
  if (!decoded.ok) return { ok: false, matches: [], failed: decoded.failed }
  const matches = scanText(decoded.text, options)
  return { ok: matches.length === 0, matches, failed: null }
}
