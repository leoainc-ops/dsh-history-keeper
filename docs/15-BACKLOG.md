---
id: "15"
titulo: "Backlog ejecutable"
estado: borrador
version: "0.8"
depende_de: ["14", "06", "10", "11"]
alimenta_a: ["16", "20"]
ultima_revision: "2026-11-11"
---

# 15 — Backlog ejecutable

Los IDs (`K-xx`) son **estables**: no son orden de ejecución. El orden real está en la columna
`orden` de cada fase.

Cada tarea tiene un **criterio de terminado** verificable. "Funciona" no es un criterio.

## F0 — Núcleo separado

| ID | Tarea | Orden | Terminado cuando | RF | Prueba |
|---|---|---|---|---|---|
| K-01 | Mover `store`, `crypto`, `chunk`, `frames`, `verify` a `core/` sin cambios | 1 | los tests de 1.0.2 pasan sin modificarlos | — | regresión |
| K-02 | `core/vault.open`/`init` con validación de frase antes de escribir | 2 | frase mala no deja rastro en el `home` | RF-01 | T-01, TC-2 |
| K-03 | Interfaces `core/host` y esqueleto de `plan`/`apply` | 3 | un `plan` vacío se puede construir y descartar | — | unitario |
| K-04 | `capabilities()` + repliegue | 4 | sin `sessionPersistence`, `modos == ["archivo"]` | RF-15 | T-15 |
| K-05 | `core/verify.collect` con todos los códigos de C4 | 5 | cada código de C4 tiene un fixture | RF-03 | T-03, TC-1, TC-4 |
| K-06 | Suite de regresión con bóveda de laboratorio + una real | 6 | corre en CI en menos de 60 s | — | TC-5 |

## F1 — Quitar ceremonia

| ID | Tarea | Orden | Terminado cuando | RF | Prueba |
|---|---|---|---|---|---|
| K-07 | `core/journal` (registro de efectos) | 1 | escribir dos veces el mismo evento no duplica | — | unitario |
| K-08 | `keeper undo` sobre journal | 2 | borra sólo lo creado y no toca la bóveda | — | T-14 |
| K-09 | `core/receipt` (base) | 3 | recibo con storeId, modo, resultado y sello | — | T-12 (parcial) |
| K-10 | `host/policy` con `strict`/`default`/`relajado` | 4 | D1–D5 cambian de comportamiento por perfil | — | unitario |
| K-11 | Gate de vocabulario tolerante | 5 | sesión legible se importa con aviso, no se bloquea | RF-13 | T-13 |
| K-12 | Captura por flush (`snapshot`) | 6 | publica sólo frames completos; cola rota se descarta | RF-02 | T-02 |
| K-13 | `export` con recibo y huella | 7 | el recibo no contiene la frase | RF-04 | T-04 |
| K-14 | `import` modo `archivo` | 8 | bóveda verificada antes de escribir | RF-05 | T-05 |
| K-15 | Restitución byte a byte sin sobrescribir | 9 | destino distinto se rechaza, no se pisa | RF-06 | T-06, TC-3 |
| K-16 | Adjuntos por hash | 10 | conflicto de contenido reportado, no sobrescrito | RF-07 | T-07 |
| K-17 | `status` / `doctor` / "¿estoy cubierto?" | 11 | responde sin abrir la bóveda completa | RF-16 | T-16 |
| K-18 | Verificación automática (D1) | 12 | no hay paso manual de `conform` en el camino común | — | T-05 |
| K-19 | Mensajes de error y avisos (qué pasó / qué no se tocó / qué hacer) | 13 | todo error de C4 tiene mensaje propio | — | revisión manual |
| K-24 | `undo` de importación (consolidado con journal) | 14 | deshace una importación en modo `archivo` y `uso` | RF-14 | T-14 |

## F2 — Modo `uso`

| ID | Tarea | Orden | Terminado cuando | RF | Prueba |
|---|---|---|---|---|---|
| K-30 | Spike `P1`–`P4` de `09` | 1 | cada pregunta tiene respuesta con evidencia | — | informe |
| K-20 | `publish-native`: `create` + `append` + `flush` | 2 | sesión creada con el `id` original y visible al proceso | RF-08 | T-08 |
| K-21 | `workspace` resolve/create/attach | 3 | sesión agrupada sin reiniciar | RF-09 | T-09 |
| K-22 | Sello de contenido | 4 | sello origen == sello publicado en 11 de 11 | RF-10 | T-10 |
| K-23 | Procedencia (C6) en journal y recibo | 5 | un tercero puede re-derivar el sello desde el recibo | RF-11 | T-11, TC-6 |

## F3 — Recibo y cobertura

| ID | Tarea | Orden | Terminado cuando | RF | Prueba |
|---|---|---|---|---|---|
| K-27 | Recibo de una página (texto/Markdown) | 1 | se entiende sin terminal y no filtra contenido | RF-12 | T-12 |
| K-25 | Tool del agente `keeper_plan` / `keeper_apply` | 2 | el agente no puede aplicar sin plan | — | T-16 |
| K-26 | `doctor --privacidad` | 3 | enumera qué está en claro y qué sólo en la bóveda | — | T-16 |
| K-28 | Documentación de usuario final | 4 | un usuario nuevo recupera sin ayuda | — | sesión observada |

## F4 — Capa C (no planificada)

| ID | Tarea | Orden | Terminado cuando |
|---|---|---|---|
| K-29 | Definir alcance de capa C con un cliente real | — | hay requisito escrito y alguien que lo paga |

## Reglas del backlog

1. Una tarea sin criterio de terminado no entra.
2. Una tarea de F2 no empieza sin K-30 cerrado.
3. Toda tarea que toque el núcleo actualiza `07` o `08` en el mismo cambio.
4. Toda tarea que toque el contrato exige versión mayor (`18`) y revisión en `21`.

## Preguntas abiertas

- Estimación en horas: no se incluye acá. Dueño: quien ejecute, al cerrar K-06 (primer dato real).
- ¿K-30 puede adelantarse a F1? Dueño: arquitectura. Propuesta: sí, es barato y despeja riesgo.

## Qué sigue

`16-PRUEBAS.md`: cómo se demuestra que cada tarea hizo lo que dice.
