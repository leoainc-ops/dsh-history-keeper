# dsh-history-keeper

**Your DeepSeek Harness history comes back — and you can prove it.**

*Español: [README-es.md](README-es.md)*

> **Status: `1.0.x`, stable.** The engine, the host plugin and the transport work and
> are validated against real sessions: capture, verify, byte-exact restore, export/import with a
> drop box and an undo window, version handshake, catalog, plaintext extraction (readable, JSONL,
> raw) and conformance checks for any vault. Live sync between machines, device pairing and a host
> UI are **out of scope for 1.0** by decision, not pending work.

## The problem

Your conversations live in one place: `~/.dsh/sessions` on a single machine. If that
machine dies, they die with it. There is no copy of *why* it happened — and no way to
prove the copy you do have is intact.

`dsh-history-keeper` exists to fix that: capture the history, encrypt it, verify it, and
restore it — byte for byte.

That includes the **attachments**: a pasted image or file lives outside the session log, in
`~/.dsh/attachments`. When a captured session references one, the blob is captured with it,
verified against the hash its name claims, and restored next to the conversation. A history
without the images you pasted is an incomplete history.

## What it does

| Capability | State in 1.0 |
|---|---|
| Capture and verify sessions from the host | works, byte for byte, with per-device heads |
| Restore into a DSH home without overwriting | works, with `.incoming-*` for conflicts |
| Travel on a pendrive with a drop box and an undo window | works: `export`, `import --stage`, `import --undo` |
| Describe itself and refuse a newer format | works: `writer`/`minReader`, `keeper conform` |
| Catalog, extraction to plaintext, vault upgrade | works: `catalog`, `extract` (readable/JSONL/raw), `upgrade` |
| Measure and reclaim its own space | works: `keeper doctor`, automatic reclaim after compaction |
| Live sync between machines, device pairing and revocation, a host UI | **out of scope for 1.0**, by decision |

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
        captureAttachments: true                 # capture the blobs sessions reference
        autoCompact: true                        # checkpoint the chain when the policy approves
        compactMinManifests: 50                  # manifests since the last checkpoint before it acts
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

## Roadmap

1.0 shipped on 2026-11-09. [docs/ROADMAP-1.0.md](docs/ROADMAP-1.0.md) keeps the record: the six
phases, their acceptance criteria, the definition of done, the deviations that were accepted and
what is explicitly out of scope. What comes after 1.0 is listed in the CHANGELOG under
"After 1.0". The format itself is the contract in [docs/SPEC-vault.md](docs/SPEC-vault.md).

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

The package is published as `dsh-history-keeper` (the `latest` tag is the stable 1.0 line).

```sh
# in the DSH profile (this is how it runs inside the host)
cd ~/.dsh/profiles/desktop        # or: $env:USERPROFILE.dshprofilesdesktop
pnpm add dsh-history-keeper@1.0.0

# or, if your DSH CLI exposes the plugin command
dsh plugin --profile desktop add dsh-history-keeper
```

Restart DSH after installing: the plugin is loaded at start. The CLI can also be used on its own,
without the host:

```sh
node node_modules/dsh-history-keeper/bin/keeper.js capabilities
```

## Compatibility

Developed and tested against DeepSeek Harness `0.2.2-rc.1`. The bundle declares
`engines.dsh` so an incompatible host refuses it instead of misbehaving.

## Development

```sh
node --test "test/*.test.mjs"   # unit tests, no dependencies to install
npm run guard                   # refuses committed session logs
```

Moving your history to another machine today, without sync:
[`docs/TRANSFER.md`](docs/TRANSFER.md).
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

## The contract

The vault format is specified in [`docs/SPEC-vault.md`](docs/SPEC-vault.md) and enforced by
`npm run conformance` against a committed reference vault: any implementation —a policy package, a
fork, a rewrite— that passes it can read the same vault. What may differ between products is the
*philosophy* ([`docs/PHILOSOPHIES.md`](docs/PHILOSOPHIES.md)): which lineage is visible, when the
vault travels, what is retained. The one this version ships is the conservative philosophy
([`docs/adr/0001-filosofia-conservadora.md`](docs/adr/0001-filosofia-conservadora.md)).

## Documentation

| Document | What it answers |
|---|---|
| [`docs/MANUAL-GENERAL.md`](docs/MANUAL-GENERAL.md) | the user manual: what it is, how to use it, FAQ (Spanish) |
| [`docs/MANUAL-TECNICO.md`](docs/MANUAL-TECNICO.md) | the technical manual: modules, format, crypto, concurrency (Spanish) |
| [`docs/CLI.md`](docs/CLI.md) | every command, its options, and which ones need DSH closed |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | the daily cycle, maintenance, and what to do when something fails |
| [`docs/TRANSFER.md`](docs/TRANSFER.md) | how the vault travels: export, drop box, import, undo |
| [`docs/SPEC-vault.md`](docs/SPEC-vault.md) | the format, as a norm, and what it does not guarantee |
| [`docs/HISTORY.md`](docs/HISTORY.md) | one row per published version, with its status |
| [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) | the tested reader/vault combinations, and what is not covered |
| [`docs/LICENSING-FILES.md`](docs/LICENSING-FILES.md) | which license applies to which file |
| [`SECURITY.md`](SECURITY.md) | how to report a vulnerability |
| [`CHANGELOG.md`](CHANGELOG.md) | the full record, including the withdrawn versions and why |
| [`docs/LESSONS.md`](docs/LESSONS.md) | the field failures that shaped the design |

## What it covers

The situations the plugin covers today, by role and with the gaps named: [docs/CASES.md](docs/CASES.md).
