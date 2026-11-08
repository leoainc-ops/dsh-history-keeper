# SPEC de la bóveda — contrato `store/1`

Este documento es **el contrato**. Todo lo demás —CLI, plugin, lanzadores, filosofías— es una
superficie sobre este formato. Dos implementaciones distintas son compatibles si y sólo si cumplen
lo que está acá y pasan `conformance/`.

Regla de oro: **la bóveda guarda bytes que escribió el host.** No los interpreta, no los recompone,
no los inventa. Cualquier función que necesite "entender" una sesión queda fuera de este contrato.

## 1. Disposición

```text
<vault>/
  meta.json                 identidad, cifrado y puntero de cadena
  objects/<id>.bin          objetos sellados (uno por chunk, manifiesto o adjunto)
  devices/<deviceId>.json   cabeza de cadena por dispositivo
  LOCK                      presente sólo mientras un escritor trabaja
```

## 2. `meta.json`

| Campo | Tipo | Regla |
|---|---|---|
| `format` | string | **`dsh-history-keeper/store/1`**. Otro valor ⇒ el lector se niega (`BAD_FORMAT`) |
| `storeId` | hex 32 | identidad de la bóveda; se genera una vez y no cambia |
| `createdAt` | ISO 8601 | informativo |
| `aead` | string | `aes-256-gcm` (único soportado; el que existe en todos los runtimes) |
| `kdf` | objeto | `{ alg: 'scrypt', N, r, p, keyLen, salt }`; `salt` en base64 |
| `keyCheck` | objeto | `{ nonce, ciphertext }`: frase correcta ⇒ descifra; incorrecta ⇒ falla cerrado |
| `deviceId` / `deviceName` | string | dispositivo que **creó** la bóveda (informativo, no es el dueño de cada sesión) |
| `manifest` | objeto | `{ id, cipherSha256 }`: puntero **legacy** a la cabeza; se conserva por compatibilidad |
| `snapshots` | número | contador legacy; informativo |
| `retention` | objeto | opcional, aditivo: `{ autoGc, compactAfterManifests, keepReplacedCopies }`. Política de espacio que viaja con la bóveda; si falta, el lector usa sus valores por defecto |

Los metadatos sensibles no quedan en claro: `keyCheck` y los objetos están cifrados; el resto son
identificadores aleatorios.

## 3. Cripto

1. Clave = `scrypt(passphrase, salt, N, r, p, keyLen=32)`.
2. Cada objeto se sella con **AES-256-GCM** y `nonce` aleatorio de 12 bytes: `nonce || ciphertext`.
3. `objectId` = 32 caracteres hexadecimales aleatorios. El nombre del archivo es `<objectId>.bin`.
4. `cipherSha256` = SHA-256 de los bytes del archivo sellado. El lector **verifica** ese hash al
   abrir el objeto: un byte alterado se detecta.
5. La frase **nunca** se guarda en la bóveda; sólo su `keyCheck`.

## 4. Chunks

Un chunk es un tramo de bytes de un archivo de sesión, alineado a los frames del log del host.

```json
{ "seq": 1, "objectId": "…", "cipherSha256": "…", "cipherBytes": 1234,
  "plainSha256": "…", "prefixSha256": "…", "endSha256": "…",
  "frameFrom": 0, "frameTo": 12, "byteFrom": 0, "byteTo": 65536, "createdAt": "…" }
```

Invariantes, en orden creciente de `seq` desde **1**:

- `byteFrom` = `byteTo` del chunk anterior (el primero empieza en 0);
- `frameFrom` = `frameTo` del anterior (el primero empieza en 0);
- `prefixSha256` = SHA-256 de **todo** el plaintext anterior a este chunk;
- `endSha256` = SHA-256 de todo el plaintext hasta el final de este chunk;
- `plainSha256` = SHA-256 del payload de este chunk;
- `byteTo ≥ byteFrom`, `frameTo ≥ frameFrom`.

Con eso, la cadena de hashes es una prueba de que el historial no se alteró ni se reordenó.

## 5. Manifiestos

Cada manifiesto es un documento JSON, sellado como objeto. Su referencia es `{ id, cipherSha256 }`.

