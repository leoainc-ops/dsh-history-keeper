# Operations

## npm publishing

Publishing is a **human-authenticated** action, and npm is making it more so on purpose.
Granular access tokens that *bypass* 2FA have already lost account and package management
(they require an interactive challenge), and according to
[the npm changelog of 2026-07-31](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)
they will **lose direct publish around January 2027**: their publishing surface reduces to
reading private packages and *staging* a publish that a maintainer approves with 2FA. The
recommended replacements are
[trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers) and
[staged publishing](https://docs.npmjs.com/staged-publishing).

### The state on 2026-10-28

The first replacement token (id `c7e95d`) was created **without** the 2FA bypass, so it could
read but not publish:

```text
http fetch PUT 401 … EOTP: OTP required for authentication
Open this URL in your browser to authenticate: https://www.npmjs.com/auth/cli/…
```

That is npm asking for an interactive challenge for the write — no browser means no publish.
Validating 2FA in the browser does **not** change the token the CLI uses; only the token in
`~/.npmrc` matters.

The token now in `~/.npmrc` (id `0eeed3a3`, name `dsh-history-keeper`, created 2026-10-28,
expires 2027-01-26) has **`bypass_2fa = true`**, and the publish path was verified: publishing
the current version answers

```text
PUT 403 … You cannot publish over the previously published versions: 0.1.0-rc.17.
```

which is the *success* signal — the registry accepted the credentials and refused only the
duplicate. An `EOTP` here means the bypass is missing; `E401` means the token is absent or
revoked.

Two deadlines apply to this token: its own expiry (2027-01-26) and npm's removal of direct
publishing from bypass tokens (around January 2027). Both point at the same migration, so the
bypass token is a bridge, not a destination:

| Path | Works until | Effort |
|---|---|---|
| **Trusted publishing (OIDC)** from GitHub Actions: the workflow publishes on a tag with `id-token: write`; no long-lived secret at all | indefinitely | a workflow file plus a one-time configuration on npmjs.com |
| **Staged publishing**: `npm stage publish`, then approve the stage with 2FA in the browser | indefinitely | per release, a human approval |
| **Interactive publish**: `npm login`, then `npm publish` in the same session | until the session ends | per release, a browser login |
| Re-create the token **with** *bypass 2FA* enabled | **January 2027**, when direct publish is removed | one-time, but a dead end |

The project's own runtime never needs a token: the plugin, the CLI and the vault make no
network calls. Only *shipping a new version* is affected.

### Rotating a token (legacy path, until January 2027)

1. Create one at
   <https://www.npmjs.com/settings/leoainc-ops/tokens/granular-access-tokens/new>:
   - **Permissions**: Read and write
   - **Packages**: Only select packages → `dsh-history-keeper`
   - **Bypass 2FA**: enabled (without it, publishing fails with `EOTP`/`E403 … 2FA … required`)
   - **Expiration**: as short as the release cadence allows; 90 days is a reasonable default.
     Put the date in a calendar — nothing warns you except a mail like the one that prompted
     this note.
2. Set it **without pasting the value into a chat, an issue, or a session log**:

   ```sh
   npm config set //registry.npmjs.org/:_authToken <the new token>
   ```

3. Revoke the old token on the same page.
4. Verify:

   ```sh
   npm whoami                                   # must print leoainc-ops
   npm publish --tag latest                     # must fail ONLY on the duplicate version
   ```

   `whoami` proves the token authenticates. The publish proves the *write* path: a healthy
   credential answers `cannot publish over the previously published versions`, which means the
   registry accepted the credentials and refused the duplicate. `EOTP` means an interactive
   challenge is required; `E401` means the token is missing or revoked; `E403 not authorized`
   means its package scope is wrong.

| | |
|---|---|
| Token in use at the time of writing | id `c7e95d`, name `dsh-history-keeper 29102026`, created 2026-10-28, **expires 2027-01-26**, `bypass_2fa = false` |
| Where it is stored | `~/.npmrc` (never in the repository, never in a commit) |
| What a legacy token needs | *Read and write*, package access limited to `dsh-history-keeper`, and **bypass 2FA** — a capability npm is retiring for publishing in January 2027 |


## Recovering a forked chain

Symptom: `verify` reports `SEQ_GAP` for a session and that session disappears from `status`.
Cause: two processes wrote the store at the same time (before rc.19, which added the lock), so
one manifest became unreachable and the surviving chain kept a hole.

The session logs on disk are the source of truth; the vault is the copy. Rebuild rather than
repair:

```powershell
# 1. keep the damaged vault, do not delete it
Move-Item C:\Users\<you>\keeper-vault C:\Users\<you>\keeper-vault.forked-<date>

# 2. a fresh store with the SAME passphrase, so the existing key file keeps working
node bin/keeper.js init --store C:\Users\<you>\keeper-vault --key-file <passphrase file>

# 3. publish everything again from the intact session logs
node bin/keeper.js snapshot --store C:\Users\<you>\keeper-vault --home $env:USERPROFILE\.dsh

# 4. prove it
node bin/keeper.js verify --store C:\Users\<you>\keeper-vault --key-file <passphrase file>
```

The rebuilt vault has a new `storeId` (it is a new store) and the same device identity. The
forked one stays usable for forensics: open it with the same passphrase.

If the snapshot refuses a session with `QUARANTINED`, the reason is printed per rule; publish
with `--force` only after checking that the match is not a real credential.