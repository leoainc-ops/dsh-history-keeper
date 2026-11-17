---
id: "B"
titulo: "Anexo B — Trazado detallado de la bóveda"
estado: historico
version: "1.0"
depende_de: []
alimenta_a: []
ultima_revision: "2026-11-11"
---

> **Documento histórico.** Es la disección completa de una bóveda real, hecha el 2026-11-11, y la
> fuente experimental de `08-TRAZADO-Y-RESTITUCION.md`. No se corrige: si contradice un documento
> vivo, gana el vivo.
# Trazado de la bóveda de `dsh-history-keeper`

Qué guarda, de dónde lo saca y cómo cada elemento vuelve a su lugar de origen leyendo sólo el trazado.

Máquina: `<usuario>` · plugin `dsh-history-keeper 1.0.2` · formato `dsh-history-keeper/store/1`
Bóveda de referencia del trazado: laboratorio controlado del 2026-11-11 (cifras al final, §8)
Método: lectura del código del plugin (`lib/*.js`) + disección de una bóveda real creada para este documento.

---

## 0. La regla que ordena todo

Dentro de la bóveda hay exactamente **tres clases** de elemento:

| Clase | Qué es | ¿Se restituye? |
|---|---|---|
| **Datos de sesión** | trozos (chunks) de un log `.jsonl.zstd` de DSH | **sí**, byte por byte |
| **Blobs de adjuntos** | el contenido de una imagen/archivo pegado en una conversación | **sí**, byte por byte |
| **Índices** | `meta.json`, manifiestos, `devices/*.json` | no: son el mapa, no el territorio |

El trazado es suficiente porque cada objeto de datos lleva, en el índice que lo referencia, los tres datos
que hacen falta para volver: **qué bytes son** (posición y longitud), **de qué archivo salieron** (el `cwd` y el
`formatVersion` de la sesión, o el `sha256` del blob) y **cómo se comprueba** (hashes).

La observación central: **la bóveda no guarda rutas; guarda los ingredientes de la ruta.**
Una sesión se restituye a `<home>\sessions\<projectKey(cwd)>\<sessionId>\session.v<N>.jsonl.zstd`, y las tres
variables salen del propio manifiesto. Un adjunto se restituye a
`<home>\attachments\v1\objects\<sha256[0:2]>\<sha256>`, y la ruta entera sale del hash.

---

## 1. Frontera de entrada: de dónde lee

| Entrada | Default (config.js) | Qué toma |
|---|---|---|
| `sessionsRoot` | `%USERPROFILE%\.dsh\sessions` | los logs `session.vN.jsonl.zstd` del árbol de sesiones de DSH |
| `attachmentsRoot` | `<padre de sessionsRoot>\attachments` | sólo los blobs que las sesiones publicadas referencian |
| `keyFile` | `%USERPROFILE%\.dsh\history-keeper.key` | la frase (o `passphraseFile`, o `$KEEPER_PASSPHRASE`) |
| `deviceName` | `os.hostname()` | identidad que firma los manifiestos |
| `store` | `%USERPROFILE%\.dsh\history-keeper` | destino de la bóveda |

**Lo que NO entra** (y por tanto no se restituye, porque nunca estuvo): `storages\workspace.json` (agrupación y
orden), `storages\session_projcache\` (caché de proyección), `.credentials.yaml`, `profiles\`, los títulos
derivados y el estado de archivado/pin. La bóveda es historia de conversaciones y sus adjuntos; no es un clon
del home de DSH.

---

## 2. Anatomía de la bóveda

```text
<store>\
├─ meta.json                     índice raíz: identidad de la bóveda y puntero de cabeza
├─ devices\<deviceId>.json       una cabeza por dispositivo (puntero + seq)
├─ objects\<id>.bin              TODOS los contenidos, opacos, 32 hex aleatorios
└─ LOCK                          transitorio: pid del que escribe (no es contenido)
```

Bóveda de laboratorio completa (6 objetos, 4 chunks + 1 adjunto + 1 manifiesto):

```text
\vault\
  meta.json
  devices\0123456789abcdef0123456789abcdef.json
  objects\03e4fcc9cc50148132485df75df51e9d.bin    206 B   chunk 1
  objects\dd8d35dfef8ce998145a7611fdd6d1d8.bin    185 B   chunk 2
  objects\a078ace6ce9efb08232e35799d4f9127.bin    118 B   chunk 3
  objects\d176abff9aab94eeb55018ff7957760c.bin    100 B   chunk 4
  objects\46cd26402c0eee15da97efa4244d38e7.bin    932 B   adjunto
  objects\e69b3a65709c72157a9edd456f676230.bin   2712 B   manifiesto
