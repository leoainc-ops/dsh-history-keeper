---
id: "13"
titulo: "Experiencia y superficies"
estado: borrador
version: "0.8"
depende_de: ["10", "11", "12"]
alimenta_a: ["15", "16", "17"]
ultima_revision: "2026-11-11"
---

# 13 — Experiencia y superficies

Cómo se usa el producto y qué ve el usuario. Tres superficies, un mismo motor: **CLI**, **comandos
dentro de DSH** y **tool para el agente**.

## Principio

**Un solo gesto para el caso común.** Todo lo demás es opcional y se descubre cuando se necesita.

El caso común es: *"tengo una bóveda y quiero el historial en esta máquina"*. Eso es un comando, un
plan que se muestra una vez, y un recibo.

## Comandos

| Comando | Qué hace | Cuándo se usa |
|---|---|---|
| `keeper recover` | plan + apply del modo vigente | **el 90% de las veces** |
| `keeper recover --plan` | sólo el plan | antes de tocar nada |
| `keeper import --from <soporte>` | trae la bóveda y recupera | máquina nueva |
| `keeper export --to <soporte>` | lleva la bóveda, con recibo | antes de viajar |
| `keeper status` | qué tengo, qué falta | rutina |
| `keeper doctor` | consumo, restos, cobertura | mantenimiento |
| `keeper undo` | deshace lo último importado | arrepentimiento |
| `keeper verify` / `conform` | verificación explícita | auditoría |

Dentro de DSH, los mismos en español:

```text
/keeper recuperar
/keeper plan
/keeper estado
/keeper deshacer
```

## El plan

Es la pieza central de la experiencia: **antes de escribir, se ve qué va a pasar**.

```text
recuperar  bóveda <dir>  →  esta máquina
  modo            uso (el historial queda en claro, agrupado en DSH)
  11 sesiones     1 idéntica · 9 nuevas · 1 divergente
    + session-dd4e2186   Conectar repositorio dsh-history   10.7 MiB
    + session-1f151636   Decompilación de libro Excel        2.3 MiB
    ! session-9a347509   ya existe con otro contenido → se omite
    x session-e4561671   el host no conoce 3 tipos de evento → se importa con aviso
  10 adjuntos     3 a crear · 7 presentes
  avisos          2   (--detalle para verlos)
  bloqueos        0
  estimación      ≈ 4 s
  continuar con --apply
```

Reglas de presentación:

- Lo que **no** se va a hacer se muestra igual (`!`, `x`), nunca se omite.
- Los códigos crudos no se muestran al usuario final; se muestran con `--detalle`.
- La estimación es opcional y honesta: si no se sabe, no se muestra.

## El recibo

Una página, en texto o Markdown, con lo que el usuario guarda:

```text
RECIBO DE RECUPERACIÓN                        2026-11-11 16:30 -03:00
bóveda      6dd247c1…  (11 sesiones · 16.0 MiB)
frase       huella c343f28b6295ea92
modo        uso
resultado   11 de 11 sesiones · 10 adjuntos · verificación ok
sello       coincide en 11 de 11
avisos      2 (vocabulario parcial en 1 sesión)
procedencia obra26 · device 577d97… · endSha256 ce49586f…
```

El recibo **no** contiene la frase ni contenido de conversación. Se puede imprimir, archivar o
adjuntar sin riesgo.

## Mensajes de error

Tres líneas, siempre en el mismo orden (`05`):

```text
no se pudo importar: la bóveda no verifica (CHAIN_FAILED).
  no se escribió nada en esta máquina.
  revisá 17-OPERACIONES.md#chain-failed o probá con otra copia de la bóveda.
```

## Primera ejecución

1. `keeper status` → si no hay bóveda, sugiere `keeper init`.
2. `keeper init` → genera frase o pide una; la escribe en el archivo de clave con permisos
   restringidos; muestra la huella.
3. Aviso de texto en claro cuando corresponda.
4. Nada más.

## Superficie del agente

Una tool con las mismas dos fases:

```text
keeper_plan    { from: "<soporte>", modo: "archivo"|"uso" }  → plan
keeper_apply   { plan }                                                 → resultado + recibo
```

El agente nunca aplica sin mostrar el plan. La tool no acepta la frase como argumento: la lee del
archivo configurado.

## Pasos manuales

Objetivo: **≤ 2** para recuperar todo en una máquina nueva.

```text
1. instalar el plugin
2. keeper import --from <soporte>        (hace plan, confirma y aplica)
```

Cerrar DSH y reiniciar dejan de ser pasos obligatorios en modo `uso`.

## Preguntas abiertas

- ¿La confirmación del plan es interactiva o `--apply` explícito? Dueño: producto. Propuesta:
  interactiva en terminal, `--apply` en automatización.
- ¿Los comandos en español reemplazan a los ingleses o conviven? Propuesta: conviven en 2.x.

## Qué sigue

`14-PLAN-DE-ENTREGA.md` y `15-BACKLOG.md`: qué se construye primero para que esto exista.
