/**
 * This build's version, read from package.json once at load.
 * The handshake needs it in the store layer as well as in the CLI and the plugin, and passing it
 * through every call site would only invite one of them to forget.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let version = '0.0.0-unknown'
try {
  version = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version
} catch {
  /* a build without a readable package.json still works; it just cannot claim a version */
}
export const PLUGIN_VERSION = version
