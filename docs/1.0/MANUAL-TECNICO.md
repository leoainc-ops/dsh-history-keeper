# Manual técnico

Para quien va a operar, auditar o extender el keeper: entornos, host, módulos, formato, cifrado y
los detalles que hacen que la promesa se sostenga. El manual para usuarios no técnicos es
[MANUAL-GENERAL.md](MANUAL-GENERAL.md).

## 1. Alcance y requisitos

| Requisito | Valor |
|---|---|
| Node.js | `^22.19.0 || >=24.0.0` (el runtime que trae DSH sirve) |
| Host | DeepSeek Harness `>=0.1.0-rc.6 <0.3.0` (declarado en `engines.dsh`; el host rechaza el bundle si no cumple) |
| Dependencias de ejecución | **ninguna** (`node:` puro; CI falla si aparece una) |
| Plataforma | Windows, Linux y macOS (CI corre en matriz; el desarrollo se hizo en Windows) |
| Formato | `store/1`, lector mínimo declarado en `meta.minReader` |

Archivos del paquete: `lib/`, `bin/`, `scripts/`, `cordis.patch.yml`, `docs/`, `SECURITY.md`,
licencias y README. Los tests y `conformance/` **no** se publican.

## 2. Arquitectura

```text
DSH (host)
  └── plugin (lib/plugin.js)              monta /keeper, captura en session/flush
        └── snapshot → chunk → crypto → store        (escribe la bóveda)
              └── compact → gc                        (mantiene espacio)

CLI (bin/keeper.js)                       el operador, con DSH cerrado para escribir
  ├── store      apertura, meta, lock, CAS, heads
  ├── verify     cadena + objetos + frames
  ├── export/import/merge   transporte
  ├── extract/render        texto plano
  ├── conform/doctor        diagnóstico
  └── upgrade/handshake     versionado
```

La bóveda **no depende del host para leerse**: cualquier implementación que cumpla `store/1` la abre.
El host sólo decide qué bytes hay para capturar.

## 3. Módulos (`lib/`)

| Módulo | Responsabilidad |
|---|---|
| `store.js` | abrir/crear la bóveda, `meta.json`, objetos sellados, manifiestos, cabezas por equipo, lock, CAS (`expectHead`), `atomicWrite` |
| `crypto.js` | scrypt, `seal`/`open`, `keyCheck`; AEAD `aes-256-gcm` (también acepta `chacha20-poly1305`) |
| `chunk.js` | troceo alineado a frames, 1 MiB por defecto, hashes de prefijo y de final |
| `frames.js` / `payload.js` | lectura de frames zstd y decodificación del log |
| `session-log.js` | encabezado del log, nombres de archivo seguros para restaurar |
| `snapshot.js` | captura: plan, dedupe por `plainSha256`, sellado, manifiesto |
| `verify.js` | unión de la cadena, dedupe por `seq`, `reset`, reconstrucción y códigos |
| `compact.js` | checkpoint, `covers`, reclamo automático, `gc` |
| `policy.js` | cuándo compactar (manifiestos desde el último checkpoint) |
| `merge.js` | `surveySource`, `resolveSession`, merge append-only, archivado de divergencias |
| `export.js` / `import.js` | transporte, guardas de destino, recibo, `downlevel` |
| `restore.js` | escribe en `sessions/` sin sobrescribir |
| `autoimport.js` / `journal.js` | buzón, import al arrancar, diario de deshacer |
| `handshake.js` / `upgrade.js` | `writer`/`minReader`, actualización de bóvedas viejas |
| `catalog.js` / `inventory.js` / `origins.js` | catálogo derivado, agrupación por equipo, procedencia |
| `extract.js` / `render.js` / `secrets.js` | extracción legible/JSONL/raw y gate de secretos |
| `hostguard.js` | marcador del host y negativa de escrituras de CLI |
| `doctor.js` / `conform.js` | recursos y conformidad |
| `compat.js` | vocabulario de eventos del host (¿puede leer esta sesión?) |
| `config.js` / `paths.js` / `device.js` / `util.js` / `version.js` | configuración, rutas canónicas, identidad, utilidades |

