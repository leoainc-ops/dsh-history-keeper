# dsh-history-keeper

**Your DeepSeek Harness history comes back — and you can prove it.**

*Español: [README-es.md](README-es.md)*

> **Status: pre-alpha (0.1.0 in progress).** The engine works: `snapshot`, `verify` and
> `restore` run on real DSH logs, validated byte for byte on 8 sessions. Host plugin
> integration and live sync are the next milestones.

## The problem

Your conversations live in one place: `~/.dsh/sessions` on a single machine. If that
machine dies, they die with it. There is no copy of *why* it happened — and no way to
prove the copy you do have is intact.

`dsh-history-keeper` exists to fix that: capture the history, encrypt it, verify it, and
restore it — byte for byte.

## What it will do

| Milestone | Delivers |
|---|---|
| **0.1** | `snapshot`, `verify` and `restore` from a shared folder, with the CLI working without DSH running |
| **1.0** | live sync between machines, per-device manifests, explicit conflict handling, device pairing and revocation |

## Try it now (from a checkout)

The CLI needs nothing but Node — no DSH, no git, no external binaries.

```sh
export KEEPER_PASSPHRASE='a passphrase of at least 8 characters'

node bin/keeper.js init     --store ./vault
node bin/keeper.js snapshot --store ./vault --home ~/.dsh
node bin/keeper.js verify   --store ./vault
node bin/keeper.js restore  --store ./vault --home /tmp/restored-home
```

`restore` reproduces the host's own layout under `sessions/`, verifies every hash, and
never overwrites an existing log.

## Use it inside DSH

Install the bundle, then run `/keeper init` once in any conversation. That is the whole
setup: it creates the vault (default `~/.dsh/history-keeper`), generates a passphrase when
you have not chosen one, and writes it to `~/.dsh/history-keeper.key`.

No profile patch is required. The YAML below exists only to override the defaults:

```yaml
- insert:
    - id: history-keeper
      name: dsh-history-keeper
      config:
        store: C:\Users\you\keeper-vault         # default: ~/.dsh/history-keeper
        sessionsRoot: C:\Users\you\.dsh\sessions # default: ~/.dsh/sessions
        autoSnapshotOnFlush: true                # capture after each closed turn
        debounceMs: 2000                         # settle time before a capture runs
        snapshotMinIntervalMs: 30000             # coalesce a burst of turns (0 disables)
        maxChunkBytes: 1048576                   # target chunk size; frames are never split
        secretScan: true                         # quarantine a session that looks like it holds a credential
        secretScanAllow: []                      # rule ids to ignore, e.g. [openai-key]
        secretScanEntropy: false                 # long high-entropy runs (noisy; off by default)
        keyFile: C:\Users\you\.dsh\history-keeper.key
        passphraseFile: null                     # wins over the key file and the env var
        passphraseEnv: KEEPER_PASSPHRASE
        deviceName: my-laptop
```

The passphrase is never written into the patch: it comes from `passphraseFile`, the key file
that `init` creates, or `KEEPER_PASSPHRASE`. Then, in a conversation:

```text
/keeper init       create the vault (generates a passphrase when none is configured)
/keeper status     what the vault holds, what is pending, what this machine is missing
/keeper snapshot   capture new session bytes now
/keeper verify     check every object, hash and chain
/keeper help
```

`restore` is deliberately **not** available from inside DSH: it writes the live session
store, and a running host would not notice. It stays a CLI operation, with DSH closed —
that is the whole point of a recovery tool.

### The secret gate

A capture never publishes a session whose new bytes look like a credential. The gate
**quarantines** instead of redacting, because rewriting bytes would break the byte-for-byte
promise: nothing is written for that session, and `/keeper snapshot` reports the rule and the
line — never the value. Publish anyway with `--force`, or silence one rule with
`--allow-rule <id>`.

It catches structured secrets (API keys, tokens, key assignments, private key blocks). A
password written in prose is **not** detectable by pattern: the gate is a safety net, not a
guarantee.

### Minimal setup

Every key is optional. With no `config` at all, the plugin looks for a store at
`~/.dsh/history-keeper`, reads sessions from `~/.dsh/sessions`, and tells you how to
create the store when it is missing.

Timestamps are stored in UTC (an instant must be unambiguous across machines) and
rendered in your local time zone next to the offset.

## Design principles

1. **No external binaries.** `node:` only — no `git`, no `age`, nothing to install.
2. **Fail closed.** No key, no sync. A conflict never writes. Encryption never degrades to plaintext.
3. **Never overwrite, never delete.** Restore only creates; anything that already exists and differs is set aside.
4. **Append-only and verifiable.** Every object is immutable and named by content; the chunk chain lets anyone audit integrity, even without the key.
5. **Copies per device, never a shared mutable file.**
6. **The transport is dumb.** A folder (or any provider) only moves blobs: it never parses, orders or merges.
7. **Auditable by you.** `verify` and a readable report — you do not have to trust us.

## Privacy

History is encrypted before it leaves the machine, and metadata is encrypted too: file
names and sizes do not reveal which projects you work on. Without the key, the store is
opaque. There is no server and no account.

## Install

Not published yet. When 0.1 ships:

```sh
dsh plugin --profile web add dsh-history-keeper
```

## Compatibility

Developed against DeepSeek Harness `0.2.0-rc.2`. The bundle declares
`engines.dsh` so an incompatible host refuses it instead of misbehaving.

## Development

```sh
node --test "test/*.test.mjs"   # unit tests, no dependencies to install
npm run guard                   # refuses committed session logs
```

Design notes and roadmap: [`docs/`](docs/). Release history, including versions that were
never published and why: [CHANGELOG.md](CHANGELOG.md).

## Licensing

This repository uses a split licensing model:

- **Source code** (`bin/`, `lib/`, `scripts/`, `test/`, `package.json`, `cordis.patch.yml`): licensed under the **PolyForm Noncommercial License 1.0.0**. See [`LICENSE-CODE`](LICENSE-CODE).
- **Documentation** (`README.md`, `README-es.md`, `CHANGELOG.md`, `docs/`): licensed under **CC BY-NC 4.0**. See [`LICENSE-DOCS`](LICENSE-DOCS).

Commercial use of the source code is not permitted without explicit permission from the author.

### License history

Versions `0.1.0-rc.1` through `0.1.0-rc.7` were published under **MIT** and remain available
under MIT for whoever obtained them. The split model above applies from `0.1.0-rc.9` onward;
`0.1.0-rc.8` was published with MIT metadata by mistake and is deprecated. There are no forks
of this project as of 2026-10-24. Full timeline, fork status and contribution terms:
[`LICENSING-HISTORY.md`](LICENSING-HISTORY.md).

---