```

Los nombres de objeto son **aleatorios de 128 bits** (`newId()` = 16 bytes en hex) y no dicen nada del
contenido: dos bóvedas distintas tienen ids distintos para el mismo archivo. Por eso el id **no** es parte del
trazado: es sólo la llave física. Lo que viaja en el trazado son posiciones y hashes.

---

## 3. El sobre de cada objeto

Todo objeto, sin excepción, es un sobre cifrado con este layout fijo:

```text
┌────────┬─────────────┬──────────────────────┬──────────┐
│ "DKO1" │ nonce (12)  │ ciphertext (= N)     │ tag (16) │
└────────┴─────────────┴──────────────────────┴──────────┘
   4 B        12 B            N B               16 B
```

- AEAD: **AES-256-GCM** (registrado en `meta.json → aead`).
- Clave: `scrypt(NFKC(frase), salt, N=32768, r=8, p=1, len=32)`, con el `salt` de `meta.json`.
- Consecuencia práctica: `cipherBytes = bytes_en_claro + 32`. Es la primera comprobación de cordura del
  trazado (206 = 174 + 32, 932 = 900 + 32, …).
- La clave se comprueba al abrir con `keyCheck`: un texto constante sellado en `meta.json`. Frase equivocada
  = `wrong passphrase`, antes de tocar ningún objeto.

---

## 4. El manifiesto: el único documento que explica el resto

Cada escritura produce **un** manifiesto (un objeto más) y mueve la cabeza. Ejemplo completo y real del
laboratorio, sin abreviar:

```json
{
  "format": "dsh-history-keeper/manifest/1",
  "seq": 1,
  "createdAt": "2026-11-11T16:30:00.000Z",
  "deviceId": "0123456789abcdef0123456789abcdef",
  "prev": null,
  "sessions": {
    "session-11111111-2222-3333-4444-555555555555": {
      "formatVersion": 4,
      "header": {
        "id": "session-11111111-2222-3333-4444-555555555555",
        "cwd": "C:\Users\<usuario>\\Documents\\demo-workspace",
        "createdAt": 1794000000000,
        "isSeeded": false
      },
      "chunks": [
        { "seq": 1, "objectId": "03e4fcc9cc50148132485df75df51e9d",
          "cipherSha256": "5a5bc8924cf35c341ec7a8fd3acd59279798ce06a896381a2537fa70d4a59815",
          "cipherBytes": 206,
          "plainSha256": "07d4d1d45c213262c3fb8ccfa578a79cabfa4619c6cd78e23fb6f474c3db6dec",
          "prefixSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "endSha256": "07d4d1d45c213262c3fb8ccfa578a79cabfa4619c6cd78e23fb6f474c3db6dec",
          "frameFrom": 0, "frameTo": 1,
          "byteFrom": 0, "byteTo": 174,
          "createdAt": "2026-11-11T16:30:00.000Z" },
        { "seq": 2, "objectId": "dd8d35dfef8ce998145a7611fdd6d1d8",
          "cipherSha256": "fc4cfde6769bbf7dd7e6d71185241fae329f7ccf690217d07a80a52e9e67f880",
          "cipherBytes": 185,
          "plainSha256": "616081a251b648a459f81595c1455e01b417b35ec44224b9b9caaf725c098ad5",
          "prefixSha256": "07d4d1d45c213262c3fb8ccfa578a79cabfa4619c6cd78e23fb6f474c3db6dec",
          "endSha256": "0e4ac4bdc93eb75b6345480ae50379ce02d8f3b8ee9a0415ce72015ba4fe3318",
          "frameFrom": 1, "frameTo": 2,
          "byteFrom": 174, "byteTo": 327,
          "createdAt": "2026-11-11T16:30:00.000Z" },
        { "seq": 3, "objectId": "a078ace6ce9efb08232e35799d4f9127",
          "cipherSha256": "aaf418a70d01629250e2e3a3ddbf294d0c387f652c60dccfa465ce7c2540d862",
          "cipherBytes": 118,
          "plainSha256": "40292c39cadb47d9e4b3738627069343ecff5cf1f8dd4bf21377d89f4f6ef680",
          "prefixSha256": "0e4ac4bdc93eb75b6345480ae50379ce02d8f3b8ee9a0415ce72015ba4fe3318",
          "endSha256": "4f0a7a9c28b7cf128f27193810acb07a0ba4cc8012cf590226dfbf174f3a2aa7",
          "frameFrom": 2, "frameTo": 3,
          "byteFrom": 327, "byteTo": 413,
          "createdAt": "2026-11-11T16:30:00.000Z" },
        { "seq": 4, "objectId": "d176abff9aab94eeb55018ff7957760c",
          "cipherSha256": "e988e9327e754da8318a38bdeed9359ce1a2d5e0a46636efdddae530080e82d6",
          "cipherBytes": 100,
          "plainSha256": "718aa182644951ef78bb4a1798639e150558d040d478140a0a419aa61fea34df",
          "prefixSha256": "4f0a7a9c28b7cf128f27193810acb07a0ba4cc8012cf590226dfbf174f3a2aa7",
          "endSha256": "ce49586fbda5eefdee5ad8b27f9e9cd6e4118374685fee3b5f6616afdb482534",
          "frameFrom": 3, "frameTo": 4,
          "byteFrom": 413, "byteTo": 481,
          "createdAt": "2026-11-11T16:30:00.000Z" }
      ],
      "capturedBy": "1.0.2",
      "user": "<usuario>"
    }
  },
  "attachments": {
    "8cc13f7179855150d2e426ea5c913c3d5930c955512b2888f0e23830c1f1651d": {
      "objectId": "46cd26402c0eee15da97efa4244d38e7",
      "cipherSha256": "48cfe04229c25dd10f4964aa76b1d5ff865e0e96e0aefa1ba8c87dc32fbd926b",
      "cipherBytes": 932,
      "bytes": 900,
      "createdAt": "2026-11-11T16:30:00.000Z"
    }
  }
}
```

Campos y qué aportan al trazado:

| Campo | Significado | Papel en la restitución |
|---|---|---|
| `format` | `dsh-history-keeper/manifest/1` | rechazo de objetos que no son manifiestos |
| `seq` | número de manifiesto del dispositivo | orden de la cadena |
| `createdAt` | instante UTC de la captura | procedencia temporal |
| `deviceId` | quién lo escribió | origen del dato (§4.2) |
| `prev` | `{id, cipherSha256}` del manifiesto anterior, o `null` | enlace de la cadena |
| `sessions[<id>]` | la sesión y sus chunks | **define el archivo de destino** |
| `formatVersion` | versión del log (4 en esta instalación) | **nombre del archivo** `session.v4…` |
| `header.cwd` | carpeta de trabajo de la sesión | **carpeta de destino** vía `projectKey` |
| `chunks[]` | descriptores ordenados por `seq` | **contenido y offsets** |
| `attachments[<sha256>]` | blob por hash de su contenido | **ruta de destino autocontenida** |
| `archived{<id>@<dev8>}` | continuación divergente conservada | se verifica, **no se restituye** |
| `reset{<id>:true}` | este manifiesto reemplaza el linaje de esa sesión | ignorar descriptores viejos |
| `kind` | `checkpoint` / `merged` | procedencia de una cadena reconstruida |
| `covers` | qué reemplazó un checkpoint (`manifests`, `from`, `to`, `previousHead`) | auditoría de la compactación |

### 4.1 La cadena

Cada dispositivo tiene su cabeza en `devices\<deviceId>.json`:

```json
{ "deviceId": "0123456789abcdef0123456789abcdef",
  "deviceName": "lab-host",
  "head": { "id": "e69b3a65709c72157a9edd456f676230",
            "cipherSha256": "4cefdec911ec28d9aa360b3203861f35d2801914908501fe464c699f39fffa10" },
  "seq": 1,
  "updatedAt": "2026-11-11T16:31:33.078Z" }
