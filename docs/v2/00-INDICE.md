---
id: "00"
titulo: "Índice y guía de uso"
estado: aprobado
version: "1.0"
depende_de: []
alimenta_a: ["01", "21"]
ultima_revision: "2026-11-11"
---

# 00 — Índice y guía de uso

Este portafolio es el **sistema de documentación** del proyecto `dsh-history-keeper` v2.0.0. Está
escrito para que cualquier desarrollador, sin hablar con nadie, pueda
entender qué se construye, por qué, en qué orden, y cómo saber si está bien hecho.

## Reglas del portafolio

1. **Un documento = una pregunta.** Si un documento responde dos, se parte.
2. **Progresivo.** Los documentos están numerados y un documento nunca *requiere* otro de número
   mayor. Los enlaces hacia adelante se declaran en `alimenta_a`, nunca en `depende_de`.
3. **Intervinculado.** Todo enlace es relativo y apunta a un archivo existente del mismo árbol.
4. **Ejecutable.** Cada documento termina en algo accionable: criterio de aceptación, tarea o
   decisión pendiente con dueño.
5. **El contrato manda.** Si un documento contradice `04-CONTRATO.md`, el documento está mal.

## Encabezado y cierre obligatorios

Todo archivo abre con el bloque YAML que ya viste arriba y cierra con dos secciones:

```text
## Preguntas abiertas   (con dueño; vacío si no hay)
## Qué sigue            (a qué documento va el lector)
```

Estados posibles: `borrador` · `revisado` · `aprobado` · `obsoleto`.

## Caminos de lectura por rol

| Rol | Camino |
|---|---|
| **Desarrollador nuevo** | 00 → 01 → 04 → 05 → 06 → 07 → 09 → (10 u 11) → 15 → 16 |
| **Producto / negocio** | 00 → 01 → 02 → 04 → 14 → 20 |
| **Operaciones / soporte** | 00 → 05 → 13 → 17 |
| **Seguridad / auditoría** | 00 → 04 → 07 → 08 → 12 → 16 → 18 |
| **Quien retoma el proyecto en 6 meses** | 00 → 03 → 04 → 06 → 14 → 19 |

## Mapa de documentos

| # | Documento | Pregunta que responde | Estado |
|---|---|---|---|
| 00 | [Índice y guía](00-INDICE.md) | ¿por dónde empiezo? | aprobado |
| 01 | [Visión y alcance](01-VISION-Y-ALCANCE.md) | ¿qué es y qué no es? | aprobado |
| 02 | [Público y posicionamiento](02-PUBLICO-Y-POSICIONAMIENTO.md) | ¿a quién le hablamos? | aprobado |
| 03 | [Estado actual 1.0.2](03-ESTADO-ACTUAL-1.0.2.md) | ¿qué hay hoy y dónde falla? | aprobado |
| 04 | [Contrato del producto](04-CONTRATO.md) | ¿qué no se negocia? | aprobado |
| 05 | [Glosario y convenciones](05-GLOSARIO-Y-CONVENCIONES.md) | ¿qué significa cada palabra? | aprobado |
| 06 | [Arquitectura](06-ARQUITECTURA.md) | ¿qué piezas hay y cómo se hablan? | aprobado |
| 07 | [Modelo de datos de la bóveda](07-MODELO-DE-DATOS-BOVEDA.md) | ¿cómo está guardado cada byte? | aprobado |
| 08 | [Trazado y restitución](08-TRAZADO-Y-RESTITUCION.md) | ¿de dónde salió y a dónde vuelve? | aprobado |
| 09 | [Integración con DSH](09-INTEGRACION-DSH.md) | ¿qué servicios del host usamos? | revisado |
| 10 | [Modo `archivo`](10-MODO-ARCHIVO.md) | ¿cómo se comporta el camino sellado? | aprobado |
| 11 | [Modo `uso`](11-MODO-USO.md) | ¿cómo se publica una sesión nativa? | revisado |
| 12 | [Confianza y privacidad](12-CONFIANZA-Y-PRIVACIDAD.md) | ¿qué se relaja y qué no? | aprobado |
| 13 | [Experiencia y superficies](13-EXPERIENCIA-Y-SUPERFICIES.md) | ¿cómo se usa? | borrador |
| 14 | [Plan de entrega](14-PLAN-DE-ENTREGA.md) | ¿en qué orden se construye? | aprobado |
| 15 | [Backlog ejecutable](15-BACKLOG.md) | ¿qué tarea hace quién? | borrador |
| 16 | [Pruebas](16-PRUEBAS.md) | ¿cómo se prueba el contrato? | borrador |
| 17 | [Operaciones y soporte](17-OPERACIONES.md) | ¿qué hace el que atiende? | borrador |
| 18 | [Compatibilidad y migración](18-COMPATIBILIDAD.md) | ¿qué versiones se soportan? | aprobado |
| 19 | [Registro de decisiones (ADR)](19-ADR.md) | ¿por qué se eligió esto? | aprobado |
| 20 | [Riesgos y supuestos](20-RIESGOS-Y-SUPUESTOS.md) | ¿qué puede salir mal? | borrador |
| 21 | [Gobierno del proyecto](21-GOBIERNO.md) | ¿cómo cambia esto y quién aprueba? | aprobado |
| A | [Anexo A — Prueba A (evidencia)](anexos/A-PRUEBA-A-EVIDENCIA.md) | ¿qué pasó en la prueba que falló? | histórico |
| B | [Anexo B — Trazado detallado](anexos/B-TRAZADO-DETALLADO.md) | ¿cómo se diseccionó una bóveda real? | histórico |
| C | [Anexo C — Digesto de la sesión de pc-b](anexos/C-DIGESTO-montar-la-boveda.md) | ¿qué se decidió y qué se verificó en la sesión que originó 2.0? | histórico |
| D | [Anexo D — Relevamiento de problemas y mejoras](anexos/D-RELEVAMIENTO-problemas-y-mejoras.md) | ¿qué falló entre el 10 y el 16-11 y qué mejorar? | revisado |
| E | [Anexo E — Función de purga](anexos/E-FUNCION-purga.md) | ¿cómo se borra una conversación de la bóveda y del host? | propuesta |

