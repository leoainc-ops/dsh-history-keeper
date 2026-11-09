# Historial de versiones

Una fila por versión publicada en npm, con su fecha, su estado y qué cambió. Las fechas salen del
registro; los resúmenes, del `CHANGELOG.md`, que es la fuente completa.

**Cómo leer el estado**

| Estado | Significado |
|---|---|
| actual | utilizable; `latest` es la recomendada |
| histórica | funcionó en su momento; no se recomienda para empezar |
| histórica (MIT) | publicada bajo MIT, antes del cambio de licencia (ver `LICENSING-HISTORY.md`) |
| **retirada** | no debe usarse: sintetizaba logs de sesión |
| **deprecada** | no debe usarse: el merge reescribía sesiones ya publicadas |

**Versiones**

| versión | fecha | estado | qué cambió |
|---|---|---|---|
| `0.0.0-stage` | 2026-10-21 | placeholder | (sin entrada en el CHANGELOG) |
| `0.1.0-rc.1` | 2026-10-21 | histórica (MIT) | Engine: Zstandard frame scanner, frame-aligned chunking with a prefixSha256/endSha256 |
| `0.1.0-rc.2` | 2026-10-21 | histórica (MIT) | rc.1 shipped with a corrupted description (a writer re-encoded package.json, so npm |
| `0.1.0-rc.3` | 2026-10-21 | histórica (MIT) | /keeper status reports whether the host hooks are attached |
| `0.1.0-rc.6` | 2026-10-22 | histórica (MIT) | **The plugin could not open its own store inside DSH.** The plugin runs in Electron, |
| `0.1.0-rc.7` | 2026-10-22 | histórica (MIT) | Timestamps are still stored in UTC, but status and snapshot render them in the |
| `0.1.0-rc.8` | 2026-10-24 | histórica | /keeper init and keeper init provision the vault with no configuration at all: they |
| `0.1.0-rc.9` | 2026-10-24 | histórica | The repository now uses **split licensing**, decided and committed directly on GitHub: |
| `0.1.0-rc.10` | 2026-10-24 | histórica | LICENSE is now a short index: code → LICENSE-CODE (PolyForm Noncommercial 1.0.0, with its |
| `0.1.0-rc.11` | 2026-10-24 | histórica | LICENSING-HISTORY.md mixed local and UTC times and listed rc.6 after the relicensing |
| `0.1.0-rc.12` | 2026-10-24 | histórica | **Coalescing.** snapshotMinIntervalMs (default 30 s) keeps a session's new bytes pending |
| `0.1.0-rc.13` | 2026-10-24 | histórica | **The manifest chain is memoised.** Reading it opens one file per manifest, and a real |
| `0.1.0-rc.14` | 2026-10-24 | histórica | **Attachments are part of the history.** A pasted image or file lives outside the session |
| `0.1.0-rc.15` | 2026-10-24 | histórica | **A false positive quarantined a real conversation.** The secret-assignment rule matched |
| `0.1.0-rc.16` | 2026-10-24 | histórica | **keeper attachments** backfills the blobs of sessions that were published before |
| `0.1.0-rc.17` | 2026-10-24 | histórica | **Checkpoints (compaction).** A checkpoint is one manifest that carries every chunk |
| `0.1.0-rc.18` | 2026-10-30 | histórica | **One chain per device (phase C.1).** A store no longer has a single head in meta.json |
| `0.1.0-rc.19` | 2026-10-30 | histórica | **Two writers could fork the chain and lose chunks.** On 2026-10-30 the plugin (still on |
| `0.1.0-rc.20` | 2026-10-31 | histórica | /keeper compact and /keeper attachments inside the conversation: both were CLI-only, which |
| `0.1.0-rc.21` | 2026-10-31 | histórica | **keeper inventory**: sessions grouped by the device they came from, with the local state of |
| `0.1.0-rc.22` | 2026-11-01 | histórica | **keeper merge**: combines two vaults into a **new** one without touching either source. |
| `0.1.0-rc.23` | 2026-11-01 | histórica | **Owner rule approved** (was a proposal since 29-oct). A merged vault keeps **one visible |
| `0.1.0-rc.24` | 2026-11-01 | **retirada** (logs sintetizados) | **keeper carry**: updates the local vault, verifies it, copies the folder to a pendrive and |
| `0.1.0-rc.25` | 2026-11-03 | **retirada** (logs sintetizados) | **keeper lineage**: distinguishes **continued** conversations (two or more lineages of the same |
| `0.1.0-rc.26` | 2026-11-03 | **retirada** (logs sintetizados) | **A stale manifest could override the current one.** The chain is walked newest first, and the |
| `0.1.0-rc.27` | 2026-11-03 | **retirada** (logs sintetizados) | keeper fuse --include <log>: a lineage that lives outside the vault (another vault's entry, or a |
| `0.1.0-rc.28` | 2026-11-03 | **retirada** (logs sintetizados) | **A rebaseline could not replace a lineage with a different chunk layout.** A log re-chunked in |
| `0.1.0-rc.29` | 2026-11-03 | **retirada** (logs sintetizados) | **A fused log could not be opened**: the host enforces a turn/step state machine, and a raw |
| `0.1.0-rc.30` | 2026-11-03 | **retirada** (logs sintetizados) | rebaseline no longer refuses a fused log that is *smaller in bytes* than the published lineage. |
| `0.1.0-rc.31` | 2026-11-03 | histórica | **keeper paths**: the single source of truth for where every keeper file lives, with the |
| `0.1.0-rc.32` | 2026-11-03 | histórica | **keeper export**: verifies the vault, copies it to a pendrive and writes a receipt |
| `0.1.0-rc.33` | 2026-11-03 | histórica | **The key must be resolved for the same vault the command opens.** With the new defaults, a |
| `0.1.0-rc.34` | 2026-11-04 | histórica | **keeper import**: the receiving half of the transport. |
| `0.1.0-rc.35` | 2026-11-04 | histórica | **The prepare step of import reports what this host can read.** Before anything live is |
| `0.1.0-rc.36` | 2026-11-04 | histórica | **docs/SPEC-vault.md**: the vault format written as a contract — layout, crypto, chunks, |
| `0.1.0-rc.37` | 2026-11-05 | histórica | **keeper capabilities --json**: version, vault format and supported commands. A script asks what |
| `0.1.0-rc.38` | 2026-11-07 | actual | **Compaction reclaims what it replaces.** After writing a checkpoint, the manifests it made |
| `0.1.0-rc.39` | 2026-11-07 | actual | **Compare-and-swap on the head.** writeManifest accepts expectHead; if the head moved |
| `0.1.0-rc.40` | 2026-11-08 | actual | **The vault says what it is.** meta.writer records the plugin that wrote it, and |
| `0.1.0-rc.41` | 2026-11-08 | actual | **keeper extract --session <id> --out <file>** writes one conversation as a readable Markdown |
| `0.1.0-rc.42` | 2026-11-08 | actual | **A drop box, not a magic folder.** Copy a carried vault into <home>/history-keeper.incoming |
| `0.1.0-rc.43` | 2026-11-08 | actual | **keeper upgrade** (and **/keeper upgrade**) adds what an older vault does not declare: |
| `0.1.0-rc.44` | 2026-11-08 | actual | **keeper conform**: validates *any* vault against the contract, not just the reference one: |
| `0.1.0-rc.45` | 2026-11-08 | **deprecada** (merge reescribía sesiones) | **/keeper import F:\keeper-transfer failed** with "no vault at F:\keeper-transfer": the drop-box |
| `0.1.0-rc.46` | 2026-11-08 | **deprecada** (merge reescribía sesiones) | **Identical sessions are skipped.** If the local vault already holds the session up to the same |
| `0.1.0-rc.47` | 2026-11-09 | actual | **The lineage is the union, not one manifest.** The newest manifest that *mentions* a session is a |
| `0.1.0-rc.48` | 2026-11-09 | actual | **A successful import deletes the staged copy** instead of renaming it to .imported-*. That |

---

## Hitos

| hito | versión | formato | qué habilitó |
|---|---|---|---|
| Motor verificado | rc.1 | store/1 | captura alineada a frames, `verify` byte por byte |
| Multi-equipo | rc.9 | store/1 | cabezas por dispositivo, sin pisarse |
| Filtro de secretos | rc.12 | store/1 | cuarentena de sesiones con credenciales |
| Retiradas | rc.24–rc.30 | store/1 | **fracaso documentado**: logs sintetizados; ver `docs/LESSONS.md` |
| Recuperación | rc.31 | store/1 | vuelta a captura real; se elimina toda síntesis |
| Frenar el crecimiento | rc.38 | store/1 | compactación que reclama, import en el lugar, export sin copias |
| Escritor confiable | rc.39 | store/1 | compare-and-swap, lock por dueño, guardia de host |
| La bóveda se describe | rc.40 | store/1 | `writer`/`minReader`, catálogo, `export --downlevel` |
| Extracción | rc.41 | store/1 | `extract` legible, JSONL y raw, con gate de secretos |
| Importación al arrancar | rc.42 | store/1 | buzón, journal y `import --undo` |
| Bóvedas anteriores se actualizan | rc.43 | store/1 | `keeper upgrade`, sin tocar la historia |
| Conformidad de cualquier bóveda | rc.44 | store/1 | `keeper conform`, hashes en el catálogo |
| Merge correcto | rc.46–rc.48 | store/1 | agrega en vez de reescribir; `keeper doctor`; el buzón ya no deja copias |

## Por qué no hay una tabla de commits por versión

El repositorio no usó tags hasta la 1.0. Para reconstruir el commit de una versión:

```bash
git log --oneline -S '"version": "0.1.0-rc.42"' -- package.json
```

A partir de `v1.0.0` cada versión publicada lleva su tag.
