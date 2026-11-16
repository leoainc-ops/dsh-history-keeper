---
id: "12"
titulo: "Confianza y privacidad"
estado: aprobado
version: "1.0"
depende_de: ["02", "04"]
alimenta_a: ["11", "13", "16", "20"]
ultima_revision: "2026-11-11"
---

# 12 — Confianza y privacidad

## Las tres capas

| Capa | Qué es | Decisión |
|---|---|---|
| **A — verificación** | cadena de hashes, `keyCheck`, `verify`, `conform` | **no se relaja nunca** (C1, C2, C4) |
| **B — ceremonia y estrictez** | pasos previos, bloqueos, cuarentenas, defaults | **se relaja**: es el objetivo de 2.0 |
| **C — artefactos formales** | informe firmado, journal de auditoría, control de acceso, retención | **futuro y condicionado** a un cliente que lo pague |

Regla de oro: **se sacan trámites, no garantías.**

## La política de confianza

Tres perfiles. `default` es el de fábrica; `strict` reproduce 1.0.2; `relajado` es para el usuario
experto que sabe lo que hace.

| Clave | `strict` | `default` (2.0) | `relajado` |
|---|---|---|---|
| D1 verificación | manual (`conform` obligatorio) | automática e invisible | automática |
| D2 vocabulario del host | bloquea la sesión | importa y advierte | importa, sin aviso repetido |
| D3 secretos detectados | cuarentena (no publica) | aviso, publica | aviso, publica |
| D4 entorno de importación | exige `home` vacío | no exige | no exige |
| D5 DSH abierto | bloquea toda escritura | bloquea `archivo`, permite `uso` | avisa |

Cambiar de `strict` a `default` es un cambio de default → mayor (`18`).

## Texto en claro: el aviso que no se esconde

La bóveda está cifrada. El árbol de sesiones de DSH **no**. En el momento en que una conversación se
entrega —en cualquiera de los dos modos— queda legible en disco para cualquiera con acceso a la
máquina.

Por eso:

1. La primera importación en una máquina muestra el aviso, con estas palabras: *"las conversaciones
   van a quedar sin cifrar en esta computadora, como cualquier otra de DSH. La bóveda conserva el
   original cifrado."*
2. El aviso se repite en el recibo.
3. Existe `keeper doctor --privacidad` que enumera qué sesiones están en claro y cuáles sólo en la
   bóveda.
4. El modo `archivo` **también** deja el historial en claro: no hay que venderlo como si no.

## Escaneo de secretos

- Qué hace: busca en el texto a punto de publicarse patrones de credenciales y, opcionalmente,
  cadenas de alta entropía.
- Qué **no** hace: no imprime el valor encontrado, nunca.
- Comportamiento por política: cuarentena en `strict`, aviso en `default`. El mensaje dice la regla
  y la línea, no el contenido.
- Un falso positivo en `default` no bloquea; en `strict` sí, y el usuario puede reintentar con
  `--force` (que publica y lo deja registrado en el recibo).

## Modelo de amenazas (resumen)

| Amenaza | Qué la cubre | Qué no |
|---|---|---|
| robo del soporte (pendrive) sin la frase | cifrado AEAD + scrypt | nada más |
| robo del soporte **con** la frase | — | es el caso que la regla "la frase no viaja" evita |
| corrupción silenciosa | C1, C4 | — |
| manipulación del archivo entregado | C6 (sello + procedencia) | no hay firma criptográfica del recibo |
| acceso a la máquina desbloqueada | — | fuera de alcance |
| plugin malicioso | — | hay que confiar en el software que se ejecuta |

**Lo que no prometemos:** recuperar una frase olvidada, proteger una máquina desbloqueada, ni
sustituir una cadena de custodia formal.

## Postura de compliance

No hay certificaciones (ISO, SOC2) ni se buscan en 2.0. Lo que hay es un contrato verificable y un
recibo reproducible. La capa C es lo que faltaría para hablar con un auditor, y está condicionada.

## Registro de lo que se escribe

| Dato | Dónde | Contiene |
|---|---|---|
| journal | `home/history-keeper-journal.json` | ids, fechas, modo, storeId, deviceId, hashes |
| recibo | salida de la operación (`--out` opcional) | lo mismo, en una página legible |
| logs | nunca | frase, contenido de sesión, rutas de la bóveda más allá del `store` raíz |

El journal es un registro de efectos, no un estado: borrarlo no rompe nada y no habilita nada.

## Preguntas abiertas

- ¿El aviso de texto en claro se puede silenciar de forma permanente? Dueño: producto. Propuesta:
  sí, con una clave de configuración explícita y registrada en el recibo.

## Qué sigue

`13-EXPERIENCIA-Y-SUPERFICIES.md`: cómo se ven el aviso, el plan y el recibo.