## Requisitos funcionales

Identificadores estables. Se usan en el backlog (`15`), en las pruebas (`16`) y en el contrato (`04`).

| ID | Requisito | Fase |
|---|---|---|
| RF-01 | Abrir o crear una bóveda y validar la frase antes de escribir | F0 |
| RF-02 | Capturar sesiones por evento de flush del host | F1 |
| RF-03 | Verificar integridad de la bóveda completa | F0 |
| RF-04 | Exportar la bóveda a un soporte, con recibo | F1 |
| RF-05 | Importar en modo `archivo` (sellado) | F1 |
| RF-06 | Restituir sesiones byte a byte, sin sobrescribir | F1 |
| RF-07 | Restituir adjuntos por hash, sin sobrescribir | F1 |
| RF-08 | Publicar sesiones nativas en modo `uso` | F2 |
| RF-09 | Agrupar la sesión en su workspace | F2 |
| RF-10 | Calcular y comparar el sello de contenido | F2 |
| RF-11 | Registrar procedencia de lo entregado | F2 |
| RF-12 | Emitir un recibo de una página por operación | F3 |
| RF-13 | Aplicar la política de confianza (`strict`/`default`/`relajado`) | F1 |
| RF-14 | Journal de lo creado y `undo` | F1 |
| RF-15 | Detectar capacidades del host y replegar a `archivo` | F0 |
| RF-16 | Diagnóstico legible (`status`, `doctor`, "¿estoy cubierto?") | F1 |

## Matriz de trazabilidad

Cada cláusula del contrato debe aparecer en los cuatro lugares. Si falta uno, no existe.

| Contrato | Se define en | Se implementa en | Se prueba en | Se entrega en |
|---|---|---|---|---|
| C1 Integridad | 04 | 06, 07, 08 | TC-1 | F0 |
| C2 Frase antes de escribir | 04 | 07, 10 | TC-2 | F0 |
| C3 Nada se reemplaza | 04 | 10, 11 | TC-3 | F1 |
| C4 Falla cerrado | 04 | 06, 07 | TC-4 | F0 |
| C5 Formato estable | 04, 18 | 07, 18 | TC-5 | F0 |
| C6 Procedencia | 04 | 11 | TC-6 | F2 |

| Requisito | Documento | Prueba | Tarea de backlog |
|---|---|---|---|
| RF-01 | 07, 10 | T-01 | K-02 |
| RF-02 | 06, 10 | T-02 | K-12 |
| RF-03 | 07, 08 | T-03 | K-05 |
| RF-04 | 10, 13 | T-04 | K-13 |
| RF-05 | 10 | T-05 | K-14 |
| RF-06 | 08, 10 | T-06 | K-15 |
| RF-07 | 08, 10 | T-07 | K-16 |
| RF-08 | 09, 11 | T-08 | K-20 |
| RF-09 | 09, 11 | T-09 | K-21 |
| RF-10 | 11 | T-10 | K-22 |
| RF-11 | 11 | T-11 | K-23 |
| RF-12 | 13 | T-12 | K-27 |
| RF-13 | 12 | T-13 | K-11 |
| RF-14 | 11 | T-14 | K-24 |
| RF-15 | 09 | T-15 | K-04 |
| RF-16 | 17 | T-16 | K-17 |

## Cómo se mantiene

- Los documentos `aprobado` sólo cambian con una revisión registrada en `21-GOBIERNO.md`.
- El contrato (`04`) es la única pieza que exige un **cambio de versión mayor** del producto para
  modificarse.
- Los anexos son **históricos**: no se corrigen, se agregan. Si un anexo contradice un documento
  vivo, gana el vivo.

## Qué sigue

Leer `01-VISION-Y-ALCANCE.md`. Quien vaya directo al código, seguir el camino de "Desarrollador
nuevo" de la tabla de roles.
