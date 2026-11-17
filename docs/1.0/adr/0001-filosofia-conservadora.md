# ADR 0001 — Filosofía conservadora para v1.0

- **Fecha**: 2026-11-03
- **Estado**: aceptada
- **Contexto**: cierre de la primera versión; el transporte se reconstruyó después del retroceso
  del 2026-11-03 (`docs/PLAN.md` §13).

## Decisión

La primera versión usa la **filosofía conservadora**:

1. **Un linaje visible por sesión**, el del dispositivo que la introdujo (regla del dueño).
2. El resto de los linajes **no se descarta**: se guardan como continuaciones archivadas, verificadas
   y reportadas (`keeper inventory`, `keeper status`).
3. El transporte es **manual y explícito**: `keeper export` en una máquina, `keeper import` (con
   `--swap`) en la otra.
4. Las escrituras sobre la bóveda viva y sobre `sessions/` ocurren **con DSH cerrado**. Con DSH
   abierto, el CLI sólo lee.
5. Una sesión restaurada es **de lectura**. Para continuar un tema en otra máquina se abre una
   conversación nueva.

## Motivos

- **Nada se pierde.** La rama no elegida queda íntegra y recuperable; el costo es de visibilidad, no
  de datos.
- **Una sola línea por sesión** evita la confusión en la lista del host y cumple la directiva del
  proyecto: resguardar el historial de una sesión y continuar trabajando en otra.
- **El formato manda.** La regla se resuelve eligiendo entre linajes; no reescribe bytes ni logs.
  Las alternativas que exigían recomponer un log fueron rechazadas por el host tres veces
  (`LESSONS.md`).
- **Falla cerrado y se puede volver atrás**: cada viaje deja la copia anterior y la bóveda anterior
  apartadas.

## Consecuencias

- El trabajo hecho en la máquina que **no** es dueña no aparece en la conversación visible. Está
  archivado y se puede consultar, pero no se mezcla. Es el precio aceptado por una línea limpia.
- La "sincronización en vivo" (dos máquinas escribiendo la misma bóveda a la vez) queda **fuera del
  alcance**: no es segura con el host abierto. La sincronización es offline por máquina.
- El caso "la misma sesión creció en otra máquina" no se aplica solo: requiere una decisión del
  operador (y hoy, una acción manual). Es la deuda abierta que una filosofía convergente vendría a
  resolver.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Gana el más reciente (convergente) | prometedora, pero exige el *catch-up* y automatismo que todavía no existe; queda como filosofía aparte |
| Todos los linajes visibles (archivista) | exige reasignar el id del log; deja de ser byte-fiel |
| Fusionar los logs en uno | el log del host es un historial de ediciones; falló tres veces |
| Exportar a texto plano para no depender del host | reduce la seguridad; diferido con condiciones (`PLAN.md` §12.3) |

## Revisión

Esta decisión se revisa si aparece una filosofía convergente que pase `npm run conformance` y
resuelva el catch-up sin tocar el contrato. En ese caso, esta ADR se marca como *superseded* por la
nueva, no se borra.
