# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[SemVer](https://semver.org/) with pre-release tags while the project is in preview.

During the preview, the `latest` npm tag points at a pre-release on purpose: the plugin is
usable but the host APIs it binds to are still moving.

## 1.0.0 — 2026-11-09

The first stable version. What follows is what 1.0 promises, and what it does not.

### The promise

- **The vault is the product.** `docs/SPEC-vault.md` defines the format `store/1` as a norm: any
  implementation that opens a reference vault, verifies it, restores its sessions byte for byte,
  detects a tampered object and refuses a wrong passphrase is conforming. The kit is
  `conformance/`; the command is `keeper conform`.
- **History is never rewritten.** Capture is append-only; merging appends only the bytes a session
  lacks; an upgrade changes the vault's description, never its objects; nothing is synthesized.
- **It does not duplicate.** Measured on the real vault: 16,91 MiB for 15,97 MiB of unique sessions
  (ratio 1,059, limit 1,1), and 0 unreferenced objects after maintenance.
- **It travels without side effects.** Export verifies the copy and writes a receipt with the key's
  fingerprint; import verifies the carried vault before touching anything, merges in place, verifies
  the result, restores what the host lacks, and offers an undo window (7 days or the first export).
- **One writer at a time.** With DSH open the plugin writes and the CLI refuses; with DSH closed the
  CLI maintains and the plugin is not running.
- **Nothing is silent.** Every failure has a code: `HASH_MISMATCH`, `MISSING_OBJECT`, `SEQ_GAP`,
  `BYTE_GAP`, `FORMAT_TOO_NEW`, `HEAD_MOVED`, `STORE_BUSY`.

### Compatibility

`store/1`, reader `1.0.0`. Tested in `docs/COMPATIBILITY.md`: a vault written by this version is
verified and restored byte for byte by `0.1.0-rc.38`; this version refuses a vault that declares a
newer format. Only one host build (`0.2.2-rc.1`) was available for testing, and that axis is
recorded as not covered.

### What 1.0 does not do

Live sync between machines, device pairing and revocation, a host UI, adapters for other hosts, and
changing the encryption or the passphrase. See `docs/ROADMAP-1.0.md`.

### After 1.0

See the section above: interactive `/keeper init` through the host's credential API is the next
candidate, and it is not part of this release.
## After 1.0 (not in this release)

- **Interactive `/keeper init`**: ask for the passphrase through the host (`ctx.userQuestions`) and
  keep it in the host credential store (`ctx.credentials`), so no profile patch and no passphrase
  file are needed. It depends on host APIs this build does not use yet, so it is not claimed as
  part of 1.0.
- **Second host version in the compatibility matrix**: only DeepSeek Harness `0.2.2-rc.1` was
  available on the machine where 1.0 was prepared; see `docs/COMPATIBILITY.md`.

## 0.1.0-rc.48 — 2026-11-09

### The drop box stops leaving copies behind

- **A successful import deletes the staged copy** instead of renaming it to `.imported-*`. That
  rename was a full duplicate of the vault on every import — 15 MB in the field — which is exactly
  the duplication M1 exists to remove. `--keep-staged` keeps it on request.
- **A failed import moves the copy to `.failed-<stamp>`** and reports where it is, so the next
  attempt starts from a clean box instead of "the drop box is not empty".
- **Staging the same vault again reuses the box** (`status: reused`) instead of refusing; a
  different vault in the box is refused with its storeId, and a box with no vault says so.
- `/keeper import` reports **"nothing new"** when the copy carried nothing and names the
  moved-aside path when the merge failed, instead of a bare stack-free error.

### New: `keeper doctor`

One read-only command that answers "what does this vault cost and what is lying around":

