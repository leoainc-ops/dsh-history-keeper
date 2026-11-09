# Operations

The vault has one job: keep the history of your DSH sessions so nothing is lost, and let it travel
between machines without duplication. This is how it is operated day to day.

## The normal cycle (nothing to do)

With DSH open, the plugin captures on `session/flush`, verifies what it wrote, compacts when the chain
grows past the threshold and reclaims what it replaced. You do not run anything.

`/keeper status` answers the only question that matters: what the vault holds, what is pending, and
what this machine is missing.

## The rule that prevents damage

**One writer at a time.** With DSH open the plugin is the writer; the CLI refuses `snapshot`,
`compact`, `gc --yes`, `import`, `restore` and `upgrade` and says so. Closing DSH is a one-second
operation and it is always cheaper than a race.

The reverse also holds: with DSH closed, the plugin is not running, so nothing captures — that is the
moment for maintenance.

## Maintenance

| When | What | Command |
|---|---|---|
| The vault grows beyond what it holds | measure first, then compact and reclaim | `keeper doctor`, then `compact` + `gc --yes` |
| A vault was created by an older build | add the handshake and retention | `keeper upgrade` |
| You want to know if a copy is healthy | validate any vault against the contract | `keeper conform --store <dir>` |
| An object was damaged | fail closed and read the code | `keeper verify` |

The size invariant is the number to watch: **vault bytes ≤ 1.1 × unique session bytes**. `doctor`
prints the ratio. With the current vault it is 1.059.

## Travel (see `TRANSFER.md`)

```bash
keeper export --to F:\keeper-transfer          # sender, DSH may stay open
keeper import --stage F:\keeper-transfer       # optional: leave it for the next start
keeper import --undo                           # take back what the last automatic import showed
```

## When something goes wrong

| Symptom | Meaning | What to do |
|---|---|---|
| `DSH is open on this machine` | the guard stopped a write that would race the plugin | close DSH and repeat |
| `wrong passphrase` | the key file is not the vault's | check `--key-file`; the diagnosis names the store id and a fingerprint |
| `verify` returns `HASH_MISMATCH` | an object was altered or damaged | restore a `.replaced-*` copy, or restore the session from another machine |
| `FORMAT_TOO_NEW` | the vault was written by a newer plugin | update the plugin on this machine |
| `the vault does not verify after the upgrade` | the upgrade was rolled back automatically | nothing was lost; re-run `keeper doctor` |
| the drop box is not empty | an earlier import left a copy | import it (it is reused) or remove it; `doctor` shows the size |
| an import failed | the merge found something inconsistent | the previous state was **restored**; the copy is at `.failed-<stamp>` |

## What the vault does not protect

- A forgotten passphrase: there is no recovery. Keep a copy of the phrase somewhere safe, and never
  inside the vault or the pendrive.
- A machine left unlocked with the vault accessible.
- Bugs in the host while it writes a session.
- A deliberately wiped disk. The vault is a copy, not a mirror.

## Where things are

| Path | Content |
|---|---|
| `~/.dsh/history-keeper/` | the vault (`meta.json`, `objects/`, `devices/`) |
| `~/.dsh/history-keeper.incoming` | drop box: a vault left here is imported at the next start |
| `~/.dsh/history-keeper.journal.json` | what the last automatic import showed, and until when it can be undone |
| `~/.dsh/history-keeper-host.json` | the running host's marker (pid); it is what the CLI guard reads |
| `~/.dsh/history-keeper-device.json` | this machine's identity |

`keeper paths` prints the canonical list for the current home.
