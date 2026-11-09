# `keeper` — command reference

`keeper` is the command-line surface of the vault. The plugin inside DSH captures, compacts and
imports on its own; the CLI is what you use for everything else: the first vault, verification,
travel, extraction and repair.

Two rules decide when a command may run:

1. **While DSH is open, the plugin is the writer.** The CLI refuses `snapshot`, `compact`, `gc --yes`,
   `import`, `restore` and `upgrade` with a clear message. Reading commands (`verify`, `status`,
   `catalog`, `extract`, `conform`, `doctor`, `paths`, `capabilities`) run any time.
2. **`--allow-host-open` exists** for the case where you know the plugin is idle; it is never the
   default.

```bash
keeper <command> --store <dir> [options]
```

The vault lives in `~/.dsh/history-keeper` and the passphrase is read from `--key-file`,
`~/.dsh/history-keeper.key`, or `$KEEPER_PASSPHRASE`, in that order of precedence.

## Common options

| Option | Meaning |
|---|---|
| `--store <dir>` | the vault directory (default: `~/.dsh/history-keeper`) |
| `--home <dir>` | the DSH home (default: `$DSH_HOME` or `~/.dsh`) |
| `--key-file <file>` | file holding the passphrase |
| `--passphrase-env <name>` | environment variable holding it (default `KEEPER_PASSPHRASE`) |
| `--json` | machine-readable output |
| `--allow-host-open` | skip the "close DSH" guard (only when the plugin is idle) |

## The vault itself

| Command | What it does |
|---|---|
| `init` | creates the vault; generates a key file when no passphrase is set |
| `snapshot` | captures new session bytes (`--session <id>` to limit, `--force` to ignore the throttle) |
| `verify` | every object, hash and chain link; fails closed with codes |
| `status` | sessions, frames, attachments, archived continuations, unpublished bytes |
| `catalog` | every conversation by workspace, turns, dates, sizes and session hash |
| `conform` | validates *any* vault against the contract: format, reader, verify, byte-exact restore, wrong passphrase; exit 1 when it does not conform |
| `doctor` | what the vault consumes, what is recoverable, and what is lying around |
| `upgrade` | adds the current handshake and retention to an older vault; history untouched |
| `compact` | replaces the chain with one checkpoint |
| `gc` | deletes unreferenced objects (`--yes` to actually delete) |
| `attachments` | captures blobs referenced by already-published sessions |
| `inventory` | sessions grouped by the device that published them |
| `paths` | where every keeper file lives on this machine |
| `capabilities` | version, format and commands this build knows |

## Travel

```bash
# on the machine that sends (DSH may stay open: this only reads the vault)
keeper export --to F:\keeper-transfer

# on the machine that receives (DSH closed)
keeper import --from F:\keeper-transfer --stick-key F:\keeper-transfer\key\pc-a.txt

# leave a vault for the next start instead of importing now
keeper import --stage F:\keeper-transfer --stick-key <file>

# take back what the last automatic import showed (7 days, or until the first export)
keeper import --undo
```

| Option | Meaning |
|---|---|
| `--to <dir>` | destination of `export`; the vault lands in `<dir>/vault` |
| `--replace` | overwrite a destination that holds unknown or newer content |
| `--keep-replaced` | keep the previous copy as `vault.replaced-<stamp>` |
| `--downlevel <version>` | declare a copy readable by that older plugin |
| `--from <dir>` | pendrive root for `import` (a folder containing `vault/` works) |
| `--stick-key <file>` | passphrase of the carried vault |
| `--stage <dir>` | verify a carried vault and leave it in the drop box for the next start |
| `--undo` | remove the session files the last automatic import created |
| `--on-divergence owner\|error` | keep the owner's line and archive the other, or refuse |

`export` verifies the copy, writes a receipt (`carry-<stamp>.json`) with the **key fingerprint**,
never the passphrase, and refuses to overwrite a destination that holds sessions the local vault
lacks.

## Extraction (plaintext)

```bash
keeper extract --session <id> --out C:\temp\conversacion.md
keeper extract --session <id> --out C:\temp\conversacion.jsonl --jsonl
keeper extract --session <id> --out C:\temp\conversacion.jsonl.zstd --raw
```

| Format | Content |
|---|---|
| `readable` (default) | Markdown transcript: turns, messages, reasoning, tool calls and results, title |
| `--jsonl` | the decompressed log, one event per line (faithful, comparable) |
| `--raw` | the exact session file, ready to drop back into `sessions/` |

Conditions: `--out` is required and never overwritten (`--force` to replace), the path may not be
inside the vault or the host trees, and the **secret gate** stops the extraction unless `--force`
when the text looks like a credential. The first line of a readable copy says it is unprotected.
`--no-reasoning` leaves the model's reasoning out; `--max-tool-chars <n>` truncates tool output.

## Repair

| Situation | Command |
|---|---|
| the vault does not verify | `verify` → read the codes; restore a `.replaced-*` copy if one exists |
| a destination was overwritten by mistake | the copy is at `vault.replaced-<stamp>` |
| an import showed sessions you did not want | `keeper import --undo` |
| the vault is bigger than the history it holds | `keeper doctor`, then `compact` + `gc --yes` with DSH closed |
| a vault from an older build | `keeper upgrade` |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | the operation ran but the result is not healthy (`verify`, `conform`, `doctor`) |
| 2 | the command could not run (missing store, wrong passphrase, guard, bad arguments) |

## What is deliberately CLI-only

`restore` writes the live session tree and `gc --yes` deletes objects: both belong to a moment with
DSH closed. `extract` writes plaintext outside the vault: it exists only as an explicit command.

```bash
keeper restore --store <dir> --home <dsh home> [--dry-run] [--force]
```
