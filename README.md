# dsh-history-keeper

Your DeepSeek Harness conversation history, in a vault you own.

| | |
|---|---|
| Published | **1.0.2** — `npm i dsh-history-keeper`, stable line `1.0.x` |
| This branch | **2.0.0-dev** — in development, not published |
| Vault format | `dsh-history-keeper/store/1` — **unchanged by 2.0** |
| License | code: PolyForm Noncommercial 1.0.0 · docs: see [`LICENSE-DOCS`](LICENSE-DOCS) |

## What it is

A DSH plugin plus a CLI that keeps your sessions in a **self-describing, encrypted vault** you can
carry on a pendrive: the vault and the passphrase are enough to recover the conversations on another
machine. The vault never depends on DSH to be read.

**It is not** a sync service, a backup of your projects, a viewer, or a way to read someone else's
history. It does not repair corruption: it detects it and fails closed.

## The two delivery modes (2.0)

| | `archivo` | `uso` |
|---|---|---|
| What it does | restores the original, byte for byte | hands the conversation to DSH so DSH writes, indexes and groups it |
| Integrity | the vault chain and the extracted bytes | a content seal over the original |
| Machine | works with DSH closed | DSH is the writer; nothing to close |
| Use it for | proof, archive, recovery on a new host | day-to-day work across your machines |

`archivo` exists today; `uso` is the reason 2.0 exists. See [`docs/10-MODO-ARCHIVO.md`](docs/10-MODO-ARCHIVO.md)
and [`docs/11-MODO-USO.md`](docs/11-MODO-USO.md).

## The contract, in six lines

| | Invariant |
|---|---|
| **C1** | What is delivered is exactly what was archived (chunk hashes, prefix and end hashes). |
| **C2** | A wrong passphrase fails **before** anything is created, published or moved. |
| **C3** | Nothing existing is replaced; a conflict gets a new id, a refusal, or an archive. |
| **C4** | On corruption the delivery aborts with a code and nothing partial is written. |
| **C5** | `store/1` keeps being read and written; only optional fields are added. |
| **C6** | Every delivery records provenance: store, device, content seal and mode. |

The full contract, with the negotiable defaults, is [`docs/04-CONTRATO.md`](docs/04-CONTRATO.md).

## Repository map

| Path | What lives there |
|---|---|
| `lib/` | the engine: store, crypto, chunks, verify, merge, export/import, restore, catalog |
| `bin/keeper.js` | the CLI |
| `cordis.patch.yml` | the plugin bundle |
| `docs/` | **the 2.0 portfolio** — start at [`docs/00-INDICE.md`](docs/00-INDICE.md) |
| `docs/1.0/` | the 1.0.x documentation, frozen |
| `test/` · `conformance/` | the suite and the certification kit |
| `scripts/` | `guard-no-sessions` and the release helpers |

## Read the portfolio

`docs/00-INDICE.md` is the map: one document per question, progressive and interlinked. For a
developer the path is `00 → 01 → 04 → 05 → 06 → 07 → 09 → (10 or 11) → 15 → 16`.

The portfolio is the specification 2.0 is built against. If a document contradicts
[`docs/04-CONTRATO.md`](docs/04-CONTRATO.md), the document is wrong.

## Develop

```bash
npm test            # the suite, node --test
npm run guard       # fails if real session logs are tracked
npm run conformance # the certification kit
```

Node `^22.19.0 || >=24.0.0`. **No runtime dependencies**: if one appears, CI fails.

Nothing is published from this branch; the released documentation lives in [`docs/1.0/`](docs/1.0/).

## Security

The vault is encrypted with AES-256-GCM and a key derived from the passphrase (scrypt). The
passphrase is the only secret and it never travels. Read [`SECURITY.md`](SECURITY.md) before
carrying a vault on removable media.
