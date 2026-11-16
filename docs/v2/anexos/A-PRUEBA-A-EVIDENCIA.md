---
id: "A"
titulo: "Anexo A — Prueba A (evidencia histórica)"
estado: historico
version: "1.0"
depende_de: []
alimenta_a: []
ultima_revision: "2026-11-10"
---

# Anexo A — Prueba A: transporte e importación con 1.0.2

> **Documento histórico.** No se corrige ni se actualiza. Describe lo que ocurrió el 2026-11-09 y el
> 2026-11-10 en un host nuevo. Los documentos vivos que se derivan de esta evidencia son `03`
> (estado actual), `11` (modo `uso`) y `14` (plan de entrega).

## Qué se quería demostrar

Que la promesa central de 1.0.2 se cumplía fuera de la máquina donde se desarrolló: un Windows nuevo,
un DSH recién instalado, la bóveda del pendrive y la frase, y las conversaciones apareciendo en el
panel.

## Escenario

| Elemento | Valor |
|---|---|
| Host | `<usuario>`, Windows, sesión de usuario nueva |
| DSH | `0.2.2-rc.1` (con una reinstalación previa de `0.2.2`) |
| Plugin | `dsh-history-keeper@1.0.2`, instalado sin red desde `.tgz` |
| Bóveda | `<soporte>\vault`, 11 sesiones, 10 adjuntos, ~641 archivos |
| Frase | 12 caracteres, en el pendrive sólo para esta prueba |

## Lo que se hizo y lo que pasó

| Paso | Resultado observado |
|---|---|
| Copiar la bóveda al `home` | 638 objetos; `storeId` `6dd247c1…`, el esperado |
| Instalar el plugin sin red | primer intento falló por cómo se invocaba `pnpm`; el segundo instaló `1.0.2` |
| Ejecutar `keeper.js` directo | error de Windows Script Host (es un script de Node, no de JScript) |
| Comprobar la frase | 12 caracteres, sin saltos |
| `conform` | **7 ok**, `restores every session — 11 of 11`, `restores byte for byte` |
| `restore` | **2 sesiones creadas**, **9 omitidas** por "this host does not know …", 10 adjuntos creados |
| Abrir DSH | **las conversaciones no aparecieron** |

## El mensaje de las 9 omitidas

Cada sesión omitida listaba tipos de evento que el host "no conocía":
`agent/inbox/spliced`, `approval/asked`, `assistant/message`, `command/run`, `compaction/*`,
`deliverables/presented`, `feedback/message-put`, `job/*`, `request/context`, `session/title`,
`step/*`, `tool/call`, `tool/result`, `turn/end`, `turn/start`, `user/message`, `web/deepseek-search-llm-request`,
`workspace/changes`.

Entre ellos había eventos elementales (`user/message`, `tool/call`). Eso ya era la pista: el host
"no conocía" lo que él mismo escribe.

## Segunda pasada (2026-11-10)

| Hecho | Evidencia |
|---|---|
| La bóveda local estaba dañada | `verify` → `CHAIN_FAILED` (*cannot decrypt*), 0 sesiones |
| Causa | convivían el `meta.json` de la bóveda del pendrive con la cabeza de un dispositivo local sellado con **otra** frase (un `init` anterior) |
| La frase local no era la de la bóveda | `wrong passphrase`; 33 bytes contra 12 |
| `restore --no-preflight` | **11 sesiones creadas**, 10 adjuntos, verificación `12 de 12` |
| Panel de DSH | seguía sin registrarlas: `workspace.json` tenía **una** sesión, la de la prueba |

## Diagnóstico

1. **El preflight de vocabulario se auto-envenena.** Aprende del vocabulario de las sesiones que el
   host ya escribió. Con una sola sesión propia (y a mitad de turno), su vocabulario es incompleto y
   bloquea sesiones perfectamente legibles. La primera pasada creó 2 sesiones, y esas 2 empeoraron el
   vocabulario para la segunda.
2. **Restituir archivos no es registrar sesiones.** DSH lista y agrupa desde su registro de
   workspaces; un log en disco que nadie registró no aparece. Este es el hallazgo que origina el modo
   `uso`.
3. **Dos identidades de frase en la misma carpeta corrompen la bóveda.** La convivencia de un
   `meta.json` con una cabeza ajena produce una bóveda que no verifica y que parece "frase
   equivocada".

## Lo que esta prueba cambió en el producto

| Hallazgo | Consecuencia en 2.0 |
|---|---|
| preflight que bloquea de más | D2: tolerante por default (`04`, `12`) |
| archivos sin registro | modo `uso` (`11`) |
| ceremonia manual frágil | `recover` de un solo gesto (`13`) |
| sin rastro de lo importado | journal y recibo (`11`, `13`) |
| `conform` manual | verificación automática (D1) |

## Lo que esta prueba NO demostró

- No demostró que la bóveda fuera inválida: `conform` dio 7 de 7 y `restore` restituyó byte a byte.
- No demostró que la frase estuviera mal: la frase del pendrive abría la bóveda perfectamente.
- No demostró que el formato fallara: el formato nunca fue el problema.

El problema era de **entrega y de registro**, no de archivo. Esa distinción es la que sostiene la
decisión de 2.0.
