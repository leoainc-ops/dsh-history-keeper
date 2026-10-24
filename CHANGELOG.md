# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[SemVer](https://semver.org/) with pre-release tags while the project is in preview.

During the preview, the `latest` npm tag points at a pre-release on purpose: the plugin is
usable but the host APIs it binds to are still moving.

## Unreleased

- Interactive `/keeper init`: ask for the passphrase through the host (`ctx.userQuestions`)
  and keep it in the host credential store (`ctx.credentials`), so no profile patch and no
  passphrase file are needed.

## 0.1.0-rc.16 — 2026-10-24

### Added

- **`keeper attachments`** backfills the blobs of sessions that were published before
  attachment support existed. Incremental capture only looks at the bytes it is about to
  publish, so a reference that appeared in earlier bytes would never be seen again; the
  command reconstructs each published session once, finds its references and captures the
  blobs that are still missing. `--dry-run` lists them without writing; it is idempotent.

### Note

- A reference whose blob is gone from disk is listed as `referenced but not on disk`, and the
  command exits non-zero: that is data the vault cannot recover.
## 0.1.0-rc.15 — 2026-10-24

### Fixed

- **A false positive quarantined a real conversation.** The `secret-assignment` rule matched
  `PASSPHRASE = 'chain-cache-test-passphrase'` in a test constant, so the session that *wrote*
  that test could no longer be backed up. Rules that extract a value now ignore placeholders
  (`test`, `example`, `dummy`, `fake`, `sample`, `placeholder`, `redacted`, `changeme`, `xxxx`).
  A real-looking assignment (`apiKey = 'a8f5f167…'`, `password: 'Sup3rS3cret-…'`) is still
  blocked, and a token-shaped value with a benign word (`sk-TEST-…`) is allowed.

### Note

- The suppression is on the matched value, not on the line: a genuine secret written on a line
  that also contains the word "test" is still caught.
## 0.1.0-rc.14 — 2026-10-24

### Added

- **Attachments are part of the history.** A pasted image or file lives outside the session
  log: the log carries `"attachmentId": "sha256:<64 hex>"` and DSH keeps the blob under
  `<home>/attachments/v1/objects/<first two hex>/<sha256>`. `snapshot` now reads the bytes it
  is about to publish, finds the references and captures each blob **once** (content-addressed),
  sealed like any other object. Only referenced blobs are captured, never the whole directory.
  `verify` proves each blob still hashes to the name its session references, and `restore`
  writes it back to the host's layout without ever overwriting a different file already there.
  `--no-attachments` / `captureAttachments: false` turn it off.

### Changed

- The secret gate and attachment capture now share **one** decompression pass
  (`lib/payload.js`), instead of decompressing the same bytes twice.

### Note

- A reference with no blob (`ATTACHMENT_MISSING`) or with content that no longer matches
  (`ATTACHMENT_MISMATCH`) is reported, and the session is still published: the log is intact,
  the blob is not. Restoring that session gives the conversation with a reference the host
  cannot resolve, which is exactly what the vault then reports.
## 0.1.0-rc.13 — 2026-10-24

### Performance

- **The manifest chain is memoised.** Reading it opens one file per manifest, and a real
  vault with 541 manifests took 14.8 s to walk from cold. The plugin reads the chain on every
  `/keeper status` and every automatic capture, so it walked it every time. The cache key
  includes the head reference (a random id that changes on every write) and the snapshot
  count, so a write by this process or by another one invalidates the entry automatically —
  no timers and no manual invalidation that could go stale. Measured on the real vault:
  **14.8 s → 0 ms** for a warm read.

### Fixed

- `verify` reads the chain with `{ fresh: true }`: a verification served from the cache could
  hide a deleted or corrupted object. A test deletes the head object and asserts that the
  cached read still succeeds while the fresh read throws — the behaviour is now explicit.

### Note

