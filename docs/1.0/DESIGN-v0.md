# Diseño v0 — dsh-history-vault

> Borrador para discusión. Nombre provisional: **dsh-history-vault** (npm libre) o
> `dsh-history-sync` (también libre). Decidir antes de publicar.

---

## 1. Promesa y alcance

**Promesa:** *"Tu historial de DSH vuelve, y podés comprobarlo."*

No "sincronizá tus chats": la promesa es recuperabilidad verificable. El sync es la
consecuencia, no el titular.

| Hito | Contenido | Por qué en ese orden |
|---|---|---|
| **v0.1 (usable ya)** | snapshot + verify + restore. Sin sync en vivo, sin UI | resuelve el caso real: la máquina murió y el historial está en otro lado. Es demostrable en una sesión de trabajo |
| **v1.0 (producto)** | + pull/push en vivo, manifiestos por dispositivo, conflictos, dispositivos y revocación, UI de estado | requiere que v0.1 sea sólido: nadie sincroniza lo que no sabe restaurar |
| **v1.x** | restore points, retención, interop de migración, i18n completa | encima de una base confiable |

**No-objetivos:** edición concurrente de una misma sesión, colaboración en tiempo real, servicio en la nube propio, cuenta de usuario, sincronizar credenciales o perfiles de plugins.

---

## 2. Principios de diseño

1. **Cero dependencias nativas.** Sólo `node:` — sin `git`, sin `age`, sin binarios. Instalación = un paquete npm.
2. **Falla cerrado.** Sin clave no se sincroniza; con conflicto no se escribe; sin interlocutor no se confirma. Nunca "degradar a texto plano".
3. **Nunca sobrescribir, nunca borrar en destino.** El restore sólo crea; si algo existe y difiere, se aparta.
4. **Append-only + hashes.** Todo objeto es inmutable y nombrado por su contenido o por un contador monótono.
5. **Copias por dispositivo, no documento compartido.** Ningún archivo mutable compartido entre máquinas.
6. **Transporte tonto.** La carpeta (o el proveedor) sólo mueve blobs; no interpreta, no ordena, no resuelve.
7. **Auditable por el usuario.** `verify` y un reporte legible; el usuario puede comprobar sin creernos.

---

## 3. Modelo de datos

```text
<store>/
  meta.json                          { format, storeId, createdAt, kdf, alg }
  keys/<keyId>.json                  clave envuelta (nunca la clave en claro)
  devices/<deviceId>.json            { deviceName, publicKey, addedAt, revokedAt? }  firmado
  objects/<sha256>.bin               contenido cifrado + comprimido (zstd), inmutable
  sessions/<sessionId>/<deviceId>/<seq>.json     manifiesto inmutable por dispositivo
  workspaces/<deviceId>/<seq>.json   tabla de workspaces, un archivo por dispositivo y versión
  ckpt/<sessionId>/<seq>.json        restore points
  tombstones/<sessionId>/<seq>.json  borrados explícitos (previstos, no usados en v1.0)
  leases/<sessionId>.json            escritor único opcional, con TTL
```

**Reglas:** nombres inmutables (`seq` monótono o hash), escritura atómica
(`tmp` + `rename` en el mismo directorio, **nunca** hardlink: Google Drive no lo
soporta), y toda lectura re-verificada por hash antes de usarse.

---

## 4. Formato del chunk

```json
{
  "v": 1,
  "sessionId": "…",
  "deviceId": "…",
  "seq": 7,
  "frameFrom": 329, "frameTo": 405,
  "byteFrom": 123456, "byteTo": 130000,
  "formatVersion": 4,
  "objectSha256": "…",
  "plainSha256": "…",
  "prefixSha256": "…",
  "keyId": "…",
  "alg": "aes-256-gcm",
  "createdAt": "2026-10-21T…Z"
}
```

- `objectSha256` = hash del ciphertext: **cualquiera** puede verificar la cadena sin la clave.
- `plainSha256` = hash del texto plano: se verifica **con** la clave, después de descifrar.
- `prefixSha256` = hash de todos los bytes cifrados anteriores de esa sesión: da la cadena
  verificable que ya validamos en la v1 (65/65 chunks).
- `formatVersion` = permite que DSH migre v0→v4 al abrir; nosotros nunca reinterpretamos.

---

## 5. Flujos

```text
SNAPSHOT (dentro de DSH)
  session/flush ─▶ leer bytes confirmados hasta el último frame completo
                ─▶ diff contra el último chunk publicado de (sesión, dispositivo)
                ─▶ cifrar + comprimir ─▶ escribir object ─▶ escribir manifiesto ─▶ heartbeat

VERIFY (CLI o plugin)
  recorrer manifiestos ─▶ objectSha256 existe y coincide ─▶ cadena prefixSha256 enlaza
                       ─▶ (con clave) descifrar y validar plainSha256 ─▶ reporte

RESTORE (máquina nueva o tras desastre)
  store + clave ─▶ verificar ─▶ reconstruir log por sesión ─▶ escribir en
  <home>/sessions/--<projectKey>--/<id>/session.v4.jsonl.zstd (sólo si no existe)
                ─▶ fusionar tabla de workspaces (con respaldo) ─▶ reporte + rollback

PULL / PUSH (v1.0, dentro de DSH)
  pull: manifiestos remotos ─▶ qué me falta ─▶ si mi log es prefijo exacto: append
                                            ─▶ si divergió: NO tocar, reportar fork
  push: mis bytes nuevos ─▶ object + manifiesto (nunca reescribo el de otro)
```

