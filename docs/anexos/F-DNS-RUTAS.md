---
id: "F"
titulo: "Propuesta — registro de rutas dentro de la bóveda (DNS de workspaces)"
estado: "propuesta"
version: "0.1"
depende_de: ["07", "08", "10", "11"]
alimenta_a: ["09", "10", "11", "18"]
ultima_revision: "2026-11-21"
---

# F — Registro de rutas dentro de la bóveda

Una conversación lleva la **ruta absoluta** del host donde nació. Esa ruta sirve en su host y en
cualquier otro donde exista **exactamente la misma**, pero fuera de ahí es procedencia, no dirección.
Hoy la traducción vive en el home (T6). Esta propuesta la sube a la bóveda, con una identidad estable
por workspace: el equivalente a un **DNS de rutas**.

## El problema en una línea

No hay **nombres** de workspace; sólo **direcciones** (rutas absolutas). Un nombre viaja; una
dirección caduca en cuanto cambia el host.

## La distinción

| DNS | Bóveda |
|---|---|
| nombre | identidad lógica del workspace (`acme/dsh-history`) |
| registro A | ruta absoluta en cada host |
| TTL / validación | la ruta existe y sigue siendo el mismo proyecto |
| zona | la bóveda (cifrada, viaja) |
| resolver | el plugin, al montar |

## Opción A — derivado (sin formato nuevo)

El mapa se **calcula** de lo que ya está en los manifiestos: por cada sesión, `origin.deviceId` +
`header.cwd`.

```text
workspace percibido
  pc-a (fe03fe47)  →  G:\Mi unidad\IA - Agentes\dsh-history
  pc-b (bd86d152)  →  C:\Users\Obras26\Documents\deepseek-harness\default-workspace
```

- **Ventaja**: cero cambios de formato, siempre consistente con lo archivado, imposible de
  desincronizar.
- **Límite**: no hay nombre lógico; sólo correspondencia entre rutas.

## Opción B — declarado (registro en la bóveda)

Una entrada de manifiesto (no `meta.json`) con nombre lógico y resoluciones por dispositivo:

```json
{ "id": "ws-acme-dsh", "name": "dsh-history",
  "hosts": { "fe03fe47": "G:\\…\\dsh-history",
             "bd86d152": "C:\\Users\\Obras26\\…\\default-workspace" },
  "updatedAt": "…" }
```

- Va en un manifiesto, como **campo opcional**: `store/1` no cambia y `minReader` no sube.
- Es append-only como el resto: cada cambio deja una entrada nueva; la resolución vigente es la más
  reciente.
- El `id` es el **nombre**; las rutas son los **registros A**.

## Las tres reglas que lo hacen confiable

1. **La ruta no es la identidad.** Manda el nombre lógico. Si la ruta deja de existir, se marca
   `stale` y se pide resolución; no se adivina.
2. **Verificar antes de confiar.** Que la ruta exista no alcanza: dos máquinas pueden tener la misma
   letra apuntando a discos distintos. Una marca en la carpeta (`.dsh-workspace` con el id lógico)
   confirma el proyecto.
3. **Resuelve el destino.** El plugin busca la resolución para **su** `deviceId`; si falta, crea el
   workspace y **agrega su propia resolución** al registro.

## Qué se escribe y cuándo

| Momento | Escritura |
|---|---|
| montaje con `uso` | el plugin resuelve/crea el workspace y agrega `{deviceId, path}` al registro |
| montaje con `archivo` | sólo lectura del registro; no se agrega resolución |
| `keeper mount --undo` | no borra del registro: agrega una entrada con `retiredAt` |
| traducción manual | `keepers translations` (hoy en el home) sigue existiendo como override local |

## Compatibilidad

- Lectores viejos ignoran el bloque (campo opcional).
- Un lector nuevo sin registro cae a la ruta del `cwd` y a la traducción del home: mismo
  comportamiento que 2.0 sin esta propuesta.
- El registro no contiene contenido de sesión, sólo geografía.

## Privacidad

Las rutas incluyen nombres de usuario y de proyecto. La bóveda está cifrada; el recibo y cualquier
listado en claro deben **redactar** el usuario (`C:\Users\<usuario>\…`) como ya hace el digesto.

## Criterios de aceptación (cuando se implemente)

1. Montar la misma sesión en dos hosts deja dos resoluciones en el registro.
2. Un tercer host la monta con `archivo` sin tocar el registro y sin romper nada.
3. Una ruta que ya no existe se reporta `stale` y el montaje lo muestra antes de escribir.
4. La marca `.dsh-workspace` detecta una ruta que existe pero no es el mismo proyecto.
5. `conformance` sigue pasando: el fixture no necesita el bloque.

## Preguntas abiertas

1. ¿El nombre lógico lo elige el usuario o se deriva del nombre de la carpeta? Propuesta: lo elige la
   primera vez, con el nombre de la carpeta como default.
2. ¿Quién escribe el registro: el plugin (tiene el `workspaceRegistry`) o el CLI (tiene la bóveda)?
   Propuesta: el plugin cuando monta con `uso`; el CLI sólo lo lee.
3. ¿La marca `.dsh-workspace` se crea dentro de la carpeta del proyecto? Efecto secundario en el
   árbol del usuario; decidir si es aceptable o si basta con una huella en el registro.

## Qué sigue

Cuando esta propuesta se implemente: actualizar `07` (campo opcional), `08` (resolución), `10`/`11`
(modos) y `16` (TC de resolución).