```

`meta.json` guarda además el puntero heredado (`manifest`), que se usa cuando hay un solo dispositivo y queda
congelado cuando aparece un segundo. Para leer la bóveda: cabezas = `meta.manifest` **+** cada `devices\*.json`,
recorrer `prev` desde cada una, y **deduplicar por `id`** (dos cadenas comparten prefijo).

### 4.2 Origen del dato

- `deviceId` del manifiesto = el dispositivo que **capturó** ese bloque.
- En una importación, cada entrada de sesión lleva además `origin: {deviceId, deviceName, storeId}`: el
  dispositivo que lo publicó **originalmente**. El manifiesto local es de este host, pero `origin` conserva la
  procedencia real.
- `capturedBy` = versión del plugin; `user` = `USERNAME` del proceso en el momento de la captura.

---

## 5. Cómo se corta una sesión (chunks)

1. Se escanea el log **estructuralmente, sin descomprimir**: se recorre el contenedor Zstandard (RFC 8878) y se
   localiza el final del último frame **completo**. La cola rota (un `append` interrumpido) se ignora, no se
   corrige en disco.
2. Se corta **sólo en límites de frame**. Un frame nunca se parte: si un frame mide más que el límite, el chunk
   lo contiene entero.
3. Límites: `maxChunkBytes = 1 MiB` y `MAX_CHUNK_FRAMES = 512` por chunk.
4. Se parte desde lo ya publicado: `byteFrom`/`frameFrom` son acumulados, no relativos.
5. Por cada chunk se registran:
   - `seq`: 1, 2, 3… por sesión, sin huecos;
   - `byteFrom`, `byteTo`: **offset dentro del log final**;
   - `frameFrom`, `frameTo`: índice de frames dentro del log final;
   - `plainSha256`: hash del trozo en claro;
   - `prefixSha256`: hash de **todo** el log antes del trozo;
   - `endSha256`: hash de todo el log **incluyendo** el trozo;
   - `cipherSha256`, `cipherBytes`: sobre sellado.

La cadena `prefixSha256`/`endSha256` es lo que hace que el trazado sea verificable por sí mismo: el
`prefixSha256` del chunk *n+1* debe ser igual al `endSha256` del chunk *n*, y el `endSha256` del último chunk
es el hash del archivo completo.

---

## 6. Tabla de trazado: cada elemento, su origen y su regla de vuelta

| Elemento en la bóveda | Se reconoce por | Origen exacto | Destino |
|---|---|---|---|
| `objects\<id>.bin` — chunk | descriptor en `sessions[<sid>].chunks[seq]` | `sessionsRoot\<projectKey(cwd)>\<sid>\session.v<N>.jsonl.zstd`, bytes `[byteFrom, byteTo)` | mismo archivo, mismo offset; concatenar por `seq` |
| `objects\<id>.bin` — adjunto | `attachments[<sha256>]` | `attachmentsRoot\v1\objects\<h[0:2]>\<h>` | mismo path (se deriva del hash) |
| `objects\<id>.bin` — manifiesto | puntero de `meta.manifest` o de `devices\*.json`, y `prev` | no se restituye | — (es el índice) |
| `devices\<deviceId>.json` | nombre = deviceId | no se restituye | — (es el índice) |
| `meta.json` | raíz | no se restituye | — (es el índice) |

**Ficha de trazado** de un elemento cualquiera, con los campos que hay que poder leer:

```text
objeto       03e4fcc9cc50148132485df75df51e9d.bin
clase        chunk de sesión
índice       manifiesto seq 1 → sessions["session-11111111-…"].chunks[seq=1]
posición     log bytes [0, 174) · frames [0, 1)
hashes       plain 07d4d1d4…6dec · end 07d4d1d4…6dec · cifrado 5a5bc892…
destino      <home>\sessions\--C-Users-<usuario>-Documents-demo-workspace--\
             session-11111111-2222-3333-4444-555555555555\session.v4.jsonl.zstd
