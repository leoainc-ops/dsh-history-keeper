---
id: "C"
titulo: "Digesto de la sesión «Montar la bóveda de keeper-transfer»"
estado: "histórico"
version: "1.0"
depende_de: []
alimenta_a: ["09", "10", "11", "14", "20"]
ultima_revision: "2026-11-16"
---

# C — Digesto de la sesión «Montar la bóveda de keeper-transfer»

Este anexo destila el conocimiento de la conversación de pc-b que originó el proyecto 2.0, para
que pueda citarse y usarse sin depender del panel de ese host.

**Origen verificable**

| | |
|---|---|
| Sesión | `session-adfd9b13-5036-4338-8e48-afd0a1f6552c` |
| Título | “Montar la bóveda de keeper-transfer” |
| Workspace | `C:\Users\<usuario>\Documents\deepseek-harness\default-workspace` |
| Fechas | 2026-11-10 18:20 → 2026-11-16 19:43 |
| Volumen | 37 turnos · 74 mensajes de usuario · 243 del asistente · 277 llamadas a herramientas |
| Bóveda | `6dd247c1…` (local de pc-a, verificada) y `e1a8f9bd…` (pc-b) |
| Texto completo | `montar-la-boveda.md` (13.859 líneas) — extracto de la bóveda con `keeper extract` |

Las referencias `L####` apuntan a ese archivo. Cada afirmación de este digesto tiene una línea de
origen; si una no la tiene, es interpretación y se marca como tal.

---

## 1. El hilo de la sesión, en cinco etapas

| Etapa | Turnos | Qué pasó |
|---|---|---|
| **1. Montaje fallido y rollback** | 1–3 | se intentó montar la bóveda en pc-b; el registro de workspaces no la mostraba; el usuario ordenó volver atrás y borrar la bóveda rota, sin respaldos |
| **2. Explicación del host** | 4–5 | se documentó cómo DSH gestiona workspaces y sesiones (árbol, `workspace.json`, `projectKey`, projcache, formato del log); se exportó a `ARQUITECTURA-workspaces-y-sesiones.md` |
| **3. Trazado de la bóveda** | 6 | se levantó el mapa de qué guarda la bóveda y de dónde sale cada byte (base de los anexos A y B) |
| **4. Diseño de 2.0** | 7–18 | modo nativo (entregar a DSH, no escribir archivos), contrato C1–C6, público objetivo, capas A/B/C, siete decisiones estructurales, portafolio de 22 documentos |
| **5. Recuperación y consolidación** | 19–37 | nombre del producto, exportaciones, bóveda rota (`SEQ_GAP`), montaje de `dd4e2186`, búsqueda de la conversación del “transportista”, consolidación de las dos bóvedas |

---

## 2. Decisiones tomadas (citables)

1. **Modo `uso` = entregar a DSH en lugar de escribir archivos.** El plugin crea la sesión con el
   **id, `cwd` y `createdAt` originales** y le pasa los eventos; DSH escribe, indexa y agrupa
   (L6413–L6416, L6484–L6486).
2. **Contrato C1–C6**: integridad, frase antes de escribir, nada se reemplaza, falla cerrado, formato
   `store/1` estable, procedencia obligatoria (L7473 y siguientes).
3. **Zona negociable D1–D5**: verificación invisible, preflight tolerante, secretos como aviso, no
   exigir home vacío, no cerrar DSH en modo `uso` (L7538 y siguientes).
4. **2.0.0 con rama nueva**, sin publicar nada desde pc-b (L7868).
5. **El nombre del producto es `dsh-history-keeper` 2.0.0**; “keeper-nativo” queda como referencia
   interna del usuario, no como nombre (L8572, L8683).
6. **Portafolio de 22 documentos** en `docs/v2/`, progresivo e intervinculado (L7651, L8850).
7. **Montaje “variante D”**: copiar el log al árbol y registrar el workspace; si no se puede
   registrar, dejarlo *Ungrouped* y que el usuario agregue el workspace desde la UI (L10908 y
   siguientes). Es el método manual con el que se montó `dd4e2186` (L11113).
8. **Consolidación**: una bóveda nueva con las dos, sin tocar las originales (L12706 y siguientes).

---

## 3. Hechos técnicos verificados sobre DSH 0.2.2-rc.1

