# dsh-history-keeper

El historial de tus conversaciones de DeepSeek Harness, en una bóveda que es tuya.

| | |
|---|---|
| Publicado | **1.0.2** — `npm i dsh-history-keeper`, línea estable `1.0.x` |
| Esta rama | **2.0.0-dev** — en desarrollo, sin publicar |
| Formato de bóveda | `dsh-history-keeper/store/1` — **2.0 no lo cambia** |
| Licencia | código: PolyForm Noncommercial 1.0.0 · documentación: ver [`LICENSE-DOCS`](LICENSE-DOCS) |

## Qué es

Un plugin de DSH más una CLI que guarda tus sesiones en una **bóveda cifrada y autodescriptiva** que
podés llevar en un pendrive: con la bóveda y la frase alcanza para recuperar las conversaciones en
otra máquina. La bóveda no depende de DSH para leerse.

**No es** un servicio de sincronización, ni un respaldo de tus proyectos, ni un visor, ni una forma de
leer el historial ajeno. No repara corrupción: la detecta y falla cerrado.

## Los dos modos de entrega (2.0)

| | `archivo` | `uso` |
|---|---|---|
| Qué hace | restituye el original, byte por byte | le entrega la conversación a DSH para que DSH la escriba, indexe y agrupe |
| Integridad | la cadena de la bóveda y los bytes extraídos | un sello de contenido sobre el original |
| Máquina | funciona con DSH cerrado | DSH es el escritor; no hay que cerrar nada |
| Para qué | prueba, archivo, recuperación en un host nuevo | el día a día entre tus máquinas |

`archivo` ya existe; `uso` es la razón de ser de 2.0. Ver [`docs/10-MODO-ARCHIVO.md`](docs/10-MODO-ARCHIVO.md)
y [`docs/11-MODO-USO.md`](docs/11-MODO-USO.md).

## El contrato, en seis líneas

| | Invariante |
|---|---|
| **C1** | Lo que se entrega es exactamente lo archivado (hashes por chunk, de prefijo y de cierre). |
| **C2** | Una frase equivocada falla **antes** de crear, publicar o mover nada. |
| **C3** | Nada existente se reemplaza; un conflicto se resuelve con un id nuevo, un rechazo o un archivo. |
| **C4** | Ante corrupción, la entrega aborta con código y no escribe nada parcial. |
| **C5** | `store/1` se sigue leyendo y escribiendo; sólo se agregan campos opcionales. |
| **C6** | Toda entrega deja procedencia: bóveda, dispositivo, sello de contenido y modo. |

El contrato completo, con los defaults negociables, está en [`docs/04-CONTRATO.md`](docs/04-CONTRATO.md).

## Mapa del repositorio

| Ruta | Qué vive ahí |
|---|---|
| `lib/` | el motor: store, cifrado, chunks, verificación, merge, export/import, restore, catálogo |
| `bin/keeper.js` | la CLI |
| `cordis.patch.yml` | el bundle del plugin |
| `docs/` | **el portafolio de 2.0** — empezá por [`docs/00-INDICE.md`](docs/00-INDICE.md) |
| `docs/1.0/` | la documentación de 1.0.x, congelada |
| `test/` · `conformance/` | la suite y el kit de certificación |
| `scripts/` | `guard-no-sessions` y las herramientas de publicación |

## Leer el portafolio

`docs/00-INDICE.md` es el mapa: un documento por pregunta, progresivo e intervinculado. Para un
desarrollador el camino es `00 → 01 → 04 → 05 → 06 → 07 → 09 → (10 u 11) → 15 → 16`.

El portafolio es la especificación contra la que se construye 2.0. Si un documento contradice
[`docs/04-CONTRATO.md`](docs/04-CONTRATO.md), el documento está mal.

## Desarrollar

```bash
npm test            # la suite, node --test
npm run guard       # falla si hay logs de sesión reales versionados
npm run conformance # el kit de certificación
```

Node `^22.19.0 || >=24.0.0`. **Sin dependencias de ejecución**: si aparece una, CI falla.

Desde esta rama no se publica nada; la documentación de la línea publicada vive en
[`docs/1.0/`](docs/1.0/).

## Seguridad

La bóveda se cifra con AES-256-GCM y una clave derivada de la frase (scrypt). La frase es el único
secreto y no viaja. Leé [`SECURITY.md`](SECURITY.md) antes de llevar una bóveda en un soporte
extraíble.