- `verify` status, sessions, bytes and frames;
- **unreferenced objects** and the bytes recoverable with `gc`;
- manifests, checkpoints and whether compaction is due (with the policy's own reason);
- the **size invariant** (vault bytes against unique session bytes, limit 1.1);
- **leftovers** in the home: drop box, `.imported-*`, `.failed-*`, `meta.json.before-upgrade-*`,
  locally packed tarballs;
- the undo window, if a journal is armed;
- totals, and exit code 1 only when the vault itself has a problem.

Measured on the real vault: `vault 28.4 MiB · sessions 16.0 MiB · reclaimable 11.2 MiB`,
ratio 1.777 — the command that made the pending compaction visible without running five others.

### Retention

- `keeper upgrade` keeps the **last three** `meta.json.before-upgrade-*` backups and deletes older ones.
## 0.1.0-rc.47 — 2026-11-08

### The merge still had two wrong ideas about what the vault already holds

- **The lineage is the union, not one manifest.** The newest manifest that *mentions* a session is a
  fragment: a snapshot writes only the new chunks. Measured on the real vault, that fragment had 12
  chunks where the union has 448, so the merge believed 2.6 MB were missing, appended them again and
  collided with the existing seqs. It now reads the lineage the way the reader does.
- **`publishedAttachments` returns a Map, and the merge indexed it like an object**, so every
  attachment looked new: importing would have re-sealed 619 KiB and written a manifest with the same
  ten blobs. Both the early check and the payload now use `.has()`.
- **Nothing complete to append means no entry.** A torn tail (or a session already covered to its
  last byte) produced an entry with an empty chunk list, which describes a gap; such entries are
  skipped, and a merge that writes nothing reports `changed: false`.

### Verified on the two real vaults

A dry run against the PC vault and the pendrive copy now says `changed: false`, 0 sealed bytes,
0 new attachments, verification ok — which matches what the comparison showed: the stick has
nothing the PC lacks.
## 0.1.0-rc.46 — 2026-11-08

### The merge was re-chunking what it should have appended

`/keeper import` failed in the field with `LATENCY`/`BYTE_GAP` on the session that was still being
written: the merge rebuilt the session's descriptor list from byte zero (re-chunking it), and the
reader then saw two different descriptor sets for the same session and reported a gap. The rollback
restored the previous vault, so nothing was lost.

- **Identical sessions are skipped.** If the local vault already holds the session up to the same
  byte, the merge writes nothing for it: no chunks, no manifest entry.
- **Merging appends.** A session that grew receives only the bytes it lacks, from the end of its
  current lineage, so its descriptors stay contiguous and nothing already published is re-chunked.
- **`reset` is real.** `writeManifest` now persists the field and the reader honours it (it used to
  drop it silently, which is what made a re-chunked list merge with the old one). Merging does not
  need it, but the contract says what it does.

### Measured on the two real vaults

Both verify ok, same storeId, 11 sessions each; ten are byte-identical and only `dd4e2186` differs
(PC 10.946.721 B vs pendrive 9.640.095 B, because that session is still growing). The stick had
nothing the PC lacks, so the correct outcome of that import is "nothing new" — which is what it does
now.
## 0.1.0-rc.45 — 2026-11-08

### Fixed after exercising the real host

- **`/keeper import F:\keeper-transfer` failed** with "no vault at F:\keeper-transfer": the drop-box
  staging expected the vault directory itself, but a pendrive carries `keeper-transfer/vault`.
  `stageIncoming` now accepts either, and says which two paths it looked at when neither exists.
- **The plugin's help was stale**: it still listed only the original six actions and did not
  mention `import`, `upgrade` or `undo`, nor where the drop box is. It now lists them.
- **`--swap` is gone.** It had done nothing since M1 (the import is in place) but was still accepted,
  and the launcher scripts still passed it; `recibir.ps1` and `vigia-montar.ps1` were updated with
  it, so nothing passes a flag that does nothing.
- **`init` honours `--home`.** It was hardcoded to the operator's real home, so `init --home <dir>`
  created a vault (and generated a key file) in the wrong place. That is also how a stray
  `~/.dsh/history-keeper.key` with a passphrase that opened nothing appeared during a test run; it
  was removed.
- **A key belongs to its vault.** With an explicit `--store`, the generated key is written next to
  it (`<store>.key`), not in the home of another vault, so a command naming a store never borrows a
  key that belongs to a different one.
- **The argument parser no longer confuses "no inline value" with "the value null"**, which had
  made every `--option value` be read as an empty option.
- **An unknown option no longer swallows the next flag.** `--old-thing --dry-run` used to make
  `--dry-run` the value of `--old-thing`, silently disabling a dry run. An option without an
  inline value now only takes the next token when it does not start with `--`.

### Confirmed in the field

`/keeper upgrade` on the real vault reported **already current**: the vault had been upgraded on
2026-11-08 (writer `0.1.0-rc.43`, minimum reader `0.1.0-rc.43`, retention with `autoGc`), and its
history was untouched.

## 0.1.0-rc.44 — 2026-11-08

### Closing the gaps that blocked the freeze

- **`keeper conform`**: validates *any* vault against the contract, not just the reference one:
  the format is one this build speaks, the reader can open it, a vault that asks for a newer format
  is refused with `FORMAT_TOO_NEW`, `verify` is ok, every session restores **byte for byte** into a
  temporary home, and a wrong passphrase is refused. It never writes to the vault.
- **The catalog reports the hash of each session** (`sha256`, the same value the restore check
  uses) and names the **host contract**: `dsh session log`, format version vN. Decision recorded:
  the DSH *app* version is not visible to a plugin, so "host" in the catalog means the host's data
  contract — the part the vault actually has to carry.
- **Conformance grew two checks**: the catalog must list every session with its hash, and a vault
  that demands a newer format must be refused with the code. The golden vault stays `store/1`.
- **`extract --raw`** writes the exact session file (`.jsonl.zstd`), which is what "faithful and
  reimportable" means; the secret gate decompresses it to inspect what it contains, so choosing
  raw does not bypass it.
- **`/keeper undo`** takes back what the last automatic import showed, from the conversation.

### Recorded amendments

- M4 shipped as `keeper extract` (not `export --jsonl/--readable`), and the render is **derived**,
  not stored encrypted: no duplicated state, no extra write per capture.
- M5's journal records the **session files created**, not "the previous vault": the swap it
  referred to was removed by M1.
## 0.1.0-rc.43 — 2026-11-08

### The vault catches up with the plugin

- **`keeper upgrade`** (and **`/keeper upgrade`**) adds what an older vault does not declare:
  `writer`, `minReader` (the M3 handshake) and `retention` (the M1 space policy). It records the
  upgrade in `meta.upgrades` with the previous values, and leaves a one-file rollback
  (`meta.json.before-upgrade-<stamp>`).
- **History is untouched.** No object is written or removed, no manifest is rewritten, no head
  moves; the test asserts the object count and the verified bytes are identical before and after.
  A vault that does not verify after the change gets its previous `meta.json` back.
- `--dry-run` reports the plan without writing, and `--no-retention` lets the operator adopt the
  handshake without silently changing the space policy.
- The upgrade refuses a vault that asks for a newer format, and is a no-op on a vault that is
  already current.

### Why this is a separate command

Writing the description of a vault is not the same as writing its history. Keeping them apart means
the upgrade can never be the thing that damages a vault, and the operator can see exactly what
changed (three fields, listed).
## 0.1.0-rc.42 — 2026-11-07

### M5 — import at start, with an undo

- **A drop box, not a magic folder.** Copy a carried vault into `<home>/history-keeper.incoming`
  (or `keeper import --stage F:\keeper-transfer`, which verifies it and leaves it there) and open
  DSH: the plugin imports it at mount.
- **The import is the M2 one**: merged in place, existing chunks referenced instead of re-sealed,
  verified before and after, nothing left behind except the merged history.
- **It never throws at start.** A vault that does not open with this machine's passphrase, does not
  verify, or is newer than the plugin is reported and skipped; the host starts anyway.
- **Undo, for what was shown, not for the history.** The import journals the exact session files it
  created; `keeper import --undo` removes those and nothing else, and refuses after the window
  closes: **7 days, or the first `keeper export`** (an export means the work travels on, so undoing
  locally would only hide it). The vault keeps the merged history; the journal is about the host.
- **`/keeper import [ruta]`** does the same from the conversation, staging an explicit path first.
- After an automatic import the plugin says how many conversations entered and that DSH must be
  reopened to see them: session files are read at start, so the notice is the honest part.

### Why the drop box

The plugin cannot know which pendrive is mounted, and a plugin that scans disks is a plugin that
imports the wrong thing. One path, verified, moved aside when used.
## 0.1.0-rc.41 — 2026-11-07

### M4 — plaintext extraction

- **`keeper extract --session <id> --out <file>`** writes one conversation as a readable Markdown
  transcript (`--jsonl` writes the decompressed log instead). This is the only operation that
  produces an unprotected file, so it is narrow by construction:
  - the destination is required and never overwritten (`--force` to replace on purpose);
  - a path inside the vault, the session tree or the attachment tree is refused;
  - the secret gate runs over the result; if it matches, nothing is written unless `--force`,
    and the report names the rules;
  - the first line says it: *PLAINTEXT COPY — not protected by the vault*.
- **The renderer never fails on the unknown.** It renders turns, user and assistant messages,
  reasoning (collapsible), tool calls and results, the session title and a note with the system
  prompt size; event types it does not know are listed in the header, not dropped silently. The
  same tool call is not printed twice when the host wrote it both inside the message and as a
  separate event.
- A readable copy carries a **BOM** so Notepad and Excel on Windows read it as UTF-8; the `jsonl`
  copy does not, because it must stay byte-comparable.
- The renderer is **derived**, never stored: the vault keeps the host's bytes, and the transcript
  is recomputed from them (same reasoning as the catalog: no duplicated state, no extra writes).

### Naming

The roadmap said `export --jsonl` / `export --readable`. It shipped as `keeper extract`, because
`export` already means "copy the vault to a pendrive" and overloading it would make both unsafe to
remember.
## 0.1.0-rc.40 — 2026-11-07

### M3 — format v1 and the version handshake

- **The vault says what it is.** `meta.writer` records the plugin that wrote it, and
  `meta.minReader` the oldest reader that can open it. New vaults declare both; older vaults are
  still read (the field is additive and absent means "unknown").
- **A reader checks before trusting.** `checkCompatibility` refuses a vault whose format is newer
  than this build (`FORMAT_TOO_NEW`) and warns, without refusing, when the vault wants a newer
  plugin (`PLUGIN_OUTDATED`). The CLI applies it on every command that opens a vault; the plugin
  warns once at mount.
- **`keeper catalog`**: every conversation organized by workspace, turns, frame and byte count,
  first and last event, captured-by, user, origin and archived continuations. It is **derived**
  from the chain, never stored: no duplicated state, no extra write per capture, and it cannot
  drift from what the vault holds.
- **`export --downlevel <version>`**: declares a copy readable by an older plugin. It refuses when
  the vault already requires something newer than the target, and records `downlevel`
  (`from`, `to`, `at`) in the copy's meta so the provenance is not lost.
- Capture records `capturedBy` (plugin version) and `user` per session, which is what makes the
  catalog answer "who wrote this, and for whom".

### Spec

`docs/SPEC-vault.md` documents `writer`, `minReader`, `retention`, the `gc`/archive rule and the
write rules (compare-and-swap, host marker). The catalog is described as derived, not stored.
## 0.1.0-rc.39 — 2026-11-07

### M2 — a reliable writer

- **Compare-and-swap on the head.** `writeManifest` accepts `expectHead`; if the head moved
  between preparing a payload and writing it, the write is refused with `HEAD_MOVED` instead of
  orphaning a manifest and leaving a hole in a session. `snapshot` and `compact` pass the head they
  prepared against.
- **A stale lock is only broken when its owner is gone.** Age alone let a live writer's lock be
  stolen on a slow disk or after a resume, which is how two processes ended up writing the same
  head in the field. The owner PID is checked; a live owner keeps its lock.
- **The newest descriptor wins.** The chain is walked newest first, but the per-`(session, seq)`
  dedupe kept the *last* descriptor — the oldest — so a stale manifest could resurrect an old
  lineage over the current one. The first descriptor now wins, with a regression test.
- **The CLI refuses to write while DSH is open.** The plugin writes `history-keeper-host.json` in
  the DSH home when it mounts and refreshes it on every capture; `snapshot`, `compact`, `gc --yes`,
  `import`, `restore` and `attachments` refuse with a clear message instead of racing the plugin.
  A marker left by a crashed host is detected and removed, so it cannot block a store forever.
  `--allow-host-open` exists for the case where the operator knows the plugin is idle.

### Why this order

These four close the mechanisms that damaged a vault on 2026-11-02; the roadmap makes M2 a hard
dependency of M5 (automatic import), because importing at start writes to the host's home.
## 0.1.0-rc.38 — 2026-11-07

### M1 — stop the growth

- **Compaction reclaims what it replaces.** After writing a checkpoint, the manifests it made
  unreachable are deleted at once (bounded, inside the same lock, after the checkpoint verifies).
  Retention can turn this off (`meta.retention.autoGc`).
- **`gc` no longer endangers archived continuations.** `referencedIds` ignored `archived` chunks, so
  a garbage collection would have deleted the very bytes the archive preserves. Fixed, with a
  regression test.
- **Retention lives in the vault** (`meta.retention`: `autoGc`, `compactAfterManifests`,
  `keepReplacedCopies`), so the policy travels with the data; new vaults get the defaults.
- **`import` works in place, without re-sealing.** The carried vault is brought into the local one
  by writing one manifest: chunks whose plaintext already exists are referenced, only new bytes are
  sealed, sessions that change are written with `reset`, and the previous archived lineages are
  re-listed so a reset does not lose them. The old path built a whole new vault and swapped it in,
  which multiplied the size on every trip. Importing the same vault twice now writes nothing.
- **`export` no longer leaves copies behind** by default (`--keep-replaced` restores the old
  behaviour), and **refuses to overwrite** a destination that holds sessions this vault does not
  have, or one it cannot open (`--replace` to force).
- `import --dry-run` reports the plan without writing.

### Measured on the real vault

Before: 252 objects, 202 referenced, **50 unreferenced (70.5 KiB)**, vault 14.19 MB against 14.11 MB
of session logs. The format overhead is ~80 KB; the growth came from transport copies, not capture.
## 0.1.0-rc.37 — 2026-11-04

### Added

- **`keeper capabilities --json`**: version, vault format and supported commands. A script asks what
  the installation can do instead of guessing from a version number.
- **Free-space check in `export`**: refuses to copy when the pendrive cannot hold the vault, with
  the numbers in the message (`checkSpace` is a pure function and is tested without a full disk).
- **`scripts/enviar.ps1` and `scripts/recibir.ps1`**: the transport as one line per side. They
  derive every path from `keeper paths`, find the pendrive by content (not by drive letter), check
  the CLI's capabilities, refuse to write with DSH open, verify the carried vault with its
  passphrase before touching anything, and report created / identical / refused / unreadable. Both
  run with `-Simulate` against temporary paths.

### Fixed

- The receive script assigned to `$home`, a read-only automatic variable in PowerShell, so the
  restore would have gone to the wrong directory. Renamed to `$dshHome`. Found by the simulation
  test, which is exactly what it is for.

### Verified

Six script tests on copies: send, receive, idempotence (second run reports identical), refusal with
DSH open, wrong passphrase, missing pendrive. Plus 127/127 unit tests.
## 0.1.0-rc.36 — 2026-11-03

### Added

- **`docs/SPEC-vault.md`**: the vault format written as a contract — layout, crypto, chunks,
  manifests, head union, verification rules, error codes, compatibility rules, and what is
  deliberately outside the contract.
- **`conformance/`**: a committed reference vault plus five checks any implementation must pass
  (opens, verifies, restores byte for byte, detects an altered object, refuses a wrong passphrase).
  `npm run conformance`, also run in CI on ubuntu and windows.
- **`docs/PHILOSOPHIES.md`**: the catalogue of philosophies and the line that separates a policy
  (same vault, same repo) from a fork (different contract). The v1.0 one is conservative.
- **`docs/adr/0001-filosofia-conservadora.md`**: the decision, its motives, its consequences and the
  alternatives rejected, dated.

### Changed

- CI now runs on `ubuntu-latest` and `windows-latest`, and runs the conformance suite after the unit
  tests and the session-data guard.
- README points at the contract, the philosophies and the ADR.
## 0.1.0-rc.35 — 2026-11-03

### Added

- **The prepare step of `import` reports what this host can read.** Before anything live is
  touched, each session of the merged vault is checked against this host's event vocabulary and the
  report says how many are readable and which ones are not, with the events that are missing. The
  operator learns "this needs a newer DSH" *before* swapping, not when opening a conversation.
- **A carried vault written in an unknown format is refused with an actionable message**: `import`
  names the format, the one this keeper speaks, and the first step (update the plugin), instead of
  failing later with a raw store error.

### Verified

Three tests: unknown format refused, a session with an unknown event reported as unreadable (and
not silently accepted), and a vault with no unknown events reported as fully readable.
## 0.1.0-rc.34 — 2026-11-03

### Added

- **`keeper import`**: the receiving half of the transport.
  - default: verifies the carried vault (`F:\keeper-transfer\vault`), merges it with the local one
    into a new directory and verifies the result. **Nothing live is touched**, so it is safe to run
    at any time; it prints the next step.
  - `--swap`: makes the merged vault the local one (the previous one kept as `.replaced-<ts>`, and
    put back automatically if the swapped vault fails verification) and restores its sessions into
    the DSH home byte-exact, reporting what was created, identical, refused and unreadable.
  - `--stick-key` (or a single file in `<stick>/key/`) supplies the carried vault's passphrase; the
    merged vault is sealed with the **local** passphrase, so the plugin keeps working.
- The merge in `import` uses the owner rule and reports the dedupe it achieved.

### Verified

On the real pair: carried vault 11 sessions / 8 461 frames / 12.3 MiB verified; merged 11 sessions,
1 archived, **7.9 MiB not stored twice**, prepared without touching the live vault.
## 0.1.0-rc.33 — 2026-11-03

### Fixed

- **The key must be resolved for the same vault the command opens.** With the new defaults, a
  command given an explicit `--store` also resolved the *default* vault to build the key path, so it
  could borrow this machine's key, open the foreign store with it and report `wrong passphrase`
  instead of `passphrase not set`. It now resolves the key for the store it is about to open; only
  the previous-layout vault keeps the previous-layout key.

### Note

rc.32 is deprecated: it shipped with this regression (the CLI test that asserts the exit code for a
missing passphrase failed).
## 0.1.0-rc.32 — 2026-11-03

### Added

- **`keeper export`**: verifies the vault, copies it to a pendrive and writes a receipt
  (`carry-<ts>.json`) with the store id, device, format, plugin version, totals, the verification of
  **the copy** (not just of the source), file/byte counts, the replaced directory if there was one,
  and a fingerprint of the passphrase — never the passphrase. It only reads the store, so it is safe
  to run with DSH open; the previous copy on the stick is kept as `vault.replaced-<ts>`.
- **`keeper paths` is now the CLI's default**: `status`, `verify`, `export`, `restore` and the rest
  resolve the vault and the key from `lib/paths.js` when no `--store`/`--key-file` is given, so the
  plugin, the CLI and the operator scripts cannot disagree about where things live. A vault in the
  previous layout (`<usuario>/keeper-vault`) is detected and used.

### Verified

`keeper status` and `keeper export --to <dir>` with no flags on the real machine: store resolved,
10 sessions / 7 494 frames / 11.1 MiB, copy of 662 files verified `ok`, receipt written.
## 0.1.0-rc.31 — 2026-11-03

**Rollback to the `0.1.0-rc.23` feature set.** The transport cycle added in rc.24–rc.30
(`carry`, `land`, `merge` with synthesis, `fuse`, `install`, `rebaseline`, `backup`) is removed:
it produced three corrupt session logs in a row because a DSH log is a state machine with an edit
history, not a list of lines. Versions rc.24–rc.30 stay published as a record and are deprecated.

### Added

- **`keeper paths`**: the single source of truth for where every keeper file lives, with the
  canonical layout (`<home>/history-keeper`, `.key`, `-device.json`, `.replaced-*`, `.backup-*`,
  `<home>/sessions`, `<home>/attachments`, the pendrive folder) and detection of the previous
  layout (`<usuario>/keeper-vault`), which keeps working until it is moved.
- `docs/LESSONS.md`: what the host's session format requires, what worked in the field, the design
  mistakes made here and the corrections worth re-applying.
- `docs/TRANSPORT.md`: the transport design that replaces the removed cycle — the vault travels as
  a folder, sessions are restored byte-exact, nothing is ever synthesized.

### Kept from this stage (for when the writer is revisited)

The lessons file records the fixes that were proven and then withdrawn: head CAS (`HEAD_MOVED`),
a stale lock only broken when its owner is gone, newest-descriptor-wins in the chain, and `carry`
writing with the device identity.
## 0.1.0-rc.30 — 2026-11-02

### Fixed

- `rebaseline` no longer refuses a fused log that is *smaller in bytes* than the published lineage.
  Two similar tails compress better together than apart, so byte size is not a measure of history;
  the guard was removed (the previous lineage is archived regardless, with its original
  descriptors).
## 0.1.0-rc.29 — 2026-11-02

### Fixed

- **A fused log could not be opened**: the host enforces a turn/step state machine, and a raw
  frame splice produced `turn/start does not open the expected turn`. Fusion now cuts at turn
  boundaries (the prefix keeps its last complete turn; each tail keeps only whole turns, dropping
  the partial turn at each seam) and **renumbers `data.turn` in the tails**, which both branches
  numbered from the same prefix. `seq` is renumbered as before. The fused log is validated against
  the host's own rules — `turn/start` must carry the next turn, `turn/end` must match the open one,
  and nothing may be left open at the end — before it is written.
- `install` now reports the event count of the installed log.
## 0.1.0-rc.28 — 2026-11-02

### Fixed

- **A rebaseline could not replace a lineage with a different chunk layout.** A log re-chunked in
  one pass (2 chunks) does not line up with a lineage published in small deltas (91 chunks), and the
  old descriptors would have mixed into the new lineage. Manifests now carry `reset`, which tells
  the reader that the session was recomputed: whatever an older manifest contributed to it is
  dropped. `rebaseline` refuses a log shorter than the published lineage (bytes, not chunk counts)
  and keeps the previous lineage as an archive entry with its original descriptors.
- The help text listed `inventory`, `lineage`, `fuse` and `backup` twice.

### Verified

A full rehearsal on a copy of the real vault: `install` wrote the 1357-event fused log and kept the
previous one as `.superseded-<ts>`; `rebaseline` published it as the visible lineage (2 chunks,
1.7 MiB), archived the previous one, and the vault verified with the visible buffer byte-identical
to the fused log.
## 0.1.0-rc.27 — 2026-11-02

### Added

- `keeper fuse --include <log>`: a lineage that lives outside the vault (another vault's entry, or a
  log on disk) can join the fusion. Measured on the real three-way case: 3 lineages, a 240-line
  prefix reused byte-for-byte, three tails ordered by when each one ends, 1357 events, last event
  2026-11-02 23:09.
## 0.1.0-rc.26 — 2026-11-02

### Fixed

- **A stale manifest could override the current one.** The chain is walked newest first, and the
  per-`(session, seq)` dedupe kept the *last* descriptor seen — the oldest. A rebaseline, a
  checkpoint or a merge could therefore resurrect an old lineage over the new one. The newest
  descriptor now wins.
- **Concurrent writers can no longer orphan a manifest silently**: `writeManifest` accepts the head
  a payload was prepared against and refuses (`HEAD_MOVED`) when it has moved. `snapshot` passes it.
  A two-process test snapshots the same store simultaneously for six rounds and the chain verifies.
- **A stale lock is only broken when its owner is gone.** Age alone let a live writer's lock be
  stolen, which is how two writers end up on one head.
- `carry` now snapshots with this machine's device identity, like the plugin, instead of writing
  through the legacy pointer.

### Added

- **`keeper install`**: puts a (fused) log into `~/.dsh/sessions`, keeping the previous one as
  `.superseded-<ts>`, and refuses a log whose events this host cannot read.
- **`keeper rebaseline`**: publishes that log as the session's visible lineage and moves the
  previous lineages to the archive, taken verbatim from the chain. Without it the new log would be
  seen as divergent and never backed up.
## 0.1.0-rc.25 — 2026-11-02

### Added

- **`keeper lineage`**: distinguishes **continued** conversations (two or more lineages of the same
  session) from **linear** ones, with each lineage's size and last event, and a flag when the
  visible copy is *not* the newest. This is the report that shows what the owner rule archived.
  Measured on the field vault: 3 continued, 6 linear, 12 lineages.
- **`keeper fuse`**: rewrites a continued conversation as **one log** — shared prefix, then each
  tail in a deterministic order (the one that ends first goes first, tie-broken by content hash, so
  every machine computes the same bytes). The prefix frames are reused byte-for-byte, so chunk
  dedupe still applies; only the tails are renumbered, starting after the prefix's last `seq`. The
  original lineages stay in the vault. Measured: `1f151636` = 1.0 MiB prefix + 558-event tail +
  1-event tail → 798 events, last event 2026-11-02 18:56.
- **`keeper backup`**: an exact copy of a vault taken **with the store lock held**, every file
  hashed into a manifest, and the copy verified. `verifyBackup` proves a copy later. It refuses a
  non-empty destination and never touches the source. This is the guard rail for any fusion:
  pc-a's vault was backed up (457 files, 9.6 MiB, `verify: ok`) before touching anything.

### Fixed

- `lastEventAt` was reading the raw (still zstd-compressed) session bytes; it decompresses now.
## 0.1.0-rc.24 — 2026-10-31

### Added

- **`keeper carry`**: updates the local vault, verifies it, copies the folder to a pendrive and
  writes a receipt (`carry.json`) with the store id, device, session/frame/byte counts and the
  verification result. The passphrase does not travel by default; only its fingerprint does, so the
  other side can confirm it has the right one. `--with-key` copies it explicitly, with a warning:
  the stick then holds the secret and the vault together.
- **`keeper land`**: verifies the carried vault, merges it with the local one, and makes the result
  the local vault. The previous local vault is kept as `<vault>.replaced-<stamp>`; the merged one is
  sealed with the carried passphrase, so one phrase closes the loop; the key file the plugin reads is
  rewritten with it. If the carried vault does not verify, nothing is mounted.
- **`scripts/keeper-carry.ps1` and `scripts/keeper-land.ps1`** in the operator folder (not the public
  repo, which must not carry private paths): the same two scripts work on any machine, deriving every
  path from the user profile. `land` refuses to run while DSH is open.
- Environment overrides for the scripts (`KEEPER_CLI`, `KEEPER_VAULT`, `KEEPER_KEY`,
  `KEEPER_DSH_HOME`, `DSH_NODE`) so they can be pointed at a test pair without editing them.

### Verified

A full round trip on the frozen pair: carry 5 sessions / 5.7 MiB; land produces 9 sessions, 1
archived continuation, **4.3 MiB not stored twice**, `verify: ok`; the return leg (carry from the
merged vault, land on the other side) keeps 9 sessions and verifies again.
## 0.1.0-rc.23 — 2026-10-31

### Decided

- **Owner rule approved** (was a proposal since 29-oct). A merged vault keeps **one visible
  conversation per session**: the lineage of the device that first published it. The other side of
  a divergence is archived — verified, never restored, listed by `inventory`. This is the
  project directive made mechanical: a restored session is read-only, so a machine that is not the
  owner cannot silently change what the conversation shows. The archiving can only ever happen on
  the non-owner side.

### Added

- `status` reports `archived N continuation(s) kept from a device that was not the owner`.
- `restore` reports the archived continuations in the vault (never writes them).
- `merge --on-divergence=owner|error`: `error` refuses to merge when the vaults disagree instead of
  archiving.

### Fixed

- The CLI now accepts `--key=value` as well as `--key value`; before, `--on-divergence=error` was
  silently swallowed and the merge ran with the default.
## 0.1.0-rc.22 — 2026-10-31

### Added

- **`keeper merge`**: combines two vaults into a **new** one without touching either source.
  - identical content → one copy;
  - one lineage a prefix of the other → the longer one wins, silently;
  - genuinely diverged → the owner's lineage stays visible and the other continuation is kept as
    an **archived** entry: verified like any other chunk, never restored, listed by `inventory`.
  - dedupe happens at the **chunk level** by content hash, so a shared prefix is sealed once.
- `--dry-run` for a merge writes nothing; `--out-key` supplies the passphrase of the new vault;
  the command refuses to write over an existing store.
- Archived continuations are verified by `verify` (reported in the totals) and shown by
  `inventory` under "archived continuations (kept, never restored)".
- Inventory now prefers the origin recorded **inside the manifest** over the local record, so a
  merged vault — or one restored on a third machine — still groups sessions by their true device.

### Measured on the frozen pair (pc-a 2026-10-30, pc-b 2026-10-30)

```text
sessions visible 9   archived 1   chunks sealed 23   reused 6 (4.3 MiB not stored twice)
verification ok   sessions 9   archived 1   frames 4385   6.5 MiB
```

The union of the two vaults reproduces the expected 9 conversations; the diverged session
(`dd4e2186`) keeps pc-a's 5.3 MiB lineage visible and pc-b's 4.6 MiB continuation archived. The
chunk-level dedupe saves **4.3 MiB**, far more than the 253.7 KiB that only counting identical
whole sessions suggested.
## 0.1.0-rc.21 — 2026-10-31

### Added

- **`keeper inventory`**: sessions grouped by the device they came from, with the local state of
  each one (`absent`, `identical`, `behind`, `ahead`, `different`) and whether this host can read
  it. Answers the question asked before mounting a vault: *what do I have, from where, and will it
  open here*.
- **Origin records**: when a session is restored, this machine publishes it from then on, but it
  did not write it. The origin is recorded in the DSH home and the inventory shows the session
  under its true device with an `importada` mark. Works for any number of devices, not two.
- **Compatibility preflight in `restore`**: the target host's event vocabulary is learned from its
  own sessions, and a session that uses types this host has never written is skipped with the list
  of those types. `--force` writes it anyway; `--no-preflight` disables the check.
- **Exit codes**: `0` everything done, `3` completed with refusals or skips (a predicted outcome,
  not a failure), `1` a real error — the distinction whose absence made an earlier restore look
  broken.

### Fixed

- The vocabulary sample defaulted to the six newest sessions, which produced a **false positive**
  on a real session (`assistant/attempt`, written by this host but only in an older log). The scan
  now covers every local session within a byte budget, and when the budget cuts it the result is
  **advisory** — a warning, never a skip.
## 0.1.0-rc.20 — 2026-10-31

### Added

- `/keeper compact` and `/keeper attachments` inside the conversation: both were CLI-only, which
  made the command surface look incomplete. They are safe operations (a checkpoint and a
  read-only backfill), so they belong where the rest of the commands live.

### Fixed

- The command hint advertised only `status | snapshot | verify | help` and the help text omitted
  `init`; both now list the whole surface and say which two operations stay in the CLI
  (`restore` writes the live store, `gc` deletes objects).
- The mojibake guard covered `package.json`, `README.md`, `lib/index.js` and `bin/keeper.js` but
  not `lib/plugin.js` or `README-es.md`; both are covered now.

### Note

- A `â€”` seen in the help during review was an artefact of reading UTF-8 with PowerShell 5.1,
  not a defect in the file. The guard is now driven by Node, so the diagnosis no longer depends
  on how a human opens the file.
## 0.1.0-rc.19 — 2026-10-30

### Fixed

- **Two writers could fork the chain and lose chunks.** On 2026-10-30 the plugin (still on
  rc.17) and the CLI (rc.18) wrote the same store at the same time: each read the head, wrote
  a manifest and moved the head, so one branch became unreachable and the survivor kept a gap
  — measured on one session: chunks 707–712 missing, `verify` refusing it.
  `snapshot`, `compact`, garbage collection and the attachment backfill now take an exclusive
  **store lock** (`LOCK`, created with the exclusive flag) for the whole read-head → write →
  move-head sequence. A writer that cannot get in fails with `STORE_BUSY` instead of corrupting
  the store; a lock older than two minutes (a crashed writer) is broken automatically.
- The plugin uses a one-second lock timeout and **reschedules** when the store is busy, so a
  concurrent CLI command never freezes the host event loop nor forks the chain.

### Note

- The data was not lost: the session logs on disk are the source of truth, and the forked vault
  was rebuilt from them (`verify: ok`, five sessions). The broken vault is kept aside, untouched.
- This is the failure mode the two-machine tests were meant to find. It was found locally,
  before any real sync existed.
## 0.1.0-rc.18 — 2026-10-28

### Added

- **One chain per device (phase C.1).** A store no longer has a single head in `meta.json`
  that two machines would overwrite for each other. Each device owns
  `devices/<deviceId>.json` and only writes its own head; reads walk **every** head and
  deduplicate by object id. `keeper status` shows how many heads a store holds.
- **Device identity is local.** `~/.dsh/history-keeper-device.json` (created on first use)
  holds this machine's id and name, so it never travels inside the shared store.
- Compaction acts on the device's own chain, and `gc` walks every head — it can no longer
  delete another device's manifests.
- A store written before devices existed is **adopted** by its first device instead of
  starting a second chain: no split, no re-publishing.

### Fixed

- The union can describe one chunk twice — a device's checkpoint and the older manifests it
  replaced remain reachable while the legacy pointer still points into the old chain.
  Verification now keeps one descriptor per `(session, seq)`, which is what actually happened,
  instead of reporting a false `SEQ_GAP`.

### Note

- Two devices can now write the same store without clobbering each other's head, but the
  histories are still **not reconciled**: merging sessions and resolving forks is C.2–C.4.
## 0.1.0-rc.17 — 2026-10-24

### Added

- **Checkpoints (compaction).** A checkpoint is one manifest that carries every chunk
  descriptor accumulated so far — every hash, every byte range — and starts a fresh chain.
  The next chain read is one file instead of hundreds, while `verify`, `restore`,
  `publishedState` and attachment capture keep working unchanged, because a checkpoint looks
  like a large manifest. What it gives up is *which snapshot added which chunk*: that
  provenance stays in the old manifests, which remain on disk as unreferenced objects.
  `keeper compact [--dry-run]`.
- **Deterministic policy** (`lib/policy.js`). Compaction is decided from the store's own
  shape — manifests since the last checkpoint, chunks the checkpoint would carry, store size,
  free space — and every decision carries its reason. Hard bounds: it refuses to build a
  checkpoint above the chunk cap or when free space is below a factor of the store size. A
  local model may propose parameters one day; this function decides.
- **`keeper gc [--yes]`.** Deletes objects the current chain no longer references. Chunk and
  attachment objects are always referenced by the checkpoint, so in practice it removes
  superseded manifests. Dry run by default; it refuses to delete without `--yes`.

### Changed

- The plugin compacts automatically after a snapshot when the policy says so
  (`autoCompact`, `compactMinManifests`, default 50), and `/keeper status` shows whether the
  chain starts at a checkpoint and when auto-compaction is armed.

### Note

- Old manifests are kept until an explicit `gc`, so a checkpoint never destroys the record of
  how the history was built — it only stops reading it.
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