modo         escribir en el offset 0; el archivo se completa concatenando seq 1..4
```

---

## 7. Receta de restitución (sólo leyendo la bóveda)

```text
ENTRADA: <store>, frase, <home> destino

1. meta = leer <store>\meta.json
   clave = scrypt(NFKC(frase), base64(salt), N, r, p, 32)
   comprobar clave con meta.keyCheck      (falla → "wrong passphrase")

2. cabezas = [meta.manifest] + [d.head for d in <store>\devices\*.json]
   para cada cabeza:
       puntero = cabeza
       mientras puntero:
           doc = abrir(objeto(puntero.id))     verificar sha256 == puntero.cipherSha256
           si doc ya visto por id: cortar      (cadenas que comparten prefijo)
           acumular doc ; puntero = doc.prev

3. para cada doc (sin importar el orden entre dispositivos), para cada sid en doc.sessions:
       si algún doc más nuevo declara reset[sid]: ignorar descriptores de docs viejos
       acumular chunks[sid] sin duplicar por seq (el primero visto es el vigente)

4. para cada sesión:
       ordenar chunks por seq ; expected = 1 ; bytes = 0 ; frames = 0 ; hash = sha256("")
       para cada chunk:
           exigir chunk.seq == expected
           exigir chunk.byteFrom == bytes  y  chunk.frameFrom == frames
           exigir hash.hex() == chunk.prefixSha256
           trozo = abrir(objeto(chunk.objectId))          verificar sha256 == chunk.cipherSha256
           exigir sha256(trozo) == chunk.plainSha256
           hash.update(trozo) ; exigir hash.hex() == chunk.endSha256
           bytes = chunk.byteTo ; frames = chunk.frameTo ; expected += 1
       log = concatenar(trozos) ; exigir len(log) == bytes

       destino = <home>\sessions\<projectKey(header.cwd)>\<sid>\session.v<formatVersion>.jsonl.zstd
       escribir sólo si no existe un archivo distinto (nunca sobrescribir)