## 4. Layout en disco

| Ruta | Contenido |
|---|---|
| `<home>/history-keeper/meta.json` | **sin cifrar**: formato, `storeId`, `aead`, `kdf`, `keyCheck`, device, `manifest`, `snapshots`, `retention`, `writer`, `minReader`, `upgrades` |
| `.../objects/<id>.bin` | objeto sellado (`id` aleatorio, contenido direccionado por hash en los descriptores) |
| `.../devices/<deviceId>.json` | cabeza de ese equipo: `{deviceId, deviceName, head{id,cipherSha256}, seq, updatedAt}` |
| `.../LOCK` | presente sólo mientras un escritor trabaja; contiene el PID |
| `<home>/history-keeper.key` | frase generada (si no usás `passphraseFile`) |
| `<home>/history-keeper-device.json` | identidad de esta máquina |
| `<home>/history-keeper-origins.json` | de dónde vino cada sesión importada |
| `<home>/history-keeper.incoming` | buzón de importación |
| `<home>/history-keeper.journal.json` | diario de deshacer |
| `<home>/history-keeper-host.json` | marcador del host (`pid`, `updatedAt`, `store`) |
| `<home>/sessions/` | árbol del host; el keeper **sólo** escribe acá en `restore` |
| `<home>/attachments/` | blobs del host |

`keeper paths` imprime esta lista para el home actual.

## 5. Formato `store/1`

### 5.1 Objeto sellado

```text
" D K O 1 " | nonce(12) | ciphertext(n) | tag(16)
```

AEAD `aes-256-gcm`. La clave son 32 bytes derivados con scrypt. El objeto no guarda su propio hash:
el descriptor del manifiesto guarda `cipherSha256` y `plainSha256`, y el lector comprueba ambos.

### 5.2 Descriptor de chunk

| Campo | Significado |
|---|---|
| `seq` | posición en el linaje (1..N), contigua |
| `objectId` | nombre del archivo en `objects/` |
| `cipherSha256` / `cipherBytes` | hash y tamaño del objeto sellado |
| `plainSha256` | hash del texto plano: **la clave del dedupe** |
| `prefixSha256` | hash de todos los bytes anteriores (prueba de continuidad) |
| `endSha256` | hash incluyendo este chunk (prueba de final) |
| `frameFrom` / `frameTo` | rango de frames del log |
| `byteFrom` / `byteTo` | rango de bytes del log |
| `createdAt` | cuándo se capturó |

El troceo es **alineado a frames** (1 MiB por defecto, `DEFAULT_MAX_CHUNK_BYTES`): un chunk nunca
parte un frame, y una cola incompleta no se publica.

### 5.3 Manifiesto

```json
{
  "format": "dsh-history-keeper/manifest/1",
  "seq": 42,
  "createdAt": "…",
  "deviceId": "…",
  "prev": { "id": "…", "cipherSha256": "…" },
  "sessions": { "<sessionId>": { "formatVersion": 4, "header": {…}, "chunks": [ … ], "origin": {…}, "capturedBy": "1.0.1", "user": "…" } },
  "archived": { "<sessionId>@<device8>": { "sessionId": "…", "chunks": [ … ] } },
  "attachments": { "<hash>": { "objectId": "…", "bytes": 1234 } },
  "reset": { "<sessionId>": true },
  "kind": "checkpoint",
  "covers": 41
}
```

Todos los campos salvo `format`, `seq`, `deviceId` y `sessions` son **aditivos**: un lector que no
los conoce los ignora.

### 5.4 Cadena y lectura

