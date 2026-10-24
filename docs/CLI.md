# CLI reference — `keeper`

`keeper` works with **no DSH running and nothing but Node installed**. That is deliberate:
the scenario this tool exists for is the one where the host is gone, so the recovery path
cannot depend on the host, on `git`, or on any external binary.

```sh
keeper <command> --store <dir> [options]
```

The passphrase is **never** taken from argv (it would land in shell history): it is read
from the environment variable named by `--passphrase-env`.

## Commands

| Command | What it does | Writes? |
|---|---|---|
| `init` | Creates a new store: `meta.json` (store id, scrypt parameters, sealed key check, device) and an empty `objects/`. Refuses to run over an existing store. | creates the store |
| `snapshot` | Captures the bytes that are new since the last capture: frame-aligned chunks, sealed, referenced by a new manifest. Skips sessions that are already up to date and refuses a local log that no longer contains the published history. | yes, append-only |
| `verify` | Walks the manifest chain, then rebuilds every session chunk by chunk: hash of each sealed object, hash of each plaintext chunk, `prefixSha256`/`endSha256` linkage, byte and frame continuity, and the session header id. | **no** |
| `status` | Store metadata, snapshot count and last snapshot, published totals, what this machine has, how much is pending, and which sessions exist in the store but not here. | **no** |
| `restore` | Rebuilds a DSH home from the store, writing the host's own layout (`sessions/--<project>--/<sessionId>/session.vN.jsonl.zstd`). Never overwrites: identical logs are skipped, different ones are refused unless `--force`. | yes |
| `help` | Prints usage. | no |

## Options

| Option | Commands | Default | Meaning |
|---|---|---|---|
| `--store <dir>` | all except `help` | — | Store directory (the vault). |
| `--home <dir>` | `snapshot`, `restore` | `$DSH_HOME` or `~/.dsh` | DSH home. `snapshot` reads `<home>/sessions`; `restore` writes into it. |
| `--passphrase-env <name>` | all except `help` | `KEEPER_PASSPHRASE` | Name of the environment variable holding the passphrase (minimum 8 characters). |
| `--key-file <path>` | all | `~/.dsh/history-keeper.key` | Single-line passphrase file. `init` writes a generated passphrase here when neither the env var nor the file provides one. |
| `--device-name <name>` | `init` | hostname | Label stored in `meta.json`; it identifies the machine that produced the snapshots. |
| `--session <id>` | `snapshot` | all sessions | Limit the capture to one session. Repeatable. |
| `--max-chunk-bytes <n>` | `snapshot` | `1048576` | Target chunk size. Frames are never split, so a single large frame wins over this target. |
| `--min-interval <ms>` | `snapshot` | `0` | Coalesce a burst of flushes for the same session: new bytes wait until the window opens. `0` publishes everything immediately. |
| `--no-secret-scan` | `snapshot` | off | Publish even when a credential rule matches. The gate is on by default. |
| `--allow-rule <id>` | `snapshot` | — | Disable one secret rule (repeatable), e.g. `--allow-rule secret-assignment`. |
| `--entropy` | `snapshot` | off | Also flag long high-entropy runs. Noisy on tool output; off by default. |
| `--no-attachments` | `snapshot` | off | Skip capturing the blobs the session references. Capture is on by default. |
| `--dry-run` | `restore` | off | Print the plan and write nothing. |
| `--force` | `snapshot`, `restore` | off | `snapshot`: publish inside the coalescing window, or past a quarantine. `restore`: when a different log already exists at the target, keep it and write the incoming copy alongside as `.incoming-<timestamp>`. It never overwrites. |
| `--json` | all | off | Machine-readable output. Timestamps stay as raw ISO-8601 UTC in JSON; the human output renders them in local time. |

## Environment

| Variable | Used by | Meaning |
|---|---|---|
| `KEEPER_PASSPHRASE` (or the name given to `--passphrase-env`) | all commands that open a store | The passphrase. Never logged, never stored in argv. |
| `DSH_HOME` | `--home` default | DSH home directory. |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The command completed and reported no problems. |
| `1` | Completed but reported problems (integrity failures, refused writes, unreadable logs) — or an unexpected error. |
| `2` | Usage or configuration: unknown command, missing value, no store, no passphrase. |

## Examples

```sh
# first run (choose a passphrase of at least 8 characters and keep it safe)
export KEEPER_PASSPHRASE='…'
keeper init    --store ~/keeper-vault --device-name my-laptop

# capture everything new; safe while DSH is running
keeper snapshot --store ~/keeper-vault --home ~/.dsh

# prove the vault is intact (no passphrase needed for the chain, but it verifies content too)
keeper verify  --store ~/keeper-vault

# what is where
keeper status  --store ~/keeper-vault --json

# on a new machine, with DSH closed: put the history back
keeper restore --store ~/keeper-vault --home ~/.dsh --dry-run
keeper restore --store ~/keeper-vault --home ~/.dsh
```

## Attachments

A pasted image or file is not inside the session log: the log only carries
`"attachmentId": "sha256:<64 hex>"`, and DSH keeps the blob under
`<home>/attachments/v1/objects/<first two hex>/<sha256>`.

`snapshot` reads the bytes it is about to publish, finds the references, and captures each
blob **once** (they are content-addressed), sealed like any other object. Only referenced
blobs are captured, never the whole directory. A reference whose blob is missing
(`ATTACHMENT_MISSING`) or whose content no longer hashes to its name
(`ATTACHMENT_MISMATCH`) is reported; the session is still published, because the log is
intact and the blob is not.

`verify` decrypts each captured blob and proves it still hashes to the name the session
references. `restore` writes them back to the same layout and never overwrites a different
file already on disk (`ATTACHMENT_CONFLICT`).

## The secret gate

Before a chunk is sealed, `snapshot` decompresses the bytes it is about to publish and scans
them. A match **quarantines the whole session** — nothing of it is written — and the report
names the rule and the line, never the value:

```text
! session-abc  QUARANTINED: looks like it contains a secret (openai-key at line 2);
  nothing was published. Re-run with --force to publish anyway, or allow the rule.
```

Why quarantine and not redaction: redaction would change the bytes, and the whole promise is
that a restored session is byte-identical to the one the host wrote. The session stays local
and unpublished until the operator decides.

Rules: `openai-key`, `github-token`, `github-pat`, `aws-key`, `private-key`, `bearer`,
`secret-assignment`, `npm-token`, plus `high-entropy` only with `--entropy`. A password
written in prose is not detectable by pattern; the gate is a safety net, not a guarantee.
## What each command refuses to do

- `snapshot` will not capture a torn tail (it stops at the last complete frame) and will not
  publish a session whose local log no longer matches the published history — it reports
  `DIVERGED` and writes nothing.
- `verify` never repairs, never rewrites, and never deletes.
- `restore` never overwrites an existing log, even with `--force`; it writes the incoming
  copy aside.
- `init` never reuses an existing store directory.

## Inside DSH

The plugin exposes the same engine through a conversation command:

| Command | Equivalent CLI |
|---|---|
| `/keeper status` | `keeper status`, plus whether the automatic capture hooks are attached |
| `/keeper snapshot` | `keeper snapshot --home <configured>` |
| `/keeper verify` | `keeper verify` |
| `/keeper help` | `keeper help` |

`restore` is **not** available inside the host on purpose: it writes the live session store
and a running DSH would not notice. The refusal message prints the exact CLI line to run.
