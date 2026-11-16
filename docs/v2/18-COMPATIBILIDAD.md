---
id: "18"
titulo: "Compatibilidad y migración"
estado: aprobado
version: "1.0"
depende_de: ["04", "07", "09"]
alimenta_a: ["16", "21"]
ultima_revision: "2026-11-11"
---

# 18 — Compatibilidad y migración

## Tres números, tres reglas

| Número | Hoy | 2.0 | Cuándo cambia |
|---|---|---|---|
| **Software** (`dsh-history-keeper`) | 1.0.2 | **2.0.0** | semver sobre comandos, defaults y compatibilidad con DSH |
| **Formato de bóveda** | `store/1` | **`store/1`** | sólo si un lector anterior no puede abrir lo nuevo |
| **Contrato** | — | `contract/1` | cambiarlo obliga a un major del software |

Regla de oro: **el software puede cambiar sin que la bóveda cambie**. Es lo que hace que 2.0 sea una
mejora y no una migración.

## Por qué 2.0.0 y no 1.1.0

Tres cambios rompen el contrato observable:

1. **El default de los gates cambia** (cuarentena → aviso; bloqueo por vocabulario → importación
   tolerante). Quien dependía de que el producto se negara tiene otro producto.
2. **Aparece un modo con garantías distintas** (`uso` pierde identidad byte a byte). El modelo mental
   y la superficie de configuración cambian; el contrato gana C6.
3. **Sube el piso de DSH** (API de persistencia): deja de instalarse en hosts donde 1.0.2 sí.

Si los defaults hubieran quedado estrictos y `uso` fuera opt-in, sería **1.1.0**. La decisión de
producto (capa B como objetivo) es la que fija el número. Ver `19` ADR-001.

## Reglas de semver

| Cambio | Versión |
|---|---|
| agregar comando, modo, campo opcional | menor |
| corregir sin cambiar comportamiento observable | parche |
| cambiar un default que altera qué se bloquea | **mayor** |
| cambiar el contrato (C1–C6) | **mayor** + `contract/2` |
| subir el piso de DSH | **mayor** |
| cambiar el formato de bóveda | **mayor** + `store/2` |

## `minReader`

- 2.0 **no sube** `minReader`: sigue declarando que una bóveda escrita por 2.0 se lee con 1.0.x.
- Los campos nuevos son opcionales y los lectores viejos los ignoran.
- Si alguna vez un campo nuevo fuera obligatorio, eso es `store/2`, y exige plan de migración
  explícito (que hoy no existe ni se desea).

## Interoperabilidad

| Productor \ Lector | 1.0.2 | 2.0 |
|---|---|---|
| bóveda escrita por 1.0.2 | sí | **sí** |
| bóveda escrita por 2.0 | **sí** | sí |
| sesión publicada en `archivo` por 1.0.2 | — | legible por DSH |
| sesión publicada en `uso` por 2.0 | — | depende de DSH, no del plugin |

Se verifica en CI con las mismas bóvedas doradas en las dos líneas (`16`).

## Compatibilidad con DSH

| Aspecto | Regla |
|---|---|
| Piso | el que tenga `sessionPersistence.create/append/flush`; hoy `0.2.2-rc.1` |
| Techo | no se declara: se degrada por capacidades (`09`) |
| Falla de capacidad | el modo que la necesita no se ofrece; nunca se simula |
| Cambio de firma de un servicio | falla en `capabilities()`, no en el momento de escribir |

## Líneas de release

```text
main           → 2.0 (desarrollo)
release/1.x    → congelada: sólo security y bugfix, sin features
tags           → v1.0.2 · v2.0.0-beta.1 … · v2.0.0
```

- No hay fork: misma gobernanza, mismo linaje (`19` ADR-002).
- 1.x se mantiene mientras haya usuarios en `strict` o mientras la capa C no exista.
- El retiro de 1.x se anuncia con una versión menor de 2.x y una fecha.

## Sin migración de datos

Instalar 2.0 sobre 1.0.2:

1. no toca la bóveda;
2. no pide pasos;
3. los defaults cambian y se avisa (`12`);
4. la configuración vieja sigue valiendo; las claves nuevas entran con su default.

Si algún día hace falta un paso de migración, es señal de que se rompió C5 y hay que revertirlo.

## Preguntas abiertas

- ¿Cuánto tiempo se sostiene `release/1.x`? Dueño: producto. Propuesta: hasta que la capa C exista o
  hasta 12 meses después de 2.0.0, lo que ocurra primero.

## Qué sigue

`19-ADR.md` con las decisiones que produjeron estas reglas.
