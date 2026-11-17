---
id: "10"
titulo: "Modo archivo"
estado: aprobado
version: "1.0"
depende_de: ["04", "06", "07", "08", "09"]
alimenta_a: ["13", "16", "17"]
ultima_revision: "2026-11-11"
---

# 10 — Modo `archivo`

El camino sellado: la bóveda se restituye al `home` de DSH con fidelidad byte a byte. Es el modo que
ya existe en 1.0.2 y el que **sostiene la promesa** del producto. En 2.0 pierde ceremonia, no
garantías.

## Qué hace

1. Abre la bóveda y valida la frase (C2).
2. Verifica y reconstruye todas las sesiones y adjuntos (C1, C4).
3. Clasifica cada elemento contra el `home` destino: `nueva`, `identica`, `divergente`,
   `incompatible`, `sin_destino`.
4. Escribe lo nuevo sin sobrescribir nada (C3).
5. Registra el journal y emite el recibo con procedencia (C6).

## Comandos

| Comando | Efecto |
|---|---|
| `keeper recover --store <dir>` | plan + apply con la política vigente (camino corto) |
| `keeper recover --plan` | sólo el plan |
| `keeper restore` | compatibilidad: alias de `recover` en modo `archivo` |
| `keeper import --from <soporte>` | copia la bóveda al `store` local y luego restituye |
| `keeper verify` / `conform` | se mantienen, y ya no son obligatorios antes de importar |

## El plan, en modo `archivo`

```text
plan archivo  store <dir>  →  home C:\Users\…\.dsh
  sesiones
    nueva           session-dd4e2186   10.7 MiB   1 452 chunks
    nueva           session-1f151636    2.3 MiB     312 chunks
    identica        session-adfd9b13  260 KiB      en su lugar
    divergente      session-9a347509   distinto contenido ya presente → se aparta
    incompatible    session-e4561671   el host no conoce 3 tipos de evento → aviso
  adjuntos          10 blobs  619 KiB   (7 presentes, 3 a crear)
  workspaces        G:\Mi unidad\…\dsh-history  existe · acad offline  no existe
  avisos            3   (ver detalle con --detalle)
  bloqueos          0
  estimación        ≈ 1.300 chunks · 16 MiB · 4 s
```

## Reglas de comportamiento

| Situación | Comportamiento | Cláusula |
|---|---|---|
| destino idéntico | se cuenta como `identica`, no se escribe | C3 |
| destino distinto | se aparta como `.incoming-<stamp>` **sólo con `--force`**; por defecto se rechaza esa sesión | C3 |
| sesión ilegible para el host | aviso; en `strict` se bloquea, en `default` se importa igual | D2 |
| adjunto ya presente e idéntico | `present`, no se toca | C3 |
| adjunto con distinto contenido | `ATTACHMENT_CONFLICT`, no se sobrescribe | C3 |
| objeto faltante o corrupto | aborta **todo** el apply | C4 |
| frase incorrecta | falla antes de escribir | C2 |

## Lo que cambia respecto de 1.0.2

| 1.0.2 | 2.0 |
|---|---|
| `conform` manual antes de importar | verificación automática, invisible |
| preflight bloquea por vocabulario | aviso; el bloqueo sólo en `strict` |
| exige `home` vacío en la práctica | no exige; resuelve por sesión |
| imposible importar con DSH abierto | sigue siendo recomendable cerrar, pero la guardia ya no es un muro: la CLI lo avisa y sigue en `archivo` sólo si el usuario insiste (`--allow-host-open`) |
| no hay undo | journal + `undo` |
| no hay recibo | recibo de una página |

## Por qué no se vuelve nativo

Porque su valor es la identidad byte a byte. Si el archivo lo escribiera DSH, dejaría de ser este
modo. La división es deliberada: `archivo` para probar, `uso` para trabajar (`11`).

## Criterios de aceptación

- `TC-1`, `TC-3`, `TC-4` en verde sobre la bóveda de referencia.
- El caso de la Prueba A (11 sesiones, 10 adjuntos) se resuelve con **un** comando y muestra una por
  una las que no pudo escribir, sin omitirlas en bloque.
- Ninguna sesión existente cambia de hash después de una importación.

## Preguntas abiertas

- ¿`restore` sobrevive como alias o se deprecia en 2.0? Dueño: producto. Propuesta: alias con aviso
  durante toda la línea 2.x.

## Qué sigue

`11-MODO-USO.md` para el camino nativo; `13-EXPERIENCIA-Y-SUPERFICIES.md` para cómo se ve todo esto.
