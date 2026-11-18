# Hoja de ruta — primer objetivo de 2.0: emparejar los historiales

Asentado el 2026-11-17. **Punto de partida**: F0 con K-01 y K-02 cerrados (`af0661e`).
**Destino**: `2.0.0-alpha.0`, una herramienta **funcional** que empareja conversaciones entre pc-a y
pc-b, sin publicar nada.

> **El problema que resuelve:** hoy una conversación no se puede llevar de un host a otro sin perder
> horas. La bóveda viaja; lo que falta es que el host receptor la adopte y la agrupe.

## Estado de ejecución

| # | Tarea | Estado | Evidencia |
|---|---|---|---|
| T1 | Spike del host: servicios, métodos y límites | **en curso** · sonda escrita; falta leer el reporte en el host real | `host/capabilities.js`, `/keeper host`, `history-keeper-host-probe.json` |
| T2 | `core/plan`: clasificar sesiones y decidir destino | pendiente | — |
| T3 | `host/capabilities`: elegir `uso` o `archivo` | pendiente | — |
| T4 | `host/publish-native`: crear, append, flush, cerrar | pendiente | — |
| T5 | `host/workspaces`: resolver/crear y `attachSession` | pendiente | — |
| T6 | Traducción de `cwd` (mapa origen → destino) | pendiente | — |
| T7 | `keeper mount`: planificar, aplicar, sellar, reportar | pendiente | — |
| T8 | Journal + `undo` mínimos | pendiente | — |
| T9 | Recibo de una página | pendiente | — |
| T10 | Prueba real a↔b + instalación en el perfil documentada | pendiente | — |

**Contador: faltan 10 tareas.** Se actualiza en cada bitácora.

## Definición de terminado del objetivo

1. Se instala desde el `.tgz` de la rama **en el perfil** de DSH.
2. Un comando toma la bóveda del pendrive y deja las conversaciones en el host.
3. Aparecen listadas; agrupadas si el host lo permite. Se acepta **un** reinicio.
4. El contenido se prueba: **sello de origen == sello publicado**.
5. Hay **recibo** con procedencia y **undo** de lo creado.
6. Funciona en las dos direcciones.

## Principios que ordenan esta etapa

1. **El host escribe, el keeper entrega.** Nada de archivos sueltos si el host puede adoptarlos.
2. **La identidad se conserva**: el `id`, el `createdAt` y el contenido son los del original; el
   `cwd` puede traducirse y la traducción se registra.
3. **Falla cerrado**: si el plan no cuadra o el sello no coincide, no se aplica.
4. **Un solo escritor**: mientras el plugin corre, nadie más escribe la bóveda.
5. **Se mide, no se opina**: cada tarea cierra con una prueba o con evidencia del host.

## Bitácora

| Fecha | Tarea | Qué pasó | Commit |
|---|---|---|---|
| 2026-11-17 | — | Se fija el objetivo y esta hoja de ruta | `2a964b8` |
| 2026-11-17 | T1 | Sonda del host: `probeHost` + `capabilities` + `/keeper host`; el plugin deja el reporte al montar. Falta instalarlo y leerlo en el host | este commit |

## Riesgos conocidos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | `attachSession` no refresca el panel sin reiniciar (P4 sin confirmar) | aceptar un reinicio; el plan lo avisa |
| R2 | El `cwd` de origen no existe en el destino | traducción explícita, registrada en el recibo |
| R3 | El host cambia la firma de un servicio | `capabilities()` falla antes de escribir |
| R4 | Instalar la rama en el perfil altera la captura actual | probar con una copia; volver a 1.0.2 es un `pnpm add` |
| R5 | El gate de secretos pone en cuarentena la sesión a portar | aviso previo en el plan; `--force` explícito |

## Decisiones tomadas

1. El corte se llama **`2.0.0-alpha.0`**; `rc` queda para cuando F2 esté cerrado.
2. Se acepta **un reinicio** por montaje si el host lo exige.
3. La traducción de `cwd` es **explícita** (mapa), no heurística.
4. Nada de esto se publica: el paquete se arma con `npm pack` desde la rama.

## Fuera de este objetivo

Política `strict`, mensajes finos, `doctor`, recibo completo, campaña de pruebas de F1. Se retoman
después, con el cronograma general de 2.0.

## Qué sigue

`docs/14-PLAN-DE-ENTREGA.md` para el marco general; esta hoja manda mientras el objetivo esté
abierto.
