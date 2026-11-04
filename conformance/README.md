# Conformance

The reference vault and the checks that define "this implementation speaks `store/1`".

```sh
npm run conformance
```

## What it proves

| Check | Meaning |
|---|---|
| opens with the test passphrase | the KDF and `keyCheck` match the spec |
| declares `dsh-history-keeper/store/1` | the format is the supported one |
| `verify` is ok | the chain, the hashes and the chunk ranges are valid |
| every session is restored **byte for byte** | the bytes that go back to the host are the bytes that were captured |
| one altered object is detected | integrity is checked, not assumed |
| a wrong passphrase is refused | it fails closed |

## The fixture

`fixture/vault` is a small real vault (two synthetic sessions, one chunked over several frames)
committed on purpose. `fixture/expected.json` holds the test passphrase, the store id and the
SHA-256 of every session log as it must come back.

Any implementation —this one, a fork, a policy package, a future rewrite— is conformant only if it
passes these checks against **this** fixture. That is what keeps the promise that a vault written
today can be read tomorrow by something else.

## Regenerating

Only when the format changes on purpose:

```sh
node conformance/make-fixture.mjs
```

It rewrites `fixture/` from a deterministic synthetic input. A fixture change is a **format
change**: it needs a spec version bump (`store/2`) and a migration note, never a silent edit.

## What it does not cover

- The host's own rules for session logs (turns, steps, edits): the keeper stores bytes and does not
  interpret them.
- Transport behaviour (`export` / `import`) and policies: those are tested in `test/`.
- Readability of a session by a *newer* host: that belongs to the host, and the keeper only detects
  and reports it (vocabulary preflight).
