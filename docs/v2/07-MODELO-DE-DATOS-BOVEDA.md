---
id: "07"
titulo: "Modelo de datos de la bóveda"
estado: aprobado
version: "1.0"
depende_de: ["04", "05", "06"]
alimenta_a: ["08", "09", "10", "18"]
ultima_revision: "2026-11-11"
---

# 07 — Modelo de datos de la bóveda

Formato vigente: **`dsh-history-keeper/store/1`**. En 2.0 **no cambia** (C5). Este documento es la
referencia normativa para leerlo y escribirlo.

## Árbol

```text
<store>\
├─ meta.json                  índice raíz (texto plano, sin secretos)
├─ devices\<deviceId>.json    una cabeza por dispositivo
├─ objects\<id>.bin           contenidos sellados; id = 16 bytes aleatorios en hex
└─ LOCK                       transitorio: pid del escritor (no es contenido)
```

## `meta.json`

| Campo | Tipo | Obligatorio | Significado |
|---|---|---|---|
| `format` | string | sí | `dsh-history-keeper/store/1` |
| `storeId` | hex32 | sí | identidad de la bóveda; viaja con ella |
| `createdAt` | ISO-8601 | sí | creación |
| `aead` | string | sí | `aes-256-gcm` (o `chacha20-poly1305` histórico) |
| `kdf` | objeto | sí | `{alg:"scrypt", N:32768, r:8, p:1, keyLen:32, salt:base64}` |
| `keyCheck` | objeto | sí | `{nonce, ciphertext}` en base64: texto constante sellado |
| `deviceId` | hex32 | sí | dispositivo que creó la bóveda |
| `deviceName` | string | sí | nombre legible |
| `manifest` | objeto\|null | sí | `{id, cipherSha256}`: cabeza heredada |
| `snapshots` | número | sí | cantidad de manifiestos de la cabeza heredada |
| `retention` | objeto | no | `{autoGc, compactAfterManifests, keepReplacedCopies}` |
| `writer` / `minReader` | objeto | no | versión que escribió y lector mínimo |
| `upgrades` | array | no | historial de actualizaciones de formato |

**Regla de 2.0:** no se agregan campos obligatorios. Si se agrega procedencia, va en el manifiesto
como campo opcional, no acá.

## `devices\<deviceId>.json`

```json
{ "deviceId": "…", "deviceName": "lab-host",
  "head": { "id": "…", "cipherSha256": "…" }, "seq": 1, "updatedAt": "…" }
```

Un archivo por dispositivo. `head` puede ser `null` (dispositivo registrado sin escribir). El nombre
del archivo es `<deviceId>.json`, con `deviceId` validado contra `^[0-9a-f]{32}$`.

## El objeto sellado

```text
"DKO1" (4) | nonce (12) | ciphertext (N) | tag (16)
```

- `N = bytes_en_claro`; el archivo mide `N + 32`.
- Clave: `scrypt(NFKC(frase), salt, 32768, 8, 1, 32)`.
- El tag se verifica antes de devolver un solo byte. Falla → `cannot decrypt` (C4).

## El manifiesto

```json
{
  "format": "dsh-history-keeper/manifest/1",
  "seq": 7,
  "createdAt": "…",
  "deviceId": "…",
  "prev": { "id": "…", "cipherSha256": "…" },
  "sessions": {
    "<sessionId>": {
      "formatVersion": 4,
      "header": { "id": "…", "cwd": "C:\\…", "createdAt": 1794000000000, "isSeeded": false },
      "chunks": [ { "seq": 1, "objectId": "…", "cipherSha256": "…", "cipherBytes": 206,
                    "plainSha256": "…", "prefixSha256": "…", "endSha256": "…",
                    "frameFrom": 0, "frameTo": 1, "byteFrom": 0, "byteTo": 174,
                    "createdAt": "…" } ],
      "capturedBy": "1.0.2",
      "user": "…",
      "origin": { "deviceId": "…", "deviceName": "…", "storeId": "…" }
    }
  },
  "attachments": { "<sha256>": { "objectId": "…", "cipherSha256": "…",
                                 "cipherBytes": 932, "bytes": 900, "createdAt": "…" } },
  "archived": { "<sessionId>@<dev8>": { … } },
  "reset":   { "<sessionId>": true },
  "kind":    "checkpoint" | "merged",
  "covers":  { … }
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `format` | sí | rechazo si no coincide |
| `seq` | sí | por dispositivo, creciente, sin huecos |
| `deviceId` | sí | quién escribió este manifiesto |
| `prev` | sí (puede ser `null`) | enlace; `null` sólo en el primero o en un checkpoint |
| `sessions` | sí (puede ser `{}`) | clave = `sessionId` |
| `attachments` | no | clave = `sha256` del contenido en claro |
| `archived` | no | clave = `<sessionId>@<primeros 8 del deviceId dueño>`; **no se restituye** |
| `reset` | no | `true` por sesión: este manifiesto reemplaza su linaje |
| `kind` / `covers` | no | procedencia de checkpoints y fusiones |
| `header.cwd` | sí (puede ser `null`) | **define la carpeta de destino** |
| `formatVersion` | sí | **define el nombre del archivo** |
| `origin` | no | procedencia original (importaciones) |

## Invariantes del chunk

1. `seq` empieza en 1 y es contiguo por sesión.
2. `byteFrom == byteTo del chunk anterior` (el primero, 0).
3. `frameFrom == frameTo del anterior` (el primero, 0).
4. `prefixSha256` == hash de todo el log antes del chunk.
5. `endSha256` == hash de todo el log incluyendo el chunk.
6. `sha256(descifrado) == plainSha256`.
7. `sha256(objeto) == cipherSha256`.
8. `cipherBytes == bytes + 32`.

Cualquier violación es un código de `C4` y detiene la entrega.

## Límites

| Parámetro | Valor | Efecto |
|---|---|---|
| `maxChunkBytes` | 1 MiB | objetivo de corte; un frame grande gana |
| `MAX_CHUNK_FRAMES` | 512 | techo de frames por chunk |
| tamaño de id de objeto | 16 bytes (~32 hex) | espacio de nombres, no contenido |
| `compactAfterManifests` | 50 | política de checkpoint |

## Escritura atómica

Todo se escribe con `tmp` en el mismo directorio + `fsync` + `rename`. Nunca se escribe encima de un
objeto (los ids son nuevos). El `meta.json` se reemplaza sólo al avanzar la cabeza heredada.

## Qué NO va en la bóveda

`workspace.json`, `session_projcache`, credenciales, perfiles, títulos derivados, estado de pin o
archivado del panel. Ver `08` §10.

## Preguntas abiertas

- ¿Se documenta `chacha20-poly1305` como legado o se elimina del lector en 2.0? Dueño: arquitectura.
  Propuesta: se mantiene para leer, nunca para escribir.

## Qué sigue

`08-TRAZADO-Y-RESTITUCION.md`: cómo se pasa de este modelo al lugar de origen y de vuelta.
