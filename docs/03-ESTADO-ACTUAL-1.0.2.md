---
id: "03"
titulo: "Estado actual 1.0.2 (as-built)"
estado: aprobado
version: "1.0"
depende_de: ["01"]
alimenta_a: ["04", "06", "11", "14"]
ultima_revision: "2026-11-11"
---

# 03 — Estado actual 1.0.2 (as-built)

Lo que existe hoy, sin adornos. Es la línea de base sobre la que se construye 2.0.

## Qué es 1.0.2

Plugin de DSH + CLI en un mismo paquete (`dsh-history-keeper@1.0.2`), licencia PolyForm
Noncommercial, copyright `leoainc-ops`. Corre dentro del perfil de DSH y también como `bin/keeper.js`.

## Superficie actual

| Comando | Función |
|---|---|
| `init` | crea bóveda y frase |
| `snapshot` | captura sesiones nuevas |
| `verify` | verifica integridad completa |
| `status` / `doctor` / `catalog` | estado, consumo, inventario |
| `conform` | prueba de contrato de cualquier bóveda |
| `export` / `import` / `--stage` | viaje por soporte |
| `restore` | escribe sesiones y adjuntos en un `home` |
| `extract` | saca una conversación a texto/JSONL/raw |
| `compact` / `gc` / `upgrade` | mantenimiento |
| `inventory` / `attachments` / `paths` / `capabilities` | diagnóstico |

## Arquitectura actual

`lib/` sin separación de capas: los módulos de bóveda (`store`, `crypto`, `chunk`, `frames`,
`verify`) conviven con los que dependen del host (`plugin`, `config`, `hostguard`, `restore`,
`import`, `compat`). No hay un núcleo reutilizable ni un adaptador explícito.

## Qué funciona bien (y se conserva)

- **Integridad**: cadena de chunks con `prefixSha256`/`endSha256`, `plainSha256` por chunk, hash del
  objeto cifrado en el manifiesto. `verify` falla cerrado con códigos.
- **Cifrado**: AES-256-GCM, scrypt N=32768, `keyCheck` que rechaza frase equivocada antes de tocar
  nada.
- **Append-only**: nunca reescribe eventos confirmados; una cola rota no se publica.
- **Formato estable**: `store/1` con `minReader`, campos aditivos.
- **Viaje**: `export` verifica la copia y emite recibo con huella de clave; `import` verifica antes
  de escribir y hace rollback si falla.

## Qué falla (evidencia de la Prueba A)

Ver el detalle en `anexos/A-PRUEBA-A-EVIDENCIA.md`. Resumen:

| Síntoma | Causa real |
|---|---|
| 9 de 11 sesiones no se restauraron | el preflight de vocabulario aprende del host; con una sola sesión propia el vocabulario es incompleto y bloquea sesiones legibles |
| Las 2 restauradas no aparecieron en el panel | `restore` escribe archivos; no registra la sesión en el workspace |
| Hacía falta cerrar DSH y reiniciar | la CLI escribe el árbol de sesiones por fuera del escritor del host |
| Un `init` previo con otra frase corrompió la bóveda local | convivencia de `meta.json` de una bóveda con la cabeza de otra; el plugin y la CLI no se coordinan |
| La frase quedó duplicada en el pendrive | el procedimiento manual no tiene un paso que la borre |

## Las tres causas de fondo

1. **El producto entrega archivos, no sesiones.** Todo lo demás se deriva de eso: cerrar DSH,
   reiniciar, *Ungrouped*, y la imposibilidad de que DSH sepa que la conversación existe.
2. **La ceremonia está adelante de la garantía.** Se pide `conform`, entorno prístino y pasos
   manuales para proteger algo que la verificación automática ya protege.
3. **Los gates no distinguen "no puedo" de "no me gusta".** Bloquear una sesión legible por
   vocabulario incompleto es un falso negativo que cuesta datos.

## Qué implica para 2.0

| Deuda | Se resuelve en |
|---|---|
| separación núcleo/adaptador | Fase 0 (`06`) |
| preflight que bloquea de más | Fase 1 (`10`, `12`) |
| escaneo de secretos como cuarentena | Fase 1 (`12`) |
| entrega por archivos | Fase 2, modo `uso` (`11`) |
| falta de recibo | Fase 3 (`13`) |
| journal y undo | Fase 1 (`11`, `14`) |
| capa C | Fase 4, condicionada (`12`) |

## Lo que NO se toca

El formato `store/1`, la cadena de hashes, el `keyCheck` y la regla de no sobrescribir. Son la razón
por la que 2.0 puede ser un cambio de superficie y no una migración.

## Preguntas abiertas

- ¿Cuántos usuarios de 1.0.2 dependen del default estricto? Dueño: producto. Determina si hace falta
  un aviso de migración.

## Qué sigue

`04-CONTRATO.md`: lo que se conserva por encima de todo lo anterior.
