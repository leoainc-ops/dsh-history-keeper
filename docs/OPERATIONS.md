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

The token in `~/.npmrc` (id `c7e95d`, name `dsh-history-keeper 29102026`, expires
2027-01-26) has `bypass_2fa = false`. Authentication and reads work (`npm whoami`, `npm view`
are fine), but `npm publish` answers:

```text
http fetch PUT 401 … EOTP: OTP required for authentication
Open this URL in your browser to authenticate: https://www.npmjs.com/auth/cli/…
```

That is npm asking for an interactive challenge for the write, which is the direction the
registry is moving. Three ways forward, in order of durability:

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

