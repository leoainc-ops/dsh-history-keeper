# Qué casos cubre el plugin

Mapa de situaciones, por rol y por momento del uso. Sirve para dos cosas: saber qué se le puede
prometer a un usuario nuevo, y ver dónde están los huecos antes de agregar funciones.

Estados:

- ✅ **cubierto**: funciona hoy, probado.
- ⚠️ **con condición**: funciona si se cumple algo externo (que la bóveda llegue, que la frase
  sobreviva, que el host esté cerrado o actualizado, que la sesión no se haya continuado en dos
  máquinas).
- ❌ **no cubierto**: no existe todavía.

## A. Primer contacto (7 casos)

| # | Situación | Rol | Estado |
|---|---|---|---|
| A1 | Un dispositivo con historial, sin bóveda → `init` + captura | respaldo | ✅ |
| A2 | Un dispositivo que reinstala: la bóveda ya existe | respaldo | ✅ |
| A3 | Segundo dispositivo **vacío** + la bóveda del primero | transporte | ✅ |
| A4 | Segundo dispositivo vacío, **sin** bóveda todavía | transporte | ⚠️ depende de que llegue la bóveda |
| A5 | Dos dispositivos con historiales **propios y distintos** | convergencia | ✅ (unión de sesiones; la divergencia de una misma sesión se resuelve por la regla del dueño) |
| A6 | Dos dispositivos con la **misma** bóveda (clon) | convergencia | ✅ |
| A7 | Bóveda de otro usuario o frase equivocada | — | ✅ falla cerrado, con mensaje |

## B. Operación (19 casos)

| # | Situación | Rol | Estado |
|---|---|---|---|
| B1 | Captura automática al cerrar turno | respaldo | ✅ |
| B2 | Verificar todo y detectar un byte alterado | respaldo | ✅ |
| B3 | Enviar al pendrive | transporte | ✅ |
| B4 | Recibir del pendrive (DSH cerrado) | transporte | ✅ |
| B5 | Ida y vuelta sin pérdidas | transporte | ✅ |
| B6 | Llevar **una** conversación o un proyecto (selección) | transporte | ❌ (bultos, 1.1) |
| B7 | Nube compartida (OneDrive/Drive) | convergencia | ❌ (E6) |
| B8 | Automático: *pull* al abrir, *push* al cerrar | convergencia | ❌ (lanzador) |
| B9 | La **misma** sesión continuada en dos PCs | convergencia | ⚠️ se elige una y se archiva la otra |
| B10 | Restaurar con DSH abierto | transporte | ✅ se niega |
| B11 | Hosts de distinta versión | compatibilidad | ⚠️ se detecta; lo resuelve actualizar el host más viejo |
| B12 | Bóveda dañada (hueco en la cadena) | recuperación | ⚠️ se detecta y se niega a tocar; falta `keeper repair` |
| B13 | Borrar una conversación / retención | — | ❌ (§9.9) |
| B14 | Pasar una conversación a **otro usuario** | — | ❌ (no hay re-sellado para otra clave) |
| B15 | Dos usuarios en la misma PC | — | ✅ en teoría (cada home es suyo); no probado en campo |
| B16 | Migrar de máquina definitivamente | transporte | ✅ |
| B17 | Perder la PC (SO roto, robo) | respaldo | ✅ si sobreviven la bóveda **y** la frase |
| B18 | Perder la frase | — | ❌ por diseño: no hay recuperación |
| B19 | Varias bóvedas por usuario (una por proyecto) | — | ⚠️ posible con `--store`, sin catálogo que las reúna |

## B.3 Viaje y convergencia (actualizado 2026-11-09)

Los casos de transporte cambiaron con la importación en el lugar, el buzón y el deshacer:

| Situación | Cubierto | Cómo |
|---|---|---|
| Llevar la bóveda a otra PC | sí | `keeper export` verifica la copia y deja un recibo con la huella de la clave |
| Traer la bóveda de otra PC | sí | `keeper import` la verifica antes de tocar nada, fusiona en el lugar y verifica el resultado |
| No querer importar en ese momento | sí | `keeper import --stage` deja la bóveda en el buzón; el próximo arranque la importa |
| Haber mostrado sesiones que no querías | sí | `keeper import --undo` retira esos archivos (7 días, o hasta el primer export) |
| Un intento de import falla | sí | la bóveda se restaura y la copia se aparta como `.failed-<sello>` |
| El pendrive trae algo dañado | sí | el import se niega con el código (`HASH_MISMATCH`) y no escribe nada |
| Dos máquinas continúan la misma sesión | sí | gana el linaje del dueño; el otro se archiva y se informa |
| Sincronización en vivo entre máquinas | **no** | fuera de alcance de la 1.0, por decisión |

## Resumen por rol

| Rol | Casos | Cobertura |
|---|---|---|
| **Respaldo** | 7 | 7 ✅ |
| **Transporte** | 7 | 5 ✅ · 1 ⚠️ · 1 ❌ (selección) |
| **Convergencia** | 8 | 3 ✅ · 1 ⚠️ (misma sesión) · 4 ❌ (nube, automático, retención, otro usuario) |
| **Recuperación** | 4 | 3 ✅/⚠️ · 1 ❌ (frase perdida, por diseño) |

**Total: 26 casos — 18 ✅ · 5 ⚠️ · 3 ❌.**

## Dónde están los huecos

Los tres ❌ importantes no están en el respaldo ni en el transporte: están en **convergencia**.

1. **Llevar selectivamente** una conversación o un proyecto (bultos). Es un filtro de `export`; no
   toca el contrato.
2. **Nube y automático** (E6 + lanzador). Misma mecánica de archivos, otra carpeta y un disparador
   al abrir/cerrar.
3. **Recuperar una bóveda dañada** (`keeper repair`). La receta está probada en campo y anotada en
   `LESSONS.md`; falta el comando.

Las cinco ⚠️ tienen la misma forma: **una condición externa**. Que la bóveda llegue, que la frase
sobreviva, que el host esté cerrado, que el host se actualice, o que la sesión no se haya continuado
en dos máquinas.

## Lo que esto dice del producto

- **Respaldo y transporte cumplen la promesa** tal como está escrita en el README.
- **Convergencia** cubre lo que no requiere el host abierto. La importación al arrancar y el
  deshacer cerraron la automatización; lo que falta es **selección** (llevar una conversación o un
  proyecto y no todo), y es superficie, no integridad.
- Los tres huecos se pueden cerrar **sin tocar el contrato** (`SPEC-vault.md`): son superficie, no
  formato.

## Método

Los casos salen de la historia real del proyecto y no de una lista teórica: `LESSONS.md` (qué falló y
por qué), `TRANSPORT.md` (el ciclo vigente) y `PLAN.md` (las fases y la agenda). Cuando se cierre un
hueco, se actualiza esta tabla y se registra la decisión en `docs/adr/`.
