/**
 * Vault: the only door to a store.
 *
 * Two operations, and one rule that comes from the contract (C2): the passphrase is checked
 * **before** anything is created, published or moved. `init` refuses to write a single byte until
 * the passphrase it was given is usable; `open` either returns a validated store or throws, and it
 * never writes.
 *
 * @module core/vault
 */
import { KeeperStoreError, initStore, openStore } from './store.js'

/** Minimum length accepted for a new passphrase. Short ones are the weakest link (see docs/12). */
export const MIN_PASSPHRASE_LENGTH = 8

const MISSING = 'a passphrase is required: export KEEPER_PASSPHRASE=<passphrase> or pass --key-file <path>'

/**
 * Open an existing vault and validate its passphrase.
 *
 * Reads `meta.json`, checks the format, the AEAD and the `keyCheck`. A wrong passphrase throws
 * `WRONG_PASSPHRASE` and leaves the directory untouched: opening is read-only.
 * @param {string} dir
 * @param {string} passphrase
 * @returns {{dir: string, meta: any, key: Buffer}}
 */
export function openVault(dir, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new KeeperStoreError(MISSING, 'PASSPHRASE_REQUIRED')
  }
  try {
    return openStore(dir, passphrase)
  } catch (error) {
    // One canonical code for "the phrase is not the one of this vault", so callers and tests do not
    // depend on the wording of the crypto layer.
    if (error instanceof Error && /wrong passphrase/i.test(error.message)) {
      throw new KeeperStoreError('wrong passphrase for this store', 'WRONG_PASSPHRASE')
    }
    throw error
  }
}

/**
 * Create a new vault with the passphrase the operator chose.
 *
 * The validation happens before `initStore` touches the filesystem, so a missing or too-short
 * passphrase leaves no directory, no `meta.json` and no key file behind.
 * @param {string} dir
 * @param {{passphrase?: string, deviceName?: string}} [options]
 */
export function initVault(dir, options = {}) {
  const passphrase = options.passphrase
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new KeeperStoreError(MISSING, 'PASSPHRASE_REQUIRED')
  }
  if (passphrase.trim().length < MIN_PASSPHRASE_LENGTH) {
    throw new KeeperStoreError('the passphrase must be at least ' + MIN_PASSPHRASE_LENGTH + ' characters', 'PASSPHRASE_TOO_SHORT')
  }
  return initStore(dir, { passphrase, deviceName: options.deviceName })
}