| Hecho | Evidencia |
|---|---|
| `sessionPersistence.create(header, options)` acepta **header inmutable con `id` y `createdAt`**; lanza `SessionAlreadyExistsError` si el id existe; la sesión es visible al proceso al instante y el artefacto aparece en el primer `append` o `flush` | L6425–L6443 |
| `handle.append(events)` recibe un **lote contiguo en orden de `seq`**; `flush()` es la barrera de durabilidad; `stat(id)` observa sin leer; `list()` enumera; `open(id,'read')` relee | L6585–L6590, L6542–L6552 |
| `ctx.agents.create({ sessionId, cwd, agentPreset, reusable })` permite crear una sesión con **id explícito** | L6415 |
| `ctx.attachments` es un servicio de binarios inmutables que valida los bytes antes de publicar una referencia | L6554–L6560 |
| `ctx.workspaceRegistry`: `create(path,title)`, `attachSession(id)` — que **exige que el `cwd` del header resuelva con `realpath`, sea directorio y coincida con el path del workspace** —, `detachSession`, `archiveSession`, `pinSession`, `listStoredHeaders` | L11113 (comportamiento), y el código citado en `09` |
| El registro sólo **adopta** sesiones del disco cuando está **sin inicializar** (bootstrap); en un host ya usado, un archivo nuevo **no** se registra solo | `09` (código del host), evidencia de la prueba A |
| El árbol del home: `profiles/`, `sessions/`, `storages/`, credenciales, marcadores del keeper | L4415–L4449 |
| `sessions/<projectKey>/<sessionId>/session.v4.jsonl.zstd`; el `projectKey` escapa separadores y caracteres inseguros (`~XXXX`) y se envuelve en `--…--`, truncado a 251 | L4397 |
| `storages/workspace.json`: `unit/global/tables`; cada workspace con `path`, `title`, `sessionIds`, `createdAt`, `updatedAt`; globales `workspaceIds`, `archivedSessionIds`, `pinnedSessionIds`, `defaultWorkspaceId` | L4451–L4474 |
| `storages/session_projcache/sessions/<id>.json`: caché de proyección derivada (versión 7) | L4436–L4449 |
| Adjuntos en `~/.dsh/attachments/v1/objects/<dos hex>/<sha256>` | `09` |
| El log de sesión es un **historial de ediciones**, no una lista de mensajes: `turn`/`step` con máquina de estados, `surfaceOp`, `sourceEventSeq`, `shadowedSeqs` | `LESSONS.md` §1 (L10800–L10817) |

---

## 4. El problema de emparejamiento, con la evidencia de este caso

Tres montajes intentados, tres resultados distintos:

| Caso | Qué falló | Dónde |
|---|---|---|
| **Prueba A (2026-11-10)** | 9 de 11 sesiones no se restauraron: el preflight de vocabulario, aprendido del host, las marcó como ilegibles; las 2 restauradas no aparecieron porque el registro no las conocía | L3674 y siguientes |
| **`adfd9b13` (2026-11-16)** | se copió el log y se registró el workspace; el usuario confirmó “se ha montado la sesión” | L10908–L11113 |
| **`dd4e2186` en pc-a (esta sesión)** | el `cwd` es de otro host y no se puede crear (permisos); sin `cwd` válido no hay `attachSession` y el panel no la muestra | verificado el 2026-11-16 |

**Causa raíz**: la sesión tiene **identidad portable** (`sessionId`) pero **dirección no portable**
(`cwd`). DSH agrupa y valida por el `cwd`; el registro filtra lo que no resuelve. Un plugin que sólo
transporta bytes no puede emparejar dos hosts del mismo usuario si las rutas difieren.

**Consecuencia para el contrato**: el modo `archivo` restaura byte a byte, pero **no empareja**; el
modo `uso` empareja sólo si el `cwd` existe en el destino. Ninguno de los dos resuelve el caso “mismo
usuario, dos máquinas, rutas distintas”.

---

## 5. Lo que falta (insumo directo para 2.0)

1. **Traducción de `cwd` en el montaje**: mapear la ruta de origen a un workspace local, registrar la
   traducción en el recibo y conservar el original en la bóveda.
2. **`attachSession` desde el plugin**, sin cerrar DSH ni editar archivos.
3. **Detección de host ya usado vs virgen** para decidir bootstrap o attach.
4. **Preflight por catálogo del host** (`KNOWN_SESSION_EVENT_TYPES` + `ignorable`), no por vocabulario
   aprendido.
5. **Anexo como texto** (decisión de esta conversación): el conocimiento se transfiere como digesto
   con procedencia; la conversación no se mueve como sesión si el destino no la puede hospedar.

---

## 6. Preguntas abiertas

1. ¿La traducción de `cwd` es un mapa explícito (operador) o una heurística (misma ruta relativa)? —
   Dueño: producto. Propuesta: mapa explícito, registrado.
2. ¿Una sesión traducida conserva su `sessionId` y su `endSha256` originales, y se marca como
   traducida en el manifiesto? — Dueño: arquitectura.
3. ¿Qué pasa con los adjuntos cuando la sesión se traduce de host? — Dueño: arquitectura.
4. ¿El montaje traducido pertenece al modo `archivo` (con nota) o al modo `uso`? — Dueño: producto.

## 7. Qué sigue

`09-INTEGRACION-DSH.md` y `11-MODO-USO.md` para el attach; `20-RIESGOS` para el riesgo de
emparejamiento; y el spike P1–P4.
