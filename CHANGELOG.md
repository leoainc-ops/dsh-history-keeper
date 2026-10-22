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