5. para cada hash H en doc.attachments (el primero gana):
       bytes = abrir(objeto(entry.objectId))              verificar sha256 == entry.cipherSha256
       exigir sha256(bytes) == H  y  len(bytes) == entry.bytes
       destino = <home>\attachments\v1\objects\<H[0:2]>\<H>
       escribir si no está; si está y difiere, conflicto (no se sobrescribe)

6. los documentos con doc.archived se verifican igual pero NO se escriben en <home>.
```

La única función que no es obvia es `projectKey`, idéntica en el host y en el keeper:

```js
function projectKey(cwd) {
  let readable = '', separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i), ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') { if (!separatorRun) readable += '-'; separatorRun = true }
    else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) { readable += ch; separatorRun = false }
    else { readable += '~' + code.toString(16).toUpperCase().padStart(4, '0'); separatorRun = false }
  }
  return '--' + ((readable.replace(/^-+/, '') || 'root').slice(0, 251)) + '--'
}
```

Casos límite: `cwd` nulo → carpeta `_no-cwd`. La normalización es con pérdida: dos `cwd` distintos pueden caer
en la misma carpeta; el `sessionId` es lo que las separa. Si el `cwd` de origen no existe en el host destino
(otra máquina, otra letra de unidad), **el trazado sigue diciendo la verdad**: restituye la conversación en la
ruta que le corresponde por su origen, y esa carpeta puede no existir todavía.

---

## 8. Ejemplo verificado de punta a punta

Entrada del laboratorio:

| Origen | Ruta | Tamaño | Hash |
|---|---|---|---|
| log de sesión | `…\home\sessions\--C-Users-<usuario>-Documents-demo-workspace--\session-1111…\session.v4.jsonl.zstd` | 481 B, 4 frames | `ce49586fbda5eefdee5ad8b27f9e9cd6e4118374685fee3b5f6616afdb482534` |
| adjunto | `…\home\attachments\v1\objects\8c\8cc13f71…651d` | 900 B | `8cc13f7179855150d2e426ea5c913c3d5930c955512b2888f0e23830c1f1651d` |

Lo que produjo el `snapshot` (con `maxChunkBytes` bajo, para forzar el corte):

| Chunk | Objeto | bytes | posiciones | `plainSha256` (inicio) |
|---|---|---|---|---|
| 1 | `03e4fcc9…1e9d` | 206 | log `[0,174)` · frames `[0,1)` | `07d4d1d4…` |
| 2 | `dd8d35df…d1d8` | 185 | log `[174,327)` · frames `[1,2)` | `616081a2…` |
| 3 | `a078ace6…9127` | 118 | log `[327,413)` · frames `[2,3)` | `40292c39…` |
| 4 | `d176abff…760c` | 100 | log `[413,481)` · frames `[3,4)` | `718aa182…` |
| adjunto | `46cd2640…38e7` | 932 | 900 B en claro | `8cc13f71…` |
| manifiesto | `e69b3a65…6230` | 2712 | — | — |

Comprobaciones ejecutadas:

```text
concatenar(chunk1..4) == log original            true
sha256(log restituido) == ce49586f…2534          true
log restituido byte a byte == log original       true
adjunto restituido byte a byte == adjunto         true
ruta restituida == projectKey(cwd)/sessionId/session.v4.jsonl.zstd   true
```

El `endSha256` del último chunk coincide con el hash del archivo completo: por eso el trazado cierra sin
necesidad de una tabla externa.

---

## 9. Perturbaciones que el trazado tiene que sobrevivir

| Situación | Qué pasa en la bóveda | Efecto en el trazado |
|---|---|---|
| **capturas sucesivas** | cada `snapshot` agrega un manifiesto con chunks nuevos (`seq` creciente) | el destino no cambia; se escribe en `byteFrom` y se extiende |
| **importación** (`import`) | los chunks se **vuelven a sellar** (ids nuevos); si el texto del chunk ya existe, se reutiliza el objeto (`plainSha256` como clave) | intacto: el trazado usa posiciones y hashes, no ids |
| **compactación** (`compact`) | un `checkpoint` con **todos** los descriptores acumulados, `prev: null`, `kind`, `covers` | intacto: mismos cortes, mismas posiciones |
| **`gc`** | borra objetos que ninguna cadena referencia (manifiestos viejos) | intacto mientras el checkpoint los cubra |
| **divergencia** | la continuación perdedora va a `archived[<sid>@<dev8>]` | se verifica pero **no se restituye**: es historia conservada, no estado |
| **`reset`** | marca que ese manifiesto reemplaza el linaje de la sesión | hay que ignorar descriptores anteriores para esa sesión |
| **cola rota** | nunca se publica: sólo frames completos | el destino queda con el último prefijo confirmado |
| **log local divergió** | el escritor se niega (`DIVERGED`, `LOCAL_BEHIND`) | no se agrega trazado falso |
| **cuarentena de secretos** | la sesión entera no se publica (`QUARANTINED`) | no hay elemento, y por tanto no hay trazado |
| **frase equivocada** | `wrong passphrase` antes de leer | no se puede ni empezar |

---

## 10. Lo que el trazado no puede devolver

Porque nunca entró en la bóveda:

- la **agrupación y el orden** de los workspaces (`storages\workspace.json`);
- la **caché de proyección** (`storages\session_projcache\`), que se reconstruye al abrir la sesión;
- el **archivado y el pin**;
- los **títulos** generados por el modelo (se regeneran o se pierden según el host);
- las **credenciales** y los perfiles.

Y una advertencia que no es del formato sino del destino: restituir en otra máquina deja las conversaciones con
el `cwd` de la máquina de origen. DSH las listará, pero agrupadas en *Ungrouped* salvo que ese workspace se
registre en el host nuevo.

---

## 11. Cómo se comprueba un trazado

`keeper verify` recorre exactamente el algoritmo de §7 y falla cerrado con estos códigos:

| Código | Significa |
|---|---|
| `SEQ_GAP` | falta un número de chunk |
| `BYTE_GAP` | `byteFrom` no coincide con lo reconstruido |
| `FRAME_GAP` | `frameFrom` no coincide con los frames reconstruidos |
| `PREFIX_MISMATCH` | el chunk no enlaza con la historia anterior |
| `PLAINTEXT_MISMATCH` | lo descifrado no hashea a `plainSha256` |
| `END_MISMATCH` | el hash acumulado no cierra |
| `LENGTH_MISMATCH` | lo reconstruido no mide lo que dice el manifiesto |
| `HEADER_MISMATCH` / `HEADER_INVALID` | el log no empieza con el header de la sesión |
| `MISSING_OBJECT` / `HASH_MISMATCH` | falta el objeto o no coincide con su hash |
| `CHAIN_FAILED` | la cadena de manifiestos no se puede recorrer o descifrar |

`keeper conform` agrega la prueba de contrato: que un lector pueda abrir la bóveda, que restituya **todas** las
sesiones byte por byte, y que rechace una frase equivocada.

---

## 12. Anexo: mapa rápido

Para cualquier bóveda, sin abrir el resto del documento:

```text
por cada sessions[<sid>] en el conjunto de manifiestos:
    archivo  = <home>\sessions\<projectKey(header.cwd)>\<sid>\session.v<formatVersion>.jsonl.zstd
    contenido= concat(abrir(chunk.objectId) ordenados por seq)
    offsets  = byteFrom/byteTo de cada chunk

por cada attachments[<h>] en el conjunto de manifiestos:
    archivo  = <home>\attachments\v1\objects\<h[0:2]>\<h>
    contenido= abrir(entry.objectId)

los archived[<k>] se verifican y no se escriben.
meta.json, manifiestos y devices\*.json son índice, no contenido.
```
