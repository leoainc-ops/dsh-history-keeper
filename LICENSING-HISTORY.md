# Licensing history

This document records **which license applies to which version**. It exists because the
project changed its licensing after it had already published releases, and because a license
that applied to a release cannot be taken back from whoever obtained it.

## Current model — from `0.1.0-rc.9` onward

| Artifact | License | File |
|---|---|---|
| Source code (`bin/`, `lib/`, `scripts/`, `test/`, `package.json`, `cordis.patch.yml`) | **PolyForm Noncommercial 1.0.0** | [`LICENSE-CODE`](LICENSE-CODE) |
| Documentation (`README*`, `CHANGELOG.md`, `docs/`, this file) | **CC BY-NC 4.0** | [`LICENSE-DOCS`](LICENSE-DOCS) |

Commercial use of the source code requires a separate license from the author. Open an
issue titled *"commercial license"* to start that conversation.

## Timeline

Dates are local to the author (UTC−03). npm publishes are UTC in the registry.

| Date | Event | License of the published artifact |
|---|---|---|
| 2026-10-21 | `0.1.0-rc.1`, `rc.2`, `rc.3` published | MIT |
| 2026-10-22 04:10 UTC | `0.1.0-rc.7` published (last release before the change) | MIT |
| 2026-10-22 12:15–13:32 | **Repository relicensed** (`5442ecd` … `047bc46`): top-level `LICENSE` renamed and replaced, `LICENSE-DOCS` added, READMEs updated | repository files: PolyForm Noncommercial + CC BY-NC |
| 2026-10-22 03:33 UTC | `0.1.0-rc.6` published | MIT |
| 2026-10-23 22:57 | `0.1.0-rc.8` published — **defect**: the code already came from the relicensed repository, but `package.json` still declared MIT, so npm recorded it as MIT. Deprecated by the author in favour of `rc.9` | declared MIT (unintentionally) |
| 2026-10-23 23:08 | `0.1.0-rc.9` published with corrected metadata: `SEE LICENSE IN LICENSE-CODE` | split model |
| 2026-10-24 | `0.1.0-rc.10`: `LICENSE` becomes a short index and this document ships inside the package | split model |

`0.0.0-stage` is not a release. It is the placeholder npm 11 creates while a publish is being
processed; it carries no code and no license field.

## What this means for versions obtained before the change

- **A published version keeps the license it was published with.** `0.1.0-rc.1` through
  `0.1.0-rc.7` were published under **MIT**: whoever obtained them may keep using, modifying
  and redistributing *those versions*, including commercially, under MIT.
- **`0.1.0-rc.8`** was published after the relicensing but its metadata still declared MIT,
  which was an error in the release, not an intent to license it under MIT. It is deprecated
  and superseded by `rc.9`. If you depend on `rc.8` and need certainty about your rights,
  contact the author before relying on it.
- **From `0.1.0-rc.9` onward** the split model applies: noncommercial for code, CC BY-NC for
  documentation.
- **Nothing above restricts your rights over copies you already have.** Relicensing changes
  what future versions are offered under; it cannot revoke a license already granted.

## Forks

As of 2026-10-24 there are **no forks** of either repository (the code repository
`dsh-history-keeper` and the private history repository `dsh-history`). If a fork is created
from a version published under MIT, that fork keeps MIT for the code it took; changes pulled
from later versions fall under the terms in force when those versions were published.

## Contributions

Contributions are welcome — the project aims to be a good citizen of the DSH plugin
community.

By opening a pull request you agree that:

1. your contribution is licensed under the project's current source license
   (**PolyForm Noncommercial 1.0.0**), and
2. the author may also license it, as part of the project, under a commercial license.

If point 2 is a problem for you or your employer, open an issue **before** writing code. It is
much better to discuss it first than to reject a contribution later, and there may be a
middle path (for example, a contribution limited to documentation, which is CC BY-NC).

## Nota en español (resumen; no sustituye el texto en inglés)

- **rc.1 a rc.7** se publicaron bajo **MIT**: quien las obtuvo puede seguir usándolas,
  modificarlas y redistribuirlas, incluso comercialmente, bajo MIT.
- **rc.8** salió después del cambio de licencia pero su metadata decía MIT por un error de
  publicación; está deprecada y la reemplaza **rc.9**.
- **Desde rc.9** rige el modelo dividido: código **PolyForm Noncommercial 1.0.0**,
  documentación **CC BY-NC 4.0**. El uso comercial del código necesita una licencia aparte.
- **No hay forks** del proyecto (verificado el 2026-10-24).
- Se aceptan contribuciones bajo la licencia vigente; si eso choca con tu empleador, abrí un
  issue antes de escribir código.
