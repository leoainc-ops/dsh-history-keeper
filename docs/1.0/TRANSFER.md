# Transfer between machines

The vault travels as a **folder**. What moves is the encrypted vault, never a transformation of it:
the same objects, the same manifests, the same store id. A machine that receives it merges it in
place — no second vault, no re-sealing, no copy left behind.

> This document replaces `TRANSPORT.md` (2026-11-04). That design used `carry`/`land` and a swap of
> complete vaults; the measurement that killed it is in `docs/LESSONS.md`: every trip multiplied the
> size. The commands it described no longer exist.

## The trip, in two commands

```bash
# 1. Sender. Export verifies the vault, copies it and writes a receipt.
keeper export --to F:\keeper-transfer

# 2. Receiver. Import verifies the carried vault and merges it in place.
keeper import --from F:\keeper-transfer --stick-key <file with the passphrase>
```

`export` can run with DSH open: it only reads. `import` needs DSH closed, because it writes the vault
and the session tree.

## What each step guarantees

| Step | Guarantee |
|---|---|
| `export` | the copy **verifies**; a destination with sessions this vault lacks is **refused** (`--replace` to force); the receipt carries the **fingerprint** of the key, never the key |
| `import` | the carried vault **verifies before anything is written**; the merge reuses existing objects and appends only missing bytes; the result is verified; on any failure the previous head and meta are **restored** |
| `restore` (inside import) | never overwrites: an existing log is refused, or with `--force` the incoming copy is written alongside as `.incoming-*` |

## The drop box (import at start)

If you would rather not import at that moment:

```bash
keeper import --stage F:\keeper-transfer --stick-key <file>
```

That verifies the carried vault and leaves it in `~/.dsh/history-keeper.incoming`. The next time DSH
starts, the plugin imports it — verified, merged in place, with the same protections — and **deletes
the staged copy** when it finishes (`--keep-staged` keeps it). A failed import moves the copy to
`.failed-<stamp>` and says where it is, so the next attempt starts from a clean box.

## Undo

An automatic import records the **session files it created** in
`~/.dsh/history-keeper.journal.json`:

```bash
keeper import --undo        # removes those files, nothing else
```

The window closes after **7 days** or on the **first export** — an export means the work travels on,
and undoing locally would only hide it. The vault is never un-merged: it is history, and undoing the
merge would mean deleting history. Undo is about what this machine shows.

## What travels, and what does not

| Travels | Does not travel |
|---|---|
| the vault folder (`meta.json`, `objects/`, `devices/`) | the passphrase (by default) |
| a receipt with the key's fingerprint | the key file |
| — | the host's session tree (that is what `import` restores) |

If a machine has never seen the vault, the passphrase must be carried once, used, and removed from the
stick. Recovery on a new host is: vault + passphrase.

## Rules that are not negotiable

1. **Verify before travelling and before mounting**: `keeper verify --store <copy>/vault`.
2. **Close DSH before importing, restoring or maintaining.** The CLI enforces it.
3. **Nothing is overwritten**: what is replaced is kept as `.replaced-*`, `.superseded-*`,
   `.broken-*` or `.incoming-*`.
4. **One vault, many machines.** Everything accumulates in the same store id; a divergence keeps both
   lineages (the owner's as visible, the other archived) instead of choosing silently.
