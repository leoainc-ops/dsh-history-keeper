# Golden outputs

The exact CLI output for the seven read-only commands over `conformance/fixture/vault`, captured
before the F0 refactor. They are the safety net of the core/host split: **the refactor must not
change a single byte of what the CLI says** about the same vault.

| Archivo | Comando |
|---|---|
| `capabilities.txt` | `keeper capabilities` |
| `status.txt` | `keeper status` |
| `verify.txt` | `keeper verify` |
| `catalog.txt` | `keeper catalog` |
| `doctor.txt` | `keeper doctor` |
| `paths.txt` | `keeper paths` |
| `conform.txt` | `keeper conform` |

## Regenerate

```bash
node scripts/golden.mjs           # rewrite the files
node scripts/golden.mjs --check   # compare and exit 1 on any difference
```

The capture uses the fixture passphrase from `conformance/fixture/expected.json`, so it needs no
local vault and no network. Dates are normalized to `<ts>` before comparing, because `status` and
`doctor` render the vault's timestamps.

They are not wired into CI yet: K-06 turns this into the regression suite. `npm run golden` is the check.
