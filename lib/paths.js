/**
 * The one place that decides where a keeper file lives.
 *
 * Both the plugin, the CLI and the operator scripts used to guess: the plugin defaulted to
 * `<home>/history-keeper`, the scripts to `~/keeper-vault`, and the field scripts to yet another
 * pair. Every mismatch cost a round of debugging. These paths are the contract; nothing else
 * builds a keeper path by hand.
 *
 * Everything hangs from the DSH home, which is already per user:
 *
 *   <home>/history-keeper/                    the vault
 *   <home>/history-keeper.key                 its passphrase
 *   <home>/history-keeper-device.json         which device this machine is
 *   <home>/history-keeper.replaced-<ts>/      a vault this one replaced
 *   <home>/history-keeper.backup-<ts>/        a verified copy, plus .manifest.json
 *   <home>/history-keeper-origins.json        where imported sessions came from
 *   <home>/sessions/                          the host's sessions (never recomposed here)
 *   <home>/attachments/                       the host's attachments
 *   <stick>/keeper-transfer/{vault,carry.json}  the pendrive copy
 */
import fs from 'node:fs'
import path from 'node:path'

export const VAULT_DIR = 'history-keeper'
export const KEY_FILE = 'history-keeper.key'
export const DEVICE_FILE = 'history-keeper-device.json'
export const ORIGINS_FILE = 'history-keeper-origins.json'
export const STICK_DIR = 'keeper-transfer'

/**
 * @param {{home: string, vault?: string|null, key?: string|null}} options explicit paths win
 * @returns {{home: string, vault: string, key: string, device: string, origins: string, sessions: string, attachments: string, replacedPrefix: string, backupPrefix: string, legacy: string|null, usingLegacy: boolean, stick: string}}
 */
export function resolvePaths(options) {
  const home = path.resolve(options.home)
  const canonical = path.join(home, VAULT_DIR)
  const legacy = path.join(path.dirname(home), 'keeper-vault')
  const legacyExists = legacy !== canonical && fs.existsSync(path.join(legacy, 'meta.json'))
  const canonicalExists = fs.existsSync(path.join(canonical, 'meta.json'))

  // The explicit flag wins; then the canonical location; then the legacy one, so an installation
  // that predates this layout keeps working instead of silently pointing at nothing.
  const vault = options.vault
    ? path.resolve(options.vault)
    : canonicalExists || !legacyExists
      ? canonical
      : legacy

  return {
    home,
    vault,
    key: options.key
      ? path.resolve(options.key)
      : vault === canonical
        ? path.join(home, KEY_FILE)
        : path.join(path.dirname(home), 'keeper', 'passphrase.txt'),
    device: path.join(home, DEVICE_FILE),
    origins: path.join(home, ORIGINS_FILE),
    sessions: path.join(home, 'sessions'),
    attachments: path.join(home, 'attachments'),
    replacedPrefix: vault + '.replaced-',
    backupPrefix: vault + '.backup-',
    legacy: legacyExists ? legacy : null,
    usingLegacy: vault === legacy,
    stick: path.join('F:', STICK_DIR),
  }
}