| Campo | Regla |
|---|---|
| `format` | `dsh-history-keeper/manifest/1` |
| `seq` | número de manifiesto de ese dispositivo |
| `createdAt` | ISO 8601 |
| `deviceId` | quién lo escribió |
| `prev` | `{ id, cipherSha256 }` del manifiesto anterior, o `null` si inicia cadena |
| `sessions` | mapa `sessionId → { formatVersion, header, chunks[], origin? }` |
| `attachments` | opcional: mapa `sha256 → { objectId, cipherSha256, cipherBytes, bytes, createdAt }` |
| `archived` | opcional: continuaciones conservadas; clave `<sessionId>@<deviceId>`, con `sessionId` dentro |
| `reset` | opcional: `sessionId → true`; los manifiestos más viejos **no aportan** chunks a esa sesión |
| `kind`, `covers` | opcional, informativo (checkpoint, merged) |

**Lectura de la cadena (unión):**

1. Se parte de la cabeza legacy (`meta.manifest`) y de todas las cabezas de `devices/`.
2. Se recorre `prev` hacia atrás, sin repetir manifiestos; cada eslabón se verifica contra su
   `cipherSha256`.
3. Se recorre **de nuevo a viejo**: para cada `(sessionId, seq)` **gana el descriptor más nuevo**
   (el primero que se encuentra).
4. Un manifiesto con `reset[sessionId]` descarta lo que los más viejos hayan aportado a esa sesión.

## 6. Sesiones

- `formatVersion` y `header` son los del log del host (hoy `version: 4`).
- Los bytes se guardan **verbatim**: el archivo completo del host, tal como lo escribió.
- El contenido no se interpreta. Ni el keeper ni sus políticas pueden sintetizar, reordenar o
  reescribir un log de sesión.

## 7. Adjuntos

- Direccionados por contenido: la clave es el SHA-256 del plaintext.
- Un adjunto se guarda una vez; `bytes` es su tamaño en claro.
- Nunca se sobrescribe un objeto existente.

## 8. Escritura

- Toda escritura ocurre con `LOCK` tomado (archivo creado con `wx`, que contiene el PID).
- Un `LOCK` se rompe **sólo** si su dueño ya no existe, o si supera el límite de antigüedad **y** su
  dueño no existe. Nunca por antigüedad sola.
- La bóveda es **append-only**: no se modifican objetos existentes. Reemplazar o compactar crea
  objetos nuevos y una cadena nueva que los referencia.
- **Compare-and-swap**: un escritor declara la cabeza contra la que preparó su payload; si cambió,
  la escritura se rechaza con `HEAD_MOVED`. Nunca se escribe sobre una vista vieja.
- **Aviso de host**: el plugin deja `history-keeper-host.json` en el home mientras está montado;
  la CLI se niega a escribir con el host abierto (`--allow-host-open` lo saltea a sabiendas).
- El host es el único dueño de `sessions/`. El keeper escribe ahí sólo en `restore`, y nunca
  sobrescribe: aparta lo existente.

## 9. Verificación (lo que `verify` debe comprobar)

1. `meta.format` soportado; `aead` soportado; la frase abre `keyCheck`.
2. Cada manifiesto: objeto presente, `cipherSha256` correcto, `prev` correcto, sin ciclos.
3. Cada chunk: objeto presente, `cipherSha256` correcto, `plainSha256` correcto, `prefixSha256` y
   `endSha256` encadenados, rangos contiguos, `seq` sin huecos.
4. El log reconstruido mide `byteTo` del último chunk y su header declara el `sessionId`.
5. Los adjuntos: hash del plaintext igual a su clave.

Códigos de error usados (estables): `BAD_FORMAT`, `AEAD_UNAVAILABLE`, `OBJECT_MISSING`,
`CIPHERTEXT_MISMATCH`, `PLAINTEXT_MISMATCH`, `PREFIX_MISMATCH`, `END_MISMATCH`, `SEQ_GAP`,
`BYTE_GAP`, `FRAME_GAP`, `HEADER_INVALID`, `HEADER_MISMATCH`, `CHAIN_LOOP`, `STORE_BUSY`,
`HEAD_MOVED`.

`verify` **falla cerrado**: un solo problema ⇒ `ok: false` y el código correspondiente.

