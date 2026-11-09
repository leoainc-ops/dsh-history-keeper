# Security

The vault protects session history with AES-256-GCM and a key derived from a passphrase. A bug in
this code can therefore mean lost history or a failed promise of confidentiality, so please report
privately first.

## Reporting a vulnerability

Open a **private** advisory at
<https://github.com/leoainc-ops/dsh-history-keeper/security/advisories/new> instead of a public issue.

Include: the version (`keeper capabilities`), the format (`store/1`), what you did, what happened,
and — if you can — the smallest vault that reproduces it. **Never include your real passphrase or a
real session log.**

## What is in scope

- the format and its reader (`lib/`): verification, hashes, chain, restore;
- the crypto layer: sealing, key derivation, key checks;
- the transport: export, import, the drop box, the journal;
- the extraction gate: a credential that the scanner misses.

## What is not in scope

- the host (DeepSeek Harness) itself;
- a stolen or unlocked machine, or a forgotten passphrase (there is no recovery by design);
- the plaintext copies that `keeper extract` writes **by explicit command** — that is the documented
  behaviour, with the gate and the warnings that go with it.

## What to expect

Acknowledgment within a few days, a fix in a patch release for the current `1.x`, and credit in the
CHANGELOG unless you prefer otherwise. There is no bug bounty.
