# Compatibility matrix

What this build was tested against, and what that does and does not prove. The format is `store/1`
and evolves by additive extension, so the interesting question is not "which version" but "which
reader, which vault, and what happens".

## What was tested (2026-11-09)

| Reader | Vault | Result |
|---|---|---|
| **rc.38** (`0.1.0-rc.38`) | written by **rc.48**, 11 sessions, 11.486 frames, 16,0 MiB | `verify: ok`; `restore` wrote **11 files**, byte for byte |
| **rc.48** | the same vault | `verify: ok` |
| **rc.48** | vault declaring `minReader.format = store/9000` | **refused**, exit 1: *"the vault requires format … or newer; this keeper speaks …"* plus the warning about the plugin version |
| **rc.38** | vault declaring a newer `minReader` | reads it: **rc.38 predates the handshake and cannot see the field** |

Host: **DeepSeek Harness `0.2.2-rc.1`**. Plugin: `0.1.0-rc.48` in the profile and in the repository.

## What the matrix proves

1. **A vault written by the newest build is readable and restorable by an older build** of the same
   format — the additive rule holds in practice, not only on paper.
2. **A new reader refuses a vault that asks for more than it can give**, with a code and a message,
   instead of guessing.
3. **The handshake only protects forward.** An old reader cannot know about a field invented after
   it was built, so it will read a newer vault without complaining. This is inherent to any additive
   format and is why the vault declares `minReader` (for readers that know the field) and why
   `export --downlevel <version>` exists (for the case where the *writer* must be honest about a
   target that is older than the vault).

## What is **not** covered

- **A second DSH version.** Only `0.2.2-rc.1` is installed on this machine. The plugin declares
  `engines.dsh >=0.1.0-rc.6 <0.3.0`, and the event vocabulary is compared at restore time, but a
  second host build has not been exercised here. This is the one gap in the matrix and it is
  recorded as such.
- **A third plugin generation.** rc.38 and rc.48 are two generations apart and that is the widest
  span tested. Versions before rc.38 lack the host guard and the handshake; they are not recommended
  for a shared vault.
- **Concurrent writers on two machines.** The design is one writer at a time per vault, and travel is
  offline (vault on a pendrive). There is no live sync by decision, so this is out of scope rather
  than untested.

## How to reproduce it

```bash
# an old reader, installed next to the current one
mkdir matrix && cd matrix
pnpm add dsh-history-keeper@0.1.0-rc.38

# verify and restore the current vault with it
node node_modules/dsh-history-keeper/bin/keeper.js verify  --store <copy>/vault --key-file <phrase>
node node_modules/dsh-history-keeper/bin/keeper.js restore --store <copy>/vault --key-file <phrase> --home <empty home>

# the current reader refusing a newer format
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('<copy>/vault/meta.json'));m.minReader={format:'dsh-history-keeper/store/9000',plugin:'99.0.0'};fs.writeFileSync('<copy>/vault/meta.json',JSON.stringify(m,null,2))"
keeper verify --store <copy>/vault --key-file <phrase>   # exit 1, FORMAT_TOO_NEW
```

## Policy that follows from this

| Situation | What to do |
|---|---|
| the vault asks for a newer format than your plugin speaks | update the plugin; **do not** try to read it |
| the vault was written by a newer plugin but the same format | it is readable; the plugin warns and names the version |
| you must hand a copy to an older machine | `keeper export --downlevel <version>`; it refuses if the vault already requires more |
| a vault from before the handshake | `keeper upgrade` adds `writer`, `minReader` and `retention` without touching history |