- A CLI process still pays the cold read once (`keeper status` spawns a process), so the fix
  is a large win for the plugin and for the second read inside an operation, not for the
  first read of a command-line invocation. Bounding that cost is what compaction (9.2) and the
  append-only manifest log (9.7) are for.
## 0.1.0-rc.12 — 2026-10-24

### Added

- **Coalescing.** `snapshotMinIntervalMs` (default 30 s) keeps a session's new bytes pending
  until its window opens, so a burst of turns no longer produces one manifest per turn. The
  plugin reschedules itself for the exact moment the window opens; `/keeper snapshot` and a
  session closing always publish immediately (`force`). CLI: `--min-interval <ms>`.
- **Secret gate.** Before sealing, `snapshot` decompresses the bytes it is about to publish and
  scans them for credentials (`lib/secrets.js`). A match **quarantines the whole session**:
  nothing is written, the report names the rule and the line, and the value is never printed.
  Override with `--force`, silence one rule with `--allow-rule <id>`, or turn it off with
  `secretScan: false` / `--no-secret-scan`. An optional `--entropy` rule catches long
  high-entropy runs and is off by default because tool output trips it.
- **Derived-key cache.** Opening a store derived the scrypt key every time (1.4–3.1 s), which
  the automatic capture would have paid on every run. Keys are now memoised per store in
  process memory only; the first open pays the KDF, later ones take milliseconds.

### Changed

- `/keeper status` reports the coalescing window, whether the secret gate is on (and which
  rules are allowed), and the sessions quarantined in the last run.

### Note

- The gate catches structured secrets. A password written in prose is not detectable by
  pattern, so this is a safety net, not a guarantee.
## 0.1.0-rc.11 — 2026-10-24

### Fixed

- `LICENSING-HISTORY.md` mixed local and UTC times and listed `rc.6` after the relicensing
  row it preceded. Every timestamp is now UTC and the table is strictly chronological. In a
  document that exists to remove doubt about which license applies, a wrong order is a defect.
## 0.1.0-rc.10 — 2026-10-24

### Licensing, made unambiguous

- `LICENSE` is now a short index: code → `LICENSE-CODE` (PolyForm Noncommercial 1.0.0, with its
  Required Notice and canonical URL), documentation → `LICENSE-DOCS` (CC BY-NC 4.0), history →
  `LICENSING-HISTORY.md`. The full license text still lives in `LICENSE-CODE`; nothing in the
  terms changed.
- New [`LICENSING-HISTORY.md`](LICENSING-HISTORY.md) records, version by version, which license
  applied: `rc.1`–`rc.7` were published under **MIT** and stay MIT for whoever obtained them;
  `rc.8` was published after the relicensing but with MIT metadata by mistake and is
  deprecated; from `rc.9` the split model applies. It also states that there are **no forks**
  of either repository as of 2026-10-24, and how contributions are licensed.
- Both READMEs gained a "License history" section linking to that document.
## 0.1.0-rc.9 — 2026-10-22

### Licensing (project-level change)

- The repository now uses **split licensing**, decided and committed directly on GitHub:
  source code under **PolyForm Noncommercial 1.0.0** (`LICENSE-CODE`), documentation under
  **CC BY-NC 4.0** (`LICENSE-DOCS`). Commercial use of the code requires the author's
  permission.

### Fixed

- `package.json` still declared `MIT` after that change and shipped neither license file. It
  now declares `SEE LICENSE IN LICENSE-CODE` and publishes `LICENSE`, `LICENSE-CODE`,
  `LICENSE-DOCS` and `CHANGELOG.md` in the tarball.
- Both READMEs linked to `LICENSE-CODE`, which did not exist. The file now exists and carries
  the PolyForm text with its Required Notice.
- `docs/PLAN.md` still mentioned an MIT license in the bootstrap checklist.

### Note

- `0.1.0-rc.8` was published with `license: MIT` metadata before the change was noticed. It
  contains the same code. `rc.9` is identical apart from the corrected metadata, and `rc.8` is
  deprecated with a pointer to it.