**Bootstrap de dispositivo nuevo** es un flujo propio (como la transferencia de
historial al vincular en WhatsApp/Signal): código de un solo uso, clave, restore
verificado, y recién después sync continuo.

---

## 6. Reglas de conflicto

1. Prefijo exacto → append del sufijo. (Caso normal.)
2. Mismos eventos con frames distintos → re-agrupar sin pérdida, verificando hashes.
3. Divergencia real → **no se toca nada**. Se reporta el evento exacto y hay tres salidas
   explícitas: quedarme con la mía / adoptar la del almacén / conservar ambas (rama con
   `forkOf`). Nunca fusión automática.
4. Importación de una sesión ajena → **réplica de sólo lectura** por defecto; al abrirla en
   escritura se ofrece **promover** (crea rama con `forkOf`).

La tabla de workspaces no es un log: es un documento mutable. Se sincroniza **un archivo
por dispositivo** y el merge es explícito: unión por `path`, último `updatedAt` gana, con
tombstones. Nunca reemplazo del archivo completo (el error que costó la fusión de 5
workspaces).

---

## 7. Componentes

| Componente | Rol | Depende de |
|---|---|---|
| `lib/` | motor puro: chunking por frames, cifrado, cadena, merge, restore | sólo `node:` |
| `plugin/` | rows de Cordis: usa `ctx.sessionPersistence`, escucha `session/flush` y `session/disposed`, comandos `/vault …` | host DSH |
| `client/` | UI: estado, dispositivos, conflictos, ajustes | host DSH (React) |
| `bin/` | CLI: `status`, `verify`, `restore`, `snapshot` — **funciona sin DSH** | `node:` |

La CLI no es un extra: el escenario de desastre implica que DSH no está disponible.
El mismo motor alimenta los tres.

---

## 8. Decisiones abiertas

| # | Decisión | Recomendación | Consecuencia de la alternativa |
|---|---|---|---|
| D1 | Nombre y promesa | `dsh-history-vault`, promesa de recuperabilidad | `-sync` compite de frente con dos rivales y pierde el ángulo |
| D2 | Alcance v1.0 | primero v0.1 (snapshot/verify/restore), después sync | ir por paridad total retrasa meses la primera versión útil |
| D3 | Transporte | carpeta por defecto, enchufable detrás de una interfaz | sólo Git hereda credenciales y fragilidad; sólo carpeta limita a usuarios técnicos |
| D4 | Cifrado | siempre activo, falla cerrado | cifrado opcional = riesgo de fuga silenciosa y promesa débil |
| D5 | Metadatos | cifrar también nombres de sesión y tamaños (objetos opacos) | dejar metadatos visibles filtra el grafo de proyectos y actividad |
| D6 | Importación | réplica por defecto, promoción explícita | rama por defecto duplica conversaciones y confunde |
| D7 | Interop | importar el espejo Git del competidor (migración sin pérdida) | no hacerlo obliga al usuario a elegir de cero |
| D8 | Retención | nunca podar por defecto; política opt-in | podar por defecto rompe la promesa de recuperabilidad |

---

## 9. Criterios de aceptación

**v0.1**
- restaurar las 8 sesiones reales del espejo en un `DSH_HOME` vacío, **byte a byte**;
- `verify` en verde al 100 %, con la clave; y detectar corrupción al alterar un byte;
- no tocar ninguna sesión existente; respaldo antes de tocar la tabla de workspaces;
- cifrado: sin clave, los objetos son ilegibles; con clave equivocada, falla cerrado;
- funciona sin `git` ni `age` instalados.

**v1.0**
- dos terminales convergen; 1.000 ciclos sin pérdida ni duplicación;
- conflicto detectado y explicado, sin tocar archivos;
- dispositivo revocado deja de poder leer y escribir;
- `/vault status` responde en < 1 s con 100 sesiones;
- ninguna llamada al servicio `llm` (prueba que falla si se toca).

---

## 10. Riesgos técnicos

| Riesgo | Mitigación |
|---|---|
| Churn de APIs de preview de DSH | `engines.dsh` estricto + capa de adaptación + tests contra el runtime instalado |
| Formato de log cambia (v5) | delegar migración en DSH; el motor sólo transporta bytes y registra `formatVersion` |
| Drive/OneDrive: conflictos de archivo | objetos inmutables por hash (nunca se reescriben) → un conflicto del proveedor es inofensivo |
| Sesión viva mientras se lee | leer sólo bytes confirmados por `sessionPersistence`/frame completo; nunca abrir en escritura |
| Complejidad de claves | un solo `keyId` por store en v1.0; rotación documentada pero no automática |
| Solo-dev vs cadencia del ecosistema | releases pequeñas y automatizadas; CI como única puerta |

---

## 8. Corrección de cifrado (22-oct-2026)

La primera prueba de montaje real encontró que el plugin no podía abrir la bóveda aunque la
frase era correcta. Causa: el plugin corre dentro de Electron, cuyo crypto es BoringSSL y **no
expone `chacha20-poly1305`** (`crypto.getCiphers()` no devuelve ninguna entrada chacha), mientras
que el Node del runtime sí. Un store sellado con un cifrado que el host no puede abrir se
reporta como "frase incorrecta", que es un diagnóstico engañoso.

Decisión: **AES-256-GCM** como AEAD por defecto (existe en ambos runtimes). El AEAD queda
registrado en `meta.json`, se valida contra `getCiphers()` al abrir, y una prueba de CI falla si
el AEAD por defecto no existe en el runtime. Los stores viejos con chacha siguen legibles donde
el cifrado exista.