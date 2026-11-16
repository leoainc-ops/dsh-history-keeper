---
id: "11"
titulo: "Modo uso"
estado: revisado
version: "0.9"
depende_de: ["04", "06", "08", "09"]
alimenta_a: ["13", "14", "16"]
ultima_revision: "2026-11-11"
---

# 11 — Modo `uso`

La novedad de 2.0: en lugar de escribir archivos, el plugin **entrega la conversación a DSH** para
que DSH la escriba, la indexe y la agrupe. Es la respuesta al `Ungrouped` y al "cerrá DSH y
reabrilo" de 1.0.2.

> Estado `revisado`: depende de las confirmaciones `P1–P4` de `09`. No pasa a `aprobado` ni a
> default hasta que exista el spike.

## Qué se gana y qué se resigna

| | Modo `archivo` | Modo `uso` |
|---|---|---|
| id, `cwd`, `createdAt`, orden y contenido de eventos | sí | **sí** |
| bytes exactos del archivo | **sí** | no: lo escribe DSH |
| el archivo lo escribe | el plugin | **DSH** |
| aparece agrupada | no | **sí** |
| DSH puede resumir/bifurcar/seguir | tras reiniciar | **sí, inmediato** |
| historial en claro en disco | **sí** (es el árbol de DSH) | **sí** |
| necesita cerrar DSH | sí | **no** |

La última fila con "sí" en las dos columnas es la que hay que decir en voz alta: **en los dos modos
el historial queda en claro en el `home` de DSH**. La diferencia es que `archivo` además conserva el
original cifrado y su prueba.

## Flujo

```text
1. capabilities()            ¿hay sessionPersistence y workspaceRegistry?
2. core/vault.open()         frase, meta (C2)
3. core/verify.collect()     sesiones verificadas (C1, C4)
4. preflight                 vocabulario del host, formato, tamaño
5. consentimiento            primera vez: aviso de texto en claro + confirmación
6. create(header)            id, cwd, createdAt, isSeeded originales
7. append(eventos)           lotes contiguos por seq
8. flush() · close()
9. workspace                resolveByPath(cwd) ?? create(cwd) → attachSession(id)
10. releer y sellar         open(id,'read') → sello == sello de origen   (C6)
11. journal · recibo
```

## Preflight

| Chequeo | Si falla |
|---|---|
| formato del log soportado por el host | rechaza esa sesión; las demás siguen |
| vocabulario de eventos conocido por el host | `strict`: rechaza · `default`: publica con aviso |
| sesión ya existe con el mismo `id` | ver colisiones |
| tamaño | publica por streaming, sin cargar todo en memoria |
| `cwd` existente | si no existe: publica igual, sin agrupar; el plan propone crearla |

## Colisiones

`create` lanza `SessionAlreadyExistsError` si el `id` ya está. Política (`--on-conflict`):

| Valor | Comportamiento |
|---|---|
| `refuse` (default) | no se toca nada; el recibo lo dice |
| `new-id` | se publica con un `id` nuevo y el título original entre paréntesis |
| `archive` | se archiva la existente con `archiveSession` y se publica la nueva |

Nunca `overwrite`. Si la sesión existente tiene el mismo sello, es `identica`: no se escribe nada.

## Sello y procedencia (C6)

- Sello calculado antes (`08`) y después de publicar; deben coincidir.
- Se registra `{storeId, deviceId, deviceName, endSha256, modo:"uso", publicadoEn}` en el journal y
  en el recibo.
- El recibo debe permitir a un tercero re-extraer el original de la bóveda y recalcular el sello.

## Repliegue y errores

| Situación | Comportamiento |
|---|---|
| falta `sessionPersistence` | el modo no se ofrece; `archivo` sigue disponible |
| falla `append` a mitad | se cierra el handle; la sesión queda como pendiente del host; el journal no registra y el recibo marca la falla |
| falla `attachSession` | la sesión queda publicada y sin agrupar; se informa, no se revierte la publicación |
| falla el sello final | se marca `sello_distinto`; no se borra nada; el recibo obliga a mirar |
| el usuario cancela | aborta entre lotes; nunca a mitad de un `append` |

## `undo`

`keeper undo` borra las sesiones que el journal registra como creadas por el plugin en los últimos
7 días, y desagrupa (no borra) los workspaces creados por él. No toca la bóveda.

## Criterios de aceptación

- Una sesión importada aparece en el panel **agrupada y sin reiniciar**.
- Reimportar la misma bóveda es `no-op` (0 escrituras).
- Una sesión divergente no se sobrescribe en ninguna política.
- Con la API ausente, el plugin cae a `archivo` sin error visible.
- El sello coincide en las 11 sesiones del caso de referencia.

## Preguntas abiertas

- ¿El default de 2.0 es `uso` o `archivo`? Dueño: producto. Propuesta: `archivo` al instalar, y
  `uso` ofrecido explícitamente al importar en una máquina propia.
- P1–P4 de `09`.

## Qué sigue

`12-CONFIANZA-Y-PRIVACIDAD.md` para el aviso de texto en claro y la política de confianza.
