---
id: "20"
titulo: "Riesgos y supuestos"
estado: borrador
version: "0.8"
depende_de: ["14", "15", "16", "18", "19"]
alimenta_a: []
ultima_revision: "2026-11-11"
---

# 20 — Riesgos y supuestos

Registro vivo. Cada riesgo tiene mitigación y un disparador que obliga a revisarlo. Un riesgo sin
disparador no se monitorea.

## Riesgos técnicos

| ID | Riesgo | Prob. | Impacto | Mitigación | Disparador |
|---|---|---|---|---|---|
| R-01 | La API de DSH cambia entre versiones y rompe el modo `uso` | alta | alto | `capabilities()` + repliegue a `archivo`; el modo no es default | una versión de DSH que cambie `sessionPersistence` |
| R-02 | `attachments` no expone publicación genérica | media | medio | escribir el blob verificado por hash vía `ctx.fs` | spike P1 |
| R-03 | El header creado no conserva `agentPreset`/`isSeeded` | media | medio | documentar la diferencia en el recibo; o no usar `create` para sembradas | spike P2/P3 |
| R-04 | El panel no refresca tras `attachSession` | media | medio | detectar y pedir reinicio; no mentir en la documentación | spike P4 |
| R-05 | Sesiones grandes (10 MiB, 8 000 frames) agotan memoria al publicar | baja | alto | publicar por lotes; techo por sesión | primera importación > 5 MiB |
| R-06 | `verify` lento en bóvedas grandes | baja | medio | caché de cadena ya existente; medir antes de optimizar | verify > 5 s |
| R-07 | El refactor de F0 cambia comportamiento sin avisar | media | alto | comparación de salidas contra 1.0.2; tests de regresión | primer PR de F0 |
| R-08 | La tolerancia importa sesiones que el host muestra mal | media | medio | aviso por sesión; `--detail` con el motivo; `strict` disponible | primer reporte de sesión ilegible |

## Riesgos de producto

| ID | Riesgo | Prob. | Impacto | Mitigación | Disparador |
|---|---|---|---|---|---|
| R-09 | La base de DSH es chica y el producto no llega a nadie | alta | alto | no segmentar de más; posicionarse como parte del ecosistema DSH | 10 entrevistas sin comprador |
| R-10 | El modo `uso` deja texto en claro en máquinas compartidas y se percibe como incidente | media | alto | aviso explícito, `doctor --privacidad`, default `archivo` | primer reporte de privacidad |
| R-11 | El producto se percibe como "el cómodo pero inseguro" | media | alto | el recibo y el sello como argumento; no vender `uso` como seguro | material de venta sin C6 |
| R-12 | El precio no se valida y el producto queda gratis para siempre | media | medio | 10 entrevistas antes de F2 | cierre de F1 |
| R-13 | Se promete capa C sin tenerla | baja | alto | está fuera de 2.0 por ADR-008 | pedido de auditoría |

## Riesgos legales y de licencia

| ID | Riesgo | Prob. | Impacto | Mitigación | Disparador |
|---|---|---|---|---|---|
| R-14 | Contribución externa sin cesión de derechos | media | medio | aviso en el repo; CLA o licencia compatible | primer PR externo |
| R-15 | Uso comercial de la edición NC sin licencia | media | alto | declarar la licencia en el paquete y en el recibo | primera venta |
| R-16 | El nombre del paquete confunde (NC vs comercial) | baja | medio | decidir nombre antes de publicar (`05` pregunta abierta) | publicación de 2.0.0 |

## Riesgos operativos

| ID | Riesgo | Prob. | Impacto | Mitigación | Disparador |
|---|---|---|---|---|---|
| R-17 | Soporte por usuario se vuelve inviable | media | alto | documentación de usuario, `diagnose`, correo acotado | > 5 tickets por semana |
| R-18 | Un `undo` borra algo que no debía | baja | alto | journal sólo de efectos propios; ventana de 7 días; prueba T-14 | primer reporte |
| R-19 | El usuario pierde la frase y culpa al producto | media | alto | aviso en `init`, huella en el recibo, FAQ | primer caso |

## Supuestos

Si alguno es falso, se revisa el plan, no se improvisa.

| ID | Supuesto | Si es falso… |
|---|---|---|
| S-01 | DSH seguirá existiendo y con API de persistencia estable | el modo `uso` pierde sentido; el valor queda en `archivo` |
| S-02 | El usuario objetivo tolera una terminal | cambia el público (`02`) y hace falta GUI |
| S-03 | La bóveda es el archivo de referencia y no se migra | C5 se rompe y hay que planificar migración |
| S-04 | El titular de la licencia es quien desarrolla | cambia ADR-003 y el modelo de negocio |
| S-05 | La base instalada de DSH creció antes de 2.0.0 | se acelera el lanzamiento y se prioriza F1 |
| S-06 | Las sesiones no superan ~20 MiB | el diseño de publicación por lotes no alcanza |

## Preguntas abiertas (agregadas)

| Pregunta | Documento | Dueño |
|---|---|---|
| ¿`core/plan` conoce el modo? | 06 | arquitectura |
| Journal en `home` o junto a la bóveda | 06 | arquitectura |
| ¿Se documenta `chacha20` legado? | 07 | arquitectura |
| ¿Sello con `data` completo? | 08 | arquitectura |
| P1–P4 del host | 09 | arquitectura |
| Default de 2.0: `archivo` o `uso` | 11 | producto |
| ¿Silenciar aviso de texto en claro? | 12 | producto |
| ¿Confirmación interactiva del plan? | 13 | producto |
| ¿Beta al cerrar F1? | 14 | producto |
| Estimaciones en horas | 15 | quien ejecute |
| ¿Bóveda dorada en repo? | 16 | arquitectura |
| ¿Comando `diagnose`? | 17 | soporte |
| Duración de `release/1.x` | 18 | producto |
| Modelo de licencia de 2.0 (NC / dual / permisiva) | 19 ADR-003 | producto |

## Qué sigue

`21-GOBIERNO.md`: quién decide, cómo se aprueba y cuándo se revisa este registro.