`gc` sólo puede borrar objetos que ninguna cabeza alcance, y debe contar **también** los chunks de `archived`: una continuación archivada es historia, no basura.

## 10. Compatibilidad

- **El eje es la versión del formato**, no la del producto. `store/1` es el contrato.
- Campos nuevos: **aditivos**. Un lector debe ignorar los que no conoce; un escritor no debe
  eliminarlos.
- Un lector que encuentra un formato que no conoce **se niega** con `BAD_FORMAT` y un mensaje que
  dice qué hacer.
- Una implementación nueva debe leer bóvedas de cualquier versión anterior del formato.

## 11. Conformidad

`conformance/` contiene una bóveda de referencia y un ejecutor. Una implementación cumple el
contrato si:

1. abre la bóveda de referencia con la frase de prueba;
2. `verify` da ok;
3. restaura las sesiones en un home vacío y los bytes son **idénticos** a los esperados;
4. detecta un objeto alterado (falla cerrado, con código);
5. rechaza una frase incorrecta.

`npm run conformance` corre esos cinco puntos.

## 12. Extensiones

El formato crece por **extensiones aditivas**, nunca por cambios incompatibles:

- Un campo nuevo en `meta`, en un manifiesto o en una entrada de sesión es opcional: un lector que
  no lo conoce lo **ignora**; un escritor no lo borra si no lo entiende.
- Las extensiones de terceros van bajo un **espacio de nombres**: `x-<vendor>-<nombre>` en el nivel
  donde se agreguen, o anidadas en `ext: { "<vendor>": { ... } }`. Nunca se usa un nombre genérico
  que pueda chocar con el formato.
- Un cambio que **rompe** la lectura (reordenar, reinterpretar o eliminar campos existentes) exige
  una versión mayor del formato (`store/2`) y que la bóveda lo declare en `minReader.format`.
- El lector que encuentra una versión mayor que la suya **se niega** con `FORMAT_TOO_NEW`; no
  intenta adivinar.

## 13. Catálogo (derivado, no almacenado)

El catálogo —qué sesiones hay, en qué workspace, con cuántos turnos, desde y hasta cuándo, quién las
capturó y qué continuaciones están archivadas— **no se guarda**: se deriva de la cadena y de los
bytes que escribió el host (`keeper catalog`).

El motivo es el contrato mismo: un índice almacenado sería estado duplicado que puede quedar
desfasado de la cadena, y agregaría una escritura por captura. Derivarlo garantiza que el catálogo
dice exactamente lo que la bóveda tiene.

## 14. Importación automática y deshacer

El host también puede traer una bóveda externa al arrancar: 

- El buzón es **uno solo**: `<home>/history-keeper.incoming`. El plugin no busca discos ni
  pendrives por su cuenta.
- Antes de tocar nada, la bóveda del buzón debe abrir con la frase de esta máquina y **verificar**.
- La importación es la de M2: en el lugar, reutilizando objetos, verificada al final.
- El journal (`<home>/history-keeper.journal.json`) registra **qué archivos de sesión se crearon** y
  hasta cuándo se pueden retirar: 7 días o el primer export. Deshacer quita sólo eso; la historia
  de la bóveda no se borra.
- Una importación fallida nunca impide que el host arranque: se informa y se sigue.

## 15. Actualización de una bóveda anterior

Una bóveda escrita antes del handshake sigue siendo válida: el formato es aditivo. Para que declare
lo que este build sabe, existe `keeper upgrade`:`n
- agrega `writer`, `minReader` y (salvo `--no-retention`) `retention` a `meta.json`;
- registra el cambio en `meta.upgrades` con los valores anteriores;
- **no toca la historia**: ni un objeto, ni un manifiesto, ni una cabeza;
- deja `meta.json.before-upgrade-<sello>` para volver atrás con un archivo;
- se niega si la bóveda pide un formato más nuevo, y no hace nada si ya está al día.

## 16. Fuera del contrato

- Reconstruir o fusionar logs de sesión.
- Interpretar eventos del host (sólo se cuenta frames para los rangos).
- Garantizar que un host viejo lea eventos nuevos: eso lo decide el host, y el keeper lo **detecta**
  (vocabulario) y lo informa.
- Sincronización en vivo entre dos máquinas mientras el host está abierto.
