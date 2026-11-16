---
id: "17"
titulo: "Operaciones y soporte"
estado: borrador
version: "0.8"
depende_de: ["10", "11", "13"]
alimenta_a: ["20"]
ultima_revision: "2026-11-11"
---

# 17 — Operaciones y soporte

El runbook de quien atiende. Todo síntoma tiene causa y acción; nada se resuelve "probando".

## Instalación

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add dsh-history-keeper@2.0.0
# o, sin red:
pnpm add <soporte>\install\dsh-history-keeper-2.0.0.tgz
```

Reiniciar DSH una vez. No hay migración de bóveda: si había 1.0.2, sigue funcionando (`18`).

## Actualización desde 1.0.2

1. La bóveda no se toca.
2. Cambian los defaults (`strict` → `default`): leer el aviso de `12`.
3. Si se quiere el comportamiento anterior: `keeper config set policy strict`.
4. Reimportar la misma bóveda es no-op.

## Diagnóstico rápido

```text
keeper status          ¿hay bóveda? ¿cuántas sesiones? ¿qué falta publicar?
keeper doctor          ¿cuánto ocupa? ¿qué restos hay? ¿estoy cubierto?
keeper doctor --privacidad   ¿qué está en claro en esta máquina?
keeper capabilities    ¿qué puede hacer este host con esta versión?
```

## Síntomas y acciones

| Síntoma | Causa probable | Acción |
|---|---|---|
| `wrong passphrase for this store` | frase distinta a la de esa bóveda | comparar la huella con el recibo `carry-*.json` (`keyFingerprint`) |
| `no keeper store at <dir>` | no hay `meta.json` | copiar la carpeta `vault` completa o `keeper import --from <soporte>` |
| `CHAIN_FAILED` | la cadena de manifiestos no se puede recorrer | probar otra copia de la bóveda; no seguir escribiendo |
| `HASH_MISMATCH` / `MISSING_OBJECT` | objeto alterado o ausente | restaurar desde otra copia; `verify` para identificar el objeto |
| `DSH is open on this machine` | escritura de CLI con DSH abierto | usar modo `uso` (no requiere cerrar) o cerrar DSH |
| La sesión no aparece en el panel | restituida en modo `archivo` | reiniciar DSH, o reimportar en modo `uso` |
| Aparece "Ungrouped" | el `cwd` no tiene workspace registrado | `keeper workspace add "<ruta>"` y reimportar, o aceptar el estado |
| Sesión duplicada | se importó con `--on-conflict new-id` | `keeper undo` si fue el último cambio |
| `QUARANTINED` en 1.0.2 | escaneo de secretos bloqueante | en 2.0 es aviso; en `strict`, reintentar con `--force` |
| `ATTACHMENT_CONFLICT` | mismo hash, contenido distinto | investigar antes de tocar; **no** sobrescribir (C3) |
| Importación lenta | sesión grande | publicar por lotes; es esperado, no colgar |

## Códigos de error

Los de C4 están definidos en `07` §Invariantes y en `08`. Un error que no esté en esa lista es un bug:
se reporta con `--detail`, versión de DSH y de plugin.

## Preguntas que hay que hacer siempre en un reporte

1. Versión de DSH y de plugin (`keeper capabilities`).
2. Salida de `keeper doctor`.
3. ¿La bóveda verifica en otra máquina?
4. ¿Se importó en `archivo` o en `uso`?
5. ¿El `cwd` de origen existe en esta máquina?

Con esas cinco se resuelve el 90% sin adivinar.

## Privacidad en soporte

- Nunca pedir la frase.
- Nunca pedir el contenido de una sesión.
- Un `keeper doctor` y un recibo alcanzan: no contienen texto de conversaciones.

## Desinstalar

1. Quitar el paquete del perfil.
2. La bóveda queda: si se quiere borrar, se borra la carpeta explícitamente.
3. Las sesiones restituidas quedan en el `home`: borrarlas es una decisión del usuario, no del
   desinstalador.

Advertencia que se da siempre: **borrar la bóveda sin exportar pierde lo que no esté en `sessions/`**.

## Mantenimiento

| Cuándo | Qué |
|---|---|
| tras un viaje | `verify` de la copia recibida |
| cada tanto | `doctor` para ver ratio y restos |
| bóveda grande | `compact` y `gc --yes` con DSH cerrado |
| cambio de máquina | `export` y `import` |

## Preguntas abiertas

- ¿Hace falta un comando `diagnose` que junte las cinco preguntas en un archivo? Dueño: soporte.
  Propuesta: sí, y que no contenga contenido.

## Qué sigue

`18-COMPATIBILIDAD.md` para las reglas de versión detrás de estos procedimientos.