## 0.1.0-rc.8 — 2026-10-22

### Added
- `/keeper init` and `keeper init` provision the vault with no configuration at all: they
  create the default store (`~/.dsh/history-keeper`) and, when no passphrase is configured,
  generate one (32 characters) into `~/.dsh/history-keeper.key`. The passphrase is never
  printed, because command output ends up in transcripts and logs.
- `--key-file <path>` on every CLI command; `init` writes a generated key there.
- Passphrase resolution is now: configured file → key file → environment variable, and
  `status` always reports which source was used.

### Changed
- A missing passphrase now points at `/keeper init` instead of asking the operator to export
  an environment variable.
## 0.1.0-rc.7 — 2026-10-22

### Changed
- Timestamps are still stored in UTC, but `status` and `snapshot` render them in the
  machine's local zone with the offset (`2026-10-22 00:54:29 (UTC-03:00)`). Reported after
  the first real mount: a raw `…Z` value looked like a clock problem to the user.
- Zero-configuration defaults: `store` falls back to `~/.dsh/history-keeper` and
  `sessionsRoot` to `~/.dsh/sessions`, so installing no longer requires editing the
  profile patch.

### Added
- Tests for the time formatting and for the default resolution of an empty config.

## 0.1.0-rc.6 — 2026-10-22

### Fixed
- **The plugin could not open its own store inside DSH.** The plugin runs in Electron,
  whose crypto comes from BoringSSL and does **not** expose `chacha20-poly1305`
  (`crypto.getCiphers()` returns no chacha entries), while the bundled Node runtime does.
  A store sealed with ChaCha20 could therefore never be opened in-process, and the failure
  surfaced as "wrong passphrase".

### Changed
- Default AEAD is **AES-256-GCM**, available in both runtimes. The AEAD is recorded in
  `meta.json`, validated against the runtime before use, and pinned by a test that fails if
  the default is unavailable. Stores sealed with ChaCha20 remain readable where the cipher
  exists (CLI).

## 0.1.0-rc.3 — 2026-10-21

### Added
- `/keeper status` reports whether the host hooks are attached
  (`session/flush` + `session/disposed`), `PARTIAL`, or `UNAVAILABLE`, and mounting warns
  when the host exposes no event bus instead of silently never capturing.

## 0.1.0-rc.2 — 2026-10-21

### Fixed
- rc.1 shipped with a corrupted `description` (a writer re-encoded `package.json`, so npm
  displayed mojibake). rc.2 restores plain ASCII and keeps `lib/index.js` in sync with the
  package version, both enforced by tests. rc.1 is deprecated on npm in favour of rc.2.

## 0.1.0-rc.1 — 2026-10-21

### Added
- Engine: Zstandard frame scanner, frame-aligned chunking with a `prefixSha256`/`endSha256`
  hash chain, sealed objects with random ids (no metadata leak), append-only manifest chain.
- CLI (`keeper`): `init`, `snapshot`, `verify`, `status`, `restore` — works without DSH
  running, which is the point of a recovery tool.
- Host plugin: `/keeper status|snapshot|verify|help`, automatic capture on `session/flush`
  and `session/disposed` with debounce and single-flight, validated configuration that never
  throws during `apply`.
- `restore` is deliberately CLI-only: it writes the live session store and a running host
  would not notice.

## Why the version numbers skip

`0.1.0-rc.4` and `0.1.0-rc.5` were **never published**. Their `npm publish` runs failed
during the npm registry incident of 2026-10-22 (HTTP 503 and `PUT` timeouts; npm status
listed *package publishing* as a partial outage). Their content shipped in `rc.6` and
`rc.7` respectively.

Published version numbers are never reused, so the gaps stay in the registry. `0.0.0-stage`
is **not** a release: it is the staging placeholder npm 11 creates while a publish is being
processed. It cannot be removed with a granular token that bypasses 2FA, and it carries no
code.