- La cadena se recorre **de nuevo a viejo** desde la cabeza de cada equipo.
- Para cada `(sessionId, seq)` gana el **primer** descriptor encontrado (el más nuevo).
- `reset[sessionId] = true` hace que los manifiestos más viejos **no aporten** a esa sesión.
- Un checkpoint declara `covers`: cuántos manifiestos reemplaza; la cadena vieja sigue siendo
  alcanzable para auditar.
- `verify` reconstruye cada sesión concatenando chunks y comprobando `seq` contiguo, `byteFrom ==
  byteTo` anterior, `prefixSha256`/`endSha256` y los hashes de cada objeto.

## 6. Cifrado y claves

| Pieza | Valor |
|---|---|
| KDF | scrypt: `N = 32768` (1<<15), `r = 8`, `p = 1`, `keyLen = 32`, sal aleatoria por bóveda en `meta.kdf.salt` (base64) |
| AEAD | `aes-256-gcm`, nonce de 12 bytes por objeto, tag de 16 |
| `keyCheck` | un objeto sellado del texto `dsh-history-keeper/key-check/v1`; permite decir “frase incorrecta” sin descifrar la bóveda |
| `keyFingerprint` (recibo) | `sha256(frase).slice(0,16)` en hexadecimal |

**Qué no se cifra**: `meta.json`. Se ven `storeId`, `deviceName`, cantidad de manifiestos, política
de retención y versiones. **No** se ven nombres de proyectos, títulos ni contenido.

**Fuerza de la frase**: con 12 caracteres del patrón `AAAA##999999` ronda 39 bits; scrypt multiplica
el costo por intento, pero es el eslabón más débil. Recomendado: 5-6 palabras (80-100 bits).

**El recibo** lleva una huella de la frase para que la otra máquina confirme que tiene la correcta.
Es un `sha256` truncado: quien robe el pendrive puede atacar **esa huella** mucho más rápido que la
bóveda (scrypt). Si eso importa, no viajes con recibos.

## 7. El log del host

- Contenedor: frames **zstd independientes**; el lector los descomprime en orden.
- Encabezado: `{type:"session", version:4, id, cwd, createdAt, isSeeded}`.
- Eventos: `{type, seq, time, data}`; algunos llegan agrupados en `{type:"batch", rows:[…]}`.
- Campos que importan: `seq` (contiguo y creciente), `time` (epoch ms), `surfaceOp` (`append`),
  `sourceEventSeqs` (referencias a eventos anteriores), `shadowedSeqs` (compactación del host).
- Tipos frecuentes: `turn/start|end`, `step/start|end`, `user/message`, `assistant/message`,
  `tool/call|result`, `session/title`, `system/message`.
- **Nunca se sintetiza un log.** El keeper copia bytes; reconstruir o fusionar eventos fue el error
  que costó rc.24–rc.30 (ver `docs/LESSONS.md`).
- Una cola incompleta no se publica: se captura cuando el host termina el frame.

## 8. Captura (`snapshot`)

1. Bajo `LOCK`, lee la cadena y el estado publicado; calcula `expectHead`.
2. Para cada sesión: bytes nuevos desde el último `byteTo`; trocea alineado a frames.
3. Dedupe: si el `plainSha256` ya está en la cadena, **reutiliza el objeto**.
4. Sella lo nuevo (`putObject`), escribe un manifiesto con `prev` y `expectHead`.
5. Verifica el resultado; si algo no cuadra, restaura la cabeza y falla.

Disparadores en el host: `session/flush` (con debounce 2 s) y `session/disposed`; throttle mínimo
30 s entre capturas automáticas (`snapshotMinIntervalMs`). Política de compactación: cada 50
manifiestos desde el último checkpoint (`retention.compactAfterManifests`), seguida de reclamo
automático (`retention.autoGc`).

## 9. Compactación y reclamo

- `compact` escribe **un** checkpoint con todos los descriptores vigentes, `prev: null` y `covers`.
- `gc` borra objetos que **ninguna cabeza** referencia. Cuenta también los de `archived`: una
  continuación archivada es historia, no basura.
