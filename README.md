# dsh-history-keeper

**Your DeepSeek Harness history comes back — and you can prove it.**

*Español: [README-es.md](README-es.md)*

> **Status: pre-alpha (0.0.1).** This release only proves the bundle mounts.
> There is no snapshot, verify or restore yet. Watch the repository for the first
> usable milestone.

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

Design notes and roadmap: [`docs/`](docs/).

## License

MIT
