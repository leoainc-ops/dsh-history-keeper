---
id: "09"
titulo: "Integración con DSH"
estado: revisado
version: "0.9"
depende_de: ["04", "06", "07"]
alimenta_a: ["10", "11", "18", "20"]
ultima_revision: "2026-11-11"
---

# 09 — Integración con DSH

Qué servicios del host usa el plugin, con qué semántica, y qué pasa cuando no están. Verificado
sobre DSH `0.2.2-rc.1`.

> Estado `revisado` y no `aprobado`: cuatro puntos de la §5 están pendientes de confirmación con una
> prueba de código (`spike`). Se aprueban cuando exista evidencia.

## 1. `ctx.sessionPersistence` — el escritor de sesiones

Backend `@deepseek-ai/dsh-session-persistence-jsonl`.

| Operación | Semántica verificada | Uso en 2.0 |
|---|---|---|
| `create(header, opts?)` | el header es inmutable, con `id` y `createdAt` propios; la sesión queda visible al proceso al instante; el artefacto aparece en el primer `append` o `flush`; si el `id` ya existe lanza `SessionAlreadyExistsError` | crear la sesión con el **id original** |
| `handle.append(events, opts?)` | lote **contiguo en orden de `seq`** | publicar por lotes |
| `handle.flush(opts?)` | barrera de durabilidad; materializa el artefacto aunque no se haya agregado nada | cerrar la publicación |
| `handle.close()` | idempotente | liberar |
| `stat(id)` | observa sin leer el log: `header`, `sizeBytes`, `formatStatus`, `location.path` | verificar después de publicar |
| `list()` | artefactos materializados + sesiones creadas por este proceso | inventario del host |
| `open(id,'read')` | selecciona la generación más alta; migra versiones históricas al leer | releer para el sello |

**Reglas de uso.**

1. El `header` se arma con el original: `id`, `cwd`, `createdAt`, `isSeeded`, `delegationDepth`,
   `agentPreset`. Si el servicio ignora alguno, se documenta la diferencia en el recibo.
2. `append` recibe los eventos **en orden**, sin huecos de `seq`. Si el log de origen tiene un hueco,
   no se publica: es `C4`.
3. Nunca se llama a `create` sin haber verificado la frase (`C2`) y sin haber planificado.

## 2. `ctx.workspaceRegistry` — la agrupación

| Operación | Semántica verificada | Uso en 2.0 |
|---|---|---|
| `resolveByPath(path)` | resuelve por ruta canónica (`realpath`); **rechaza si la ruta no existe**; no crea | buscar el workspace del `cwd` |
| `create(path)` | registra la carpeta; si ya existe devuelve el existente | crear sólo si el usuario lo autoriza |
| `ws.attachSession(sessionId)` | cuenta la sesión al workspace, en orden manual | agrupar |
| `archiveSession(id)` | archiva sin tocar el lugar de la fila; exige sesión inactiva salvo `stopActivity` | política de colisión (`11`) |

**Regla:** si el `cwd` no existe en esta máquina, la sesión se publica **igual** y queda en
*Ungrouped*; crear la carpeta es una acción separada que el plan propone y el usuario aprueba.

## 3. `ctx.agents` — creación con identidad

La creación de sesión acepta `sessionId` explícito y un predicado `reusable`. Se usa sólo si
`sessionPersistence.create` no alcanza para que la sesión aparezca en el panel; preferencia: **no**
crear agentes para importar historia (no hay trabajo que ejecutar).

## 4. `ctx.attachments` / `ctx.fs` — los blobs

Los adjuntos son direccionados por contenido: el log los referencia como
`"attachmentId": "sha256:<64 hex>"` y su lugar es `attachments/v1/objects/<h[0:2]>/<h>`.

- Si el servicio expone publicación genérica → se usa.
- Si sólo expone lotes de imagen → se escribe el blob verificado por `sha256` con `ctx.fs` en la ruta
  contractual. Es idempotente por construcción.

## 5. Puntos pendientes de confirmar (spike)

| # | Pregunta | Cómo se responde |
|---|---|---|
| P1 | ¿`attachments` publica archivos que no son imagen? | leer la interfaz del servicio y probar un `put` |
| P2 | ¿`create(header)` conserva `agentPreset`, `delegationDepth`, `isSeeded`? | crear una sesión y comparar `stat().header` |
| P3 | ¿`inheritedEventCount` debe pasarse para sesiones sembradas? | importar una sesión con `isSeeded:true` y comparar |
| P4 | ¿`attachSession` refresca el índice del panel sin reiniciar? | importar y observar el panel en la misma sesión de DSH |

Hasta que P1–P4 estén respondidas, el modo `uso` queda detrás de un flag y no es el default.

## 6. Compatibilidad

| Aspecto | Regla |
|---|---|
| Piso de DSH | el que tenga `sessionPersistence.create/append/flush`; hoy `0.2.2-rc.1` |
| Techo | no se declara; se degrada por capacidades |
| Si falta `sessionPersistence` | modo `uso` no se ofrece; `archivo` sigue |
| Si falta `workspaceRegistry` | se publica y se avisa que queda sin agrupar |
| Si cambia la firma de un servicio | el adaptador falla en `capabilities()` y no en el momento de escribir |

## 7. Lo que el plugin NO usa

- No lee `workspace.json` ni `session_projcache` por su cuenta: pide por servicio.
- No escribe en `sessions/` en modo `uso`.
- No crea agentes ni ejecuta turnos.
- No toca credenciales, perfiles ni configuración de DSH.

## Preguntas abiertas

- P1–P4 (§5). Dueño: arquitectura. Bloquean la aprobación de este documento y la Fase 2.

## Qué sigue

`10-MODO-ARCHIVO.md` y `11-MODO-USO.md`, que consumen estos servicios.
