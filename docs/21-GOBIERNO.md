---
id: "21"
titulo: "Gobierno del proyecto"
estado: aprobado
version: "1.0"
depende_de: ["00", "04", "18"]
alimenta_a: []
ultima_revision: "2026-11-11"
---

# 21 — Gobierno del proyecto

Cómo se mantiene este portafolio y cómo se toman las decisiones. Sin esto, el portafolio se
desactualiza en un mes y deja de ser confiable.

## Autoridad

| Decisión | Quién | Cómo se registra |
|---|---|---|
| Visión, público, precio | producto | documento afectado + `20` |
| Contrato (C1–C6) | producto + arquitectura | `04` + versión mayor + `21` |
| Arquitectura e interfaces | arquitectura | `06`/`19` |
| Formato de bóveda | arquitectura | `07` + `18` |
| Alcance de una fase | producto + arquitectura | `14` |
| Nuevas decisiones técnicas | quien implementa | nueva ADR en `19` |

## Ciclo de vida de un documento

```text
borrador ──► revisado ──► aprobado ──► obsoleto
```

- **borrador**: se puede reescribir entero.
- **revisado**: ya no cambia la estructura; faltan confirmaciones.
- **aprobado**: sólo cambia por revisión registrada acá.
- **obsoleto**: se conserva; se reemplaza por otro documento y se enlaza.

Todo cambio de un documento aprobado exige:

1. una fila en la tabla de revisiones de este documento;
2. actualizar `version` y `ultima_revision` en el encabezado;
3. revisar los enlaces que lo citan (`alimenta_a`).

## Reglas de cambio

| Cambio | Requisito |
|---|---|
| Corregir una errata | no requiere registro |
| Agregar un requisito `RF-xx` | actualizar `00` (matriz), `14`, `15`, `16` |
| Agregar una prueba | actualizar `16` |
| Cambiar el contrato | versión mayor del software (`18`) + ADR + revisión acá |
| Cambiar el formato de bóveda | `store/2` + plan de migración + ADR |
| Retirar un modo o comando | ADR + aviso en `18` + una versión menor de transición |

## Repositorio y ramas

- `main` — la línea **publicada** (1.0.x): sólo seguridad y correcciones.
- `v2.0.0` — el desarrollo de 2.0: el portafolio vive en `docs/` y la documentación de 1.0 queda
  congelada en `docs/1.0/`.
- `feat/*` — ramas cortas por tarea; se mergean y se borran.
- Sin fork (ADR-002).

Política vigente: **no se publica paquete, tag ni versión** hasta que producto lo autorice por
escrito. Los push a `v2.0.0` son parte del trabajo documental autorizado.

## Revisiones

| Cadencia | Qué se revisa |
|---|---|
| al cerrar cada fase | `14` (criterios), `15` (backlog), `20` (riesgos) |
| antes de cada release | `04`, `18`, `16` (matriz en verde) |
| cada 3 meses | `02` (público y precio), `20` (supuestos) |
| cuando falle algo del contrato | `04` + `16` + ADR |

## Definición de terminado (documento)

- Encabezado completo y coherente con `depende_de`/`alimenta_a`.
- Enlaces relativos que resuelven.
- Termina en "Preguntas abiertas" y "Qué sigue".
- Ninguna afirmación técnica sin fuente: código, prueba o evidencia.

## Definición de terminado (tarea)

1. Código y prueba (`TC`/`T`) en verde.
2. Documento afectado actualizado en el mismo cambio.
3. Si tocó el contrato: versión mayor y ADR.
4. Si tocó el formato: `18` y matriz de interoperabilidad.

## Cómo se agrega un documento

1. Elegir el número: entre el último de su tema y el siguiente (renumerar es caro).
2. Copiar la plantilla de encabezado.
3. Declarar `depende_de` (sólo números menores) y `alimenta_a`.
4. Enlazarlo desde `00`.
5. Si es histórico, va a `anexos/` con letra.

## Registro de revisiones

| Fecha | Documento | Cambio | Autor |
|---|---|---|---|
| 2026-11-11 | todos | creación del portafolio 1.0 | arquitectura |
| 2026-11-11 | 00, 01, 05, 20 | nombre del producto fijado en `dsh-history-keeper` v2.0.0; sin alias | producto |
| 2026-11-16 | 00, todos | apertura de 2.0: portafolio en `docs/`, 1.0 congelado en `docs/1.0/`, anexos C–E | producto |
| 2026-11-16 | 21 | ramas: `main` queda en la línea publicada y 2.0 vive en `v2.0.0`; política de publicación explícita | producto |
| 2026-11-17 | 13 | `init` pide la frase y nunca la genera (R1) | producto |
| 2026-11-17 | —, 00 | hoja de ruta del primer objetivo: emparejamiento funcional entre hosts | producto |
| 2026-11-21 | —, 00 | anexo F: propuesta de registro de rutas (DNS de workspaces) dentro de la bóveda | arquitectura |

## Qué sigue

Volver a `00-INDICE.md`. Si algo del portafolio no permite ejecutar, el defecto está acá: abrir una
revisión y corregirlo.
