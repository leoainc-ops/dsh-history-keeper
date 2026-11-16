---
id: "05"
titulo: "Glosario y convenciones"
estado: aprobado
version: "1.0"
depende_de: ["04"]
alimenta_a: ["06", "07", "13", "15", "16"]
ultima_revision: "2026-11-11"
---

# 05 — Glosario y convenciones

Un solo vocabulario para documentos, código, mensajes y backlog. Si un término no está acá, no se
usa.

## Dominio

| Término | Definición |
|---|---|
| **bóveda** (`store`) | carpeta cifrada con `meta.json`, `objects/` y `devices/` |
| **frase** | la contraseña de la bóveda; la única que hay |
| **objeto** | archivo `objects/<id>.bin`; puede ser chunk, adjunto o manifiesto |
| **manifiesto** | documento cifrado que describe qué objetos forman qué sesión |
| **cabeza** (`head`) | puntero al último manifiesto de un dispositivo |
| **chunk** | trozo de un log de sesión, cortado en límites de frame zstd |
| **sesión** | una conversación, tal como DSH la guarda en `sessions/` |
| **adjunto** | blob referenciado por una sesión, direccionado por `sha256` |
| **captura** (`snapshot`) | acto de publicar bytes nuevos de una sesión en la bóveda |
| **exportar / importar** | llevar la bóveda a un soporte / traerla |
| **restituir** (`restore`) | devolver el contenido de la bóveda a un `home` de DSH |
| **recibo** | documento de una página que resume una operación y su verificación |
| **sello de contenido** | `sha256` de la secuencia canónica de eventos de una sesión |
| **procedencia** | registro de bóveda/dispositivo/huella de origen de lo entregado |
| **journal** | registro local de lo que el plugin creó, para deshacer |
| **modo `archivo`** | entrega byte exacta, cifrada, con verificación |
| **modo `uso`** | entrega nativa: DSH escribe y administra la sesión |
| **capa A / B / C** | verificación / ceremonia / artefactos formales de compliance (`12`) |
| **política de confianza** | `strict` · `default` · `relajado` (`12`) |

## Estados de un documento

`borrador` → `revisado` → `aprobado` → (`obsoleto`)

## Identificadores

| Prefijo | Uso | Ejemplo |
|---|---|---|
| `C1…C6` | cláusulas del contrato | C3 |
| `D1…D5` | defaults negociables | D2 |
| `RF-xx` | requisito funcional | RF-08 |
| `TC-x` | prueba de contrato | TC-5 |
| `T-xx` | prueba de requisito | T-08 |
| `K-xx` | tarea de backlog | K-21 |
| `Hx` | hipótesis de mercado | H3 |
| `ADR-xxx` | decisión registrada | ADR-002 |
| `F0…F4` | fase de entrega | F2 |

## Nombres de archivo

- Documentos: `NN-TITULO-EN-MAYUSCULAS.md`, con `NN` de dos dígitos.
- Anexos: `anexos/X-TITULO.md`, con `X` una letra (`A`, `B`…). Los anexos son históricos.
- Enlaces: siempre relativos, sin rutas absolutas, sin `file://`.

## Nombres en el código

| Elemento | Convención | Ejemplo |
|---|---|---|
| Paquete | `dsh-history-keeper` (se conserva el nombre) | — |
| Servicio del plugin | `ctx.keeper` | `ctx.keeper.status()` |
| Módulos del núcleo | `core/` sin dependencias del host | `core/vault.js` |
| Módulos del adaptador | `host/` sin criptografía | `host/publish.js` |
| Comandos | verbo en inglés en el CLI, español en la doc | `keeper recover` / "recuperar" |
| Códigos de error | MAYÚSCULAS_CON_GUIONES | `SELLO_DISTINTO` |
| Campos nuevos de bóveda | `snakeCase` sólo si el formato ya lo usa; si no, `camelCase` | `originHash` |

## Convención de mensajes

Todo mensaje al usuario responde, en este orden: **qué pasó**, **qué no se tocó**, **qué hacer**.
Nunca imprime la frase, ni contenido de sesión, ni rutas de la bóveda más allá del `store` raíz.

Ejemplo correcto:

```text
no se importó session-dd4e2186: el host no conoce 2 tipos de evento.
  nada se escribió en esta máquina.
  reintentá con --tolerante, o revisá 17-OPERACIONES.md#vocabulario.
```

## Preguntas abiertas

Ninguna. El nombre del producto queda fijado: **`dsh-history-keeper`** en toda la línea 2.x, con la
versión como único sufijo (`dsh-history-keeper` v2.0.0) y sin alias de producto en la documentación.

## Qué sigue

`06-ARQUITECTURA.md`, que usa este vocabulario sin volver a definirlo.