- Invariante permanente: `bytes(bóveda) ≤ 1,1 × bytes(sesiones únicas)`. Medido en la bóveda real:
  **16,91 MB / 15,97 MB = 1,059**.
- `keeper doctor` informa objetos totales vs referenciados, bytes recuperables, manifiestos desde el
  checkpoint y restos en el home.

## 10. Transporte

```text
export: verifica → comprueba espacio → guarda destino (¿tiene sesiones que no tengo?) →
        copia → verifica la copia → escribe carry-<sello>.json
import: verifica la externa → resolveSession → append-only (sólo bytes que faltan) →
        verifica → restore (sin sobrescribir) → diario
```

| Guarda | Comportamiento |
|---|---|
| Destino con sesiones que la local no tiene | **se niega**; `--replace` para forzar |
| Destino que no abre con la frase | **se niega** (podría ser otra bóveda) |
| Sesión idéntica | **se saltea** (no escribe nada) |
| Sesión más corta en la externa | **se saltea** (la historia no encoge) |
| Divergencia | gana el linaje del dueño; el otro se **archiva** con clave `<id>@<device8>` |
| Fallo del merge | restaura cabeza y `meta.json`, aparta el buzón como `.failed-<sello>` |
| Import exitoso | **borra** el buzón (`--keep-staged` lo conserva) |

El diario (`history-keeper.journal.json`) registra los **archivos de sesión creados** y vence a los
7 días o con el primer export. `import --undo` borra sólo esos archivos, y nunca fuera de
`sessions/`.

## 11. Concurrencia

| Mecanismo | Regla |
|---|---|
| `LOCK` | archivo con el PID; un lock viejo **sólo** se rompe si el proceso dueño ya no existe |
| CAS | un escritor declara `expectHead`; si la cabeza cambió, `HEAD_MOVED` y no escribe |
| Marcador de host | el plugin lo escribe al montar y lo refresca en cada captura |
| Guardia de CLI | `snapshot`, `compact`, `gc --yes`, `import`, `restore`, `upgrade` se niegan con DSH abierto (`--allow-host-open` es la excepción explícita) |

## 12. Códigos

| Código | Significado |
|---|---|
| `HASH_MISMATCH` | un objeto no coincide con el hash registrado |
| `MISSING_OBJECT` | falta un objeto referenciado |
| `SEQ_GAP` / `BYTE_GAP` / `FRAME_GAP` | la cadena no es contigua |
| `PREFIX_MISMATCH` / `END_MISMATCH` | los hashes de continuidad/cierre no cierran |
| `BAD_FORMAT` / `FORMAT_TOO_NEW` | formato desconocido o más nuevo que este lector |
| `HEAD_MOVED` | otro escritor avanzó la cabeza mientras preparabas la escritura |
| `STORE_BUSY` | el lock está tomado por un proceso vivo |
| `QUARANTINED` | la sesión no se publicó por el gate de secretos |
| `DIVERGED` | dos linajes de la misma sesión |
| `ATTACHMENT_*` | adjunto faltante, con hash o longitud distinta |
| `NO_COMPLETE_FRAMES` | no hay un frame entero para publicar |
| `PLUGIN_OUTDATED` / `WRITER_NEWER` | avisos de handshake (no bloquean) |

## 13. Compatibilidad y extensiones

- **Aditivas**: un campo nuevo es opcional; un lector viejo lo ignora; un escritor no borra lo que no
  entiende.
- **Con espacio de nombres**: `x-<vendor>-<nombre>` o anidado en `ext: { "<vendor>": {…} }`.
- **Cambio incompatible** = versión mayor del formato (`store/2`) declarada en `minReader.format`.
- Un lector que no conoce una versión mayor **se niega** (`FORMAT_TOO_NEW`).
- Un lector viejo **no puede ver** el handshake: por eso existe `export --downlevel <versión>`.
- Matriz probada y sus límites: `docs/COMPATIBILITY.md` (rc.38 lee y restaura byte por byte una
  bóveda de 1.0; el eje de la segunda versión de DSH no se cubrió).

