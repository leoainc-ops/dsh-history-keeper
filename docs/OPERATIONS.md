# Operations

## npm publish token

Publishing needs a **granular access token** with *bypass 2FA*, because `npm publish` runs
non-interactively. The token lives outside the repository, in `~/.npmrc`:

```text
//registry.npmjs.org/:_authToken=npm_…
```

| | |
|---|---|
| Token in use at the time of writing | id `752645`, name `dsh-history-keeper`, created 2026-10-21, **expires 2026-10-28** |
| Where it is stored | `~/.npmrc` (never in the repository, never in a commit) |
| What it needs | *Read and write*, package access limited to `dsh-history-keeper`, **bypass 2FA** |

### Rotating it

1. Create one at
   <https://www.npmjs.com/settings/leoainc-ops/tokens/granular-access-tokens/new>:
   - **Permissions**: Read and write
   - **Packages**: Only select packages → `dsh-history-keeper`
   - **Bypass 2FA**: enabled (without it, publishing fails with `E403 … Two-factor
     authentication or granular access token with bypass 2fa enabled is required`)
   - **Expiration**: as short as the release cadence allows; 90 days is a reasonable default.
     Put the date in a calendar — nothing warns you except a mail like the one that prompted
     this note.
2. Set it **without pasting the value into a chat, an issue, or a session log**:

   ```sh
   npm config set //registry.npmjs.org/:_authToken <the new token>
   ```

3. Revoke the old token on the same page (id `752645` at the time of writing).
4. Verify:

   ```sh
   npm whoami                                   # must print leoainc-ops
   npm publish --dry-run --tag latest           # from the repo root
   ```

   `whoami` proves the token authenticates. The dry run proves the *write* scope: a healthy
   token answers `cannot publish over the previously published versions`, which means the
   registry accepted the credentials and only refused the duplicate version. An `E401` means
   the token is missing or revoked; an `E403` means the scope or the 2FA bypass is wrong.

### Warning signs

| Symptom | Meaning |
|---|---|
| `E401 Unauthorized` | The token is absent, expired or revoked |
| `E403 … 2FA … required` | The token exists but was created without the 2FA bypass |
| `E403 … not authorized` | The token's package scope does not include this package |

The token from before this note expires **2026-10-28**. After that date, publishing fails
until it is replaced; nothing else in the project is affected, and installing from the
registry keeps working for everyone else.
