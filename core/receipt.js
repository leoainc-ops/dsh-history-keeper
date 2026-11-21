/**
 * The receipt: one page a person can keep.
 *
 * It says what was mounted, from which vault, in which mode, what happened to every session, how the
 * result was verified and how to take it back. It never contains the passphrase and never contains
 * session content: it is a description of the delivery, not the delivery.
 *
 * @module core/receipt
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * Render a mount report as Markdown.
 * @param {{report: any, vault?: {storeId?: string, deviceName?: string, deviceId?: string}, now?: string}} options
 * @returns {string}
 */
export function buildMountReceipt(options) {
  const { report, vault = null, now = new Date().toISOString() } = options ?? {}
  const plan = report.plan ?? { totals: {} }
  const lines = []
  lines.push('# Recibo de montaje')
  lines.push('')
  lines.push('| | |')
  lines.push('|---|---|')
  lines.push('| Fecha | ' + now + ' |')
  lines.push('| Modo | `' + report.mode + '` |')
  lines.push('| Destino | `' + report.home + '` |')
  if (vault?.storeId) lines.push('| Bóveda | `' + vault.storeId + '`' + (vault.deviceName ? ' · ' + vault.deviceName : '') + ' |')
  lines.push('| Sesiones en el plan | ' + (plan.totals.sessions ?? 0) + ' |')
  lines.push('')

  lines.push('## Resultado')
  lines.push('')
  lines.push('| Sesión | Acción | Bytes | cwd |')
  lines.push('|---|---|---|---|')
  const byId = new Map((report.plan?.sessions ?? []).map((session) => [session.sessionId, session]))
  const rows = new Map()
  for (const item of report.created ?? []) rows.set(item.sessionId, 'escrita')
  for (const item of report.published ?? []) rows.set(item.sessionId, 'publicada')
  for (const item of report.identical ?? []) if (!rows.has(item)) rows.set(item, 'idéntica')
  for (const item of report.refused ?? []) rows.set(item, 'rechazada')
  for (const item of report.skipped ?? []) rows.set(item.sessionId, 'salteada (' + item.why + ')')
  for (const item of report.failed ?? []) rows.set(item.sessionId, 'falló (' + (item.code ?? '?') + ')')

  for (const [sessionId, action] of rows) {
    const entry = byId.get(sessionId) ?? {}
    lines.push('| `' + String(sessionId).slice(0, 24) + '…` | ' + action + ' | ' + humanBytes(entry.bytes ?? 0) + ' | `' + (entry.cwd ?? '-') + '`' + (entry.translated ? ' *(traducido)*' : '') + ' |')
  }
  lines.push('')

  const seals = (report.published ?? []).filter((item) => item.sealMatched !== null)
  if (seals.length > 0) {
    const matched = seals.filter((item) => item.sealMatched === true).length
    lines.push('## Verificación')
    lines.push('')
    lines.push('Sello de contenido: **' + matched + ' de ' + seals.length + '** publicadas coinciden con el original.')
    lines.push('')
  }

  lines.push('## Cómo deshacer')
  lines.push('')
  lines.push('```')
  lines.push('keeper mount --undo')
  lines.push('```')
  lines.push('')
  lines.push('Borra sólo las sesiones que este montaje creó, y las desagrupa si las había agrupado.')
  lines.push('')
  lines.push('## Aviso')
  lines.push('')
  lines.push('En modo `uso`, DSH escribe el log y el historial queda en claro en el `home`. La bóveda conserva el original cifrado y verificable.')
  return lines.join('\n') + '\n'
}

/** Write the receipt next to the home, one file per mount. */
export function writeReceipt(home, text, stamp = null) {
  const dir = path.join(home, 'history-keeper-receipts')
  fs.mkdirSync(dir, { recursive: true })
  const name = 'mount-' + (stamp ?? new Date().toISOString().replace(/[:.]/gu, '-')) + '.md'
  const file = path.join(dir, name)
  fs.writeFileSync(file, text, 'utf8')
  return file
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MiB'
}