## 14. Conformidad

`conformance/` contiene una bóveda de referencia y un ejecutor con **siete categorías** de
comprobación:

1. abre con la frase de prueba y declara el formato esperado;
2. `verify` da ok y ve todas las sesiones;
3. restaura cada sesión **byte por byte** (hash por sesión);
4. detecta un objeto alterado;
5. rechaza una frase incorrecta;
6. el catálogo lista cada sesión **con su hash**;
7. rechaza un formato mayor con código (`FORMAT_TOO_NEW`).

`npm run conformance` corre eso en CI. `keeper conform --store <dir>` aplica los mismos controles a
**cualquier** bóveda (incluye restaurar en un home temporal y comparar bytes) y sale con código 1 si
no conforma. Una implementación de terceros se certifica pasando el kit.

## 15. Desarrollo

```bash
npm test              # 170 casos, node --test
npm run guard         # falla si hay sesiones reales versionadas
npm run conformance   # el kit de certificación
```

CI (`.github/workflows/ci.yml`): sin dependencias de ejecución, tests, guard, conformidad, matriz de
SO. Versiones: `SemVer`; el `latest` de npm es siempre la línea estable; las retiradas se marcan con
`npm deprecate` y se listan en `docs/HISTORY.md`. Cada release lleva tag (`v1.0.0`, `v1.0.1`) y su
entrada en el CHANGELOG.

## 16. Espacio y rendimiento

| Medida real (2026-11-09) | Valor |
|---|---|
| Sesiones / frames | 11 / 11.486 |
| Bytes de sesiones únicas | 15,97 MB |
| Bóveda | 16,91 MB (ratio **1,059**) |
| Objetos / manifiestos | ~1.126 referenciados; compactado a 1 checkpoint |
| Adjuntos | 10 blobs, 619 KB |

Cada captura añade un objeto por MiB nuevo y un manifiesto chico; la compactación reemplaza la cadena
y el reclamo borra lo reemplazado. El costo de verificación es lineal en los objetos.

## 17. Seguridad

**Modelo de amenaza**: protege el historial frente a pérdida, corrupción y transporte entre máquinas.
Asume que la máquina donde corre DSH está bajo tu control.

| Riesgo | Mitigación | Límite |
|---|---|---|
| Robo de la bóveda | AES-256-GCM + scrypt | depende de la frase |
| Robo del pendrive con la frase | la frase no viaja | si la llevás, borrala |
| Huella del recibo | no incluye la frase | es un hash truncado: acelera el ataque offline |
| Extracción en claro | comando explícito, gate de secretos, sin sobrescribir, fuera de la bóveda | el archivo resultante es legible |
| Corrupción | hashes por objeto, cadena, `verify` falla cerrado | no repara: hay que restaurar de una copia |
| Frase olvidada | no hay recuperación | irreversible |

## 18. Glosario técnico

| Término | Definición |
|---|---|
| **bóveda / store** | el directorio con `meta.json`, `objects/` y `devices/` |
| **objeto** | un blob sellado, direccionado por hash |
| **manifiesto** | un documento sellado que describe sesiones y apunta al anterior |
| **cabeza (head)** | el manifiesto más nuevo de un equipo; es lo que hace alcanzable la cadena |
| **checkpoint** | manifiesto que reemplaza la cadena anterior y declara `covers` |
| **linaje** | la lista de descriptores que reconstruye una sesión |
| **CAS** | compare-and-swap sobre la cabeza |
| **buzón** | `history-keeper.incoming`, punto de entrada para el import al arrancar |
| **diario** | registro de lo que un import mostró, con su ventana de deshacer |
| **downlevel** | copia declarada legible por una versión anterior |
| **conformidad** | pasar el kit `conformance/` sobre una bóveda |
