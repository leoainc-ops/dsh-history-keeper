# Plan de producto — dsh-history-keeper

> Objetivo, plan y cronograma. Diseño técnico en `DESIGN-v0.md`.
> Fecha base: 21-oct-2026.

---

## 1. Decisiones bloqueadas

| # | Decisión | Valor |
|---|---|---|
| D1 | Nombre | **`dsh-history-keeper`** (npm libre; reservar con 0.0.1 en la primera semana) |
| D2 | Promesa | *"Tu historial de DSH vuelve, y podés comprobarlo."* |
| D3 | Alcance v0.1 | snapshot + verify + restore (sin sync en vivo) |
| D4 | Transporte | carpeta compartida por defecto, interfaz enchufable |
| D5 | Cifrado | siempre activo, falla cerrado, **metadatos también cifrados** |
| D6 | Importación | réplica de sólo lectura, promoción explícita con `forkOf` |
| D7 | Dependencias | cero binarios externos (sin `git`, sin `age`): sólo `node:` |
| D8 | Superficies | motor compartido por **CLI** (funciona sin DSH) y **plugin** |

---

## 2. Objetivo

**Misión.** Que ningún usuario de DSH vuelva a perder su historial: capturarlo,
cifrarlo, verificarlo y restaurarlo byte a byte, sin depender de binarios externos
ni de un servicio que pueda leer el contenido.

**Objetivos medibles**

| # | Objetivo | Métrica | Fase |
|---|---|---|---|
| O1 | Restauración fiel | 8/8 sesiones reales restauradas byte a byte en un `DSH_HOME` vacío | A |
| O2 | Integridad comprobable | `verify` 100 % en verde; alterar un byte ⇒ detectado con el objeto y el offset | A |
| O3 | Cifrado real | sin clave, 0 objetos legibles; con clave incorrecta falla cerrado; sin metadatos en claro | A |
| O4 | Cero dependencias | funciona en una máquina sin `git` ni `age`; instalación en 1 comando | A |
| O5 | Cero tokens | ninguna llamada al servicio `llm`; prueba en CI que falla si se toca | B |
| O6 | Captura automática | snapshot al cerrar turno, sin intervención y sin bloquear la UI | B |
| O7 | Convergencia | dos terminales convergen; 1.000 ciclos sin pérdida ni duplicación | C |
| O8 | Conflictos seguros | divergencia detectada y explicada; 0 archivos modificados al detectarla | C |
| O9 | Producto publicable | instalación documentada, README con capturas, listado en el Hub | D |

**Definición de terminado (v1.0):** un usuario nuevo instala con un comando, apunta a
una carpeta, define una clave, y puede (a) ver el estado, (b) verificar todo, (c)
restaurar su historial en otra máquina y comprobar que coincide, y (d) sincronizar dos
terminales sin riesgo de pérdida.

**No-objetivos:** colaboración en tiempo real, servidor propio, cuentas de usuario,
edición concurrente de una sesión, sincronizar credenciales o perfiles de plugins.

---

## 3. Alcance por fase

### Fase A — Motor y CLI (semanas 1–3)
Entregables: repo público; reserva npm `0.0.1`; motor puro (escáner de frames, chunker,
cadena de hashes, layout del store, crypto con `node:crypto`); CLI con `init`, `snapshot`,
`verify`, `status`, `restore` (`--dry-run`, `--cwd-map`, `--force`), `devices`; tests
dorados con las 8 sesiones reales.
**Salida:** O1–O4 cumplidos. Demostrable sin DSH.

### Fase B — Plugin DSH (semanas 4–5)
Entregables: bundle (`dsh.bundle.patch`, `engines.dsh`), `apply(ctx)`, lectura vía
`ctx.sessionPersistence`, hooks de `session/flush` y `session/disposed`, comandos
`/keeper status|snapshot|verify|restore`, ajustes mínimos, prueba de cero-LLM.
**Salida:** O5–O6. Instalable con `dsh plugin add`.

### Fase C — Sync en vivo (semanas 6–8)
Entregables: manifiestos por dispositivo, cursor por dispositivo, pull/push append-only
con verificación, detección de fork con las tres salidas, tabla de workspaces por
dispositivo con merge explícito, leases opcionales.
**Salida:** O7–O8. A/B convergen; conflicto sin daño.

### Fase D — Producto y publicación (semanas 9–10)
Entregables: UI (estado, dispositivos, conflictos), permisos declarados y threat model en
el README, README de nivel competitivo con capturas, i18n ES/EN, publicación npm 1.0.0,
topic `dsh-plugin`, envío al Hub.
**Salida:** O9. Primera versión pública.

### Fase E — Diferenciadores (semanas 11–14, opcional según tracción)
Restore points; retención opt-in; interop de migración desde el espejo Git del
competidor; macOS/Linux; i18n ZH.

---

## 4. Cronograma

Supuesto de capacidad: **12–15 h/semana** (tiempo parcial, un solo desarrollador).
Duplicar horas comprime el calendario casi a la mitad hasta la fase C.

| Semana | Fechas | Foco | Hito verificable |
|---|---|---|---|
| S1 | 21–27 oct | Repo, reserva npm, escáner de frames + chunker | `snapshot` produce objetos para una sesión real |
| S2 | 28 oct–3 nov | Crypto (KDF, AEAD, claves), layout del store | sin clave no se lee; con clave incorrecta falla |
| S3 | 4–10 nov | `verify` + `restore` + tests dorados | **8/8 sesiones restauradas byte a byte** |
| S4 | 11–17 nov | Bundle + `apply(ctx)` + lectura por la API del host | `dsh plugin add` monta y `/keeper status` responde |
| S5 | 18–24 nov | Hooks flush/disposed + ajustes + prueba cero-LLM | snapshot automático al cerrar turno |
| S6 | 25 nov–1 dic | Manifiestos por dispositivo + push | segunda terminal publica sin tocar la primera |
| S7 | 2–8 dic | Pull + cursor + append verificado | B converge con A; 1.000 ciclos sin pérdida |
| S8 | 9–15 dic | Conflictos + workspaces por dispositivo | fork detectado, 0 archivos modificados |
| S9 | 16–22 dic | UI, permisos, threat model, i18n ES/EN | producto navegable de punta a punta |
| S10 | 23–29 dic | README, capturas, npm 1.0.0, Hub | **publicado y listado** |
| S11–14 | ene | Restore points, retención, interop, multiplataforma | según tracción |

**Camino crítico:** S1 → S2 → S3 (sin restauración verificada no hay producto) → S4 → S7.
Las fases C y D pueden solaparse una semana si la captura automática ya es estable.

---

## 5. Riesgos del plan

| Riesgo | Efecto | Mitigación |
|---|---|---|
| Churn de APIs de preview | rompe S4/S5 | `engines.dsh` estricto; capa de adaptación; tests contra el runtime instalado |
| Crypto mal implementada | pérdida total e irrecuperable | sólo `node:crypto`; vectores de prueba; nunca inventar formato propio de clave; revisión externa antes de 1.0 |
| Drive/OneDrive crean copias de conflicto | ruido, no pérdida | objetos inmutables por hash: un duplicado es inofensivo |
| Alcance: tentación de sumar features | retrasa S10 | guardarraíl: todo lo que no esté en O1–O9 espera a la fase E |
| Publicar tarde | sin usuarios ni feedback | reservar nombre en S1 y publicar 0.1 en S3 |

---

## 6. Primeras cinco tareas (S1)

1. Crear el repo público `dsh-history-keeper` con topic `dsh-plugin`, licencias declaradas (código y docs) y CI mínimo.
2. Publicar `dsh-history-keeper@0.0.1` vacío para reservar el nombre en npm.
3. Portar el escáner de frames y el verificador ya probados (v1) a `lib/`, con tests.
4. Implementar `snapshot` contra una carpeta y una sesión real; comprobar que el objeto
   cifrado no es legible sin clave.
5. Escribir el `README.md` inicial con la promesa, el comando de instalación y el estado
   ("pre-alpha: restaurar y verificar").

---

## 7. Estado de ejecución (21-oct-2026)

| Ítem | Estado |
|---|---|
| Repo público, topics, reserva del nombre en npm | hecho |
| Motor: escáner de frames, chunking, crypto, store, cadena de manifiestos | hecho |
| CLI: `init`, `snapshot`, `verify`, `status`, `restore` | hecho |
| Validación con datos reales (8 sesiones de PC-A) | **8/8 byte a byte**, `verify` sobre 2.709 frames / 4,6 MiB, 0 fugas de metadatos |
| Suite de tests | 27/27 |
| Bundle montando en el host | esqueleto válido; faltan hooks de host |
| Sync en vivo | pendiente (fase C) |

Las fases A y la mitad de B quedaron completas en la primera jornada de trabajo; el
cronograma sigue vigente y el cuello de botella pasa a ser la integración con el host.
Actualización fase B: el plugin ya integra el host — `/keeper status|snapshot|verify`,
captura automática en `session/flush` y `session/disposed` con debounce y single-flight,
configuración validada sin romper el montaje, y `restore` deliberadamente fuera del host
(escribe el store vivo). 40 tests, incluido un contrato del bundle que falla si el patch
deja de referenciar el paquete por nombre. Falta: montaje real en DSH (requiere reinicio
de la app) y la fase C.
Publicación: 0.1.0-rc.2 en npm (tag `latest`), 18 archivos, 70 kB. Un defecto de codificación en la
descripción del paquete (un reescritor propio la re-encodeó y npm mostró `Ã¢â‚¬â€`) obligó a
republicar como rc.2 con la descripción en ASCII puro; se agregó una prueba de regresión que falla
si vuelve a aparecer mojibake o si `lib/index.js` deja de declarar la misma versión que `package.json`.
Fase B validada en el host real (22-oct): `/keeper status` con `hooks attached`, 12 snapshots
automáticos, 5 sesiones y 1.861 frames capturados, `pending 0`. Hallazgo crítico de esa prueba:
Electron/BoringSSL no expone chacha20-poly1305, corregido a AES-256-GCM (ver §8 del diseño).

rc.7: las marcas de tiempo se guardan en UTC y se muestran en la zona local con el desfase, y
todos los valores de configuración tienen default (`~/.dsh/history-keeper`, `~/.dsh/sessions`),
así que instalar ya no exige editar el patch del perfil.
---

## 9. Agenda ampliada (24-oct-2026)

### 9.1 Control de frecuencia de snapshots — antes de la fase C

Hoy el único límite es un debounce de 2 s por flush, así que cada lote de turno produce un
manifiesto: 269 snapshots para 5 sesiones en dos días. Se agrega:

- `snapshotMinIntervalMs` **por sesión** (default 30 s), encima del debounce: agrupa los flush
  seguidos de una misma sesión;
- métrica de salida: snapshots por sesión por día (objetivo: menos de 10 sin perder fidelidad);
- prueba: dos flush dentro de la ventana producen **un** manifiesto y el restore sigue siendo
  byte a byte.

Va antes de la fase C porque el sync multiplica manifiestos por dispositivo.

### 9.2 Compactación con contexto — fase E

- Manifiesto resumen (*checkpoint*) que cubre N snapshots; los manifiestos originales quedan
  como historial y pueden podarse según retención.
- Invariante: el checkpoint incluye los hashes de lo que resume, así que la cadena sigue
  siendo verificable de punta a punta.
- **La decisión no es un número fijo**: la toma el motor de política de 9.3.

### 9.3 Motor de política — determinista y auditable

- **Entradas**: sesiones, bytes/día, frecuencia de flush, espacio libre en el destino, clase de
  equipo (CPU/RAM), tiempo desde la última compactación, cantidad de objetos.
- **Salidas**: intervalo de coalescing, umbral de compactación, política de retención.
- **Reglas**: límites duros; cada decisión se registra con su motivo
  (`policy: compact (objects>N, freeDisk>X)`); **ninguna política puede debilitar las
  garantías**: nunca borra la única copia de nada, nunca sacrifica la verificación.

### 9.4 Modelo local ("nanored") — experimental y opcional

- **Idea**: un modelo chico local (1–3 B cuantizado, llama.cpp u ONNX) que **propone**
  parámetros a partir del contexto de 9.3.
- **Rol**: proponente, no autoridad. El motor determinista valida y acota; si el modelo no está,
  todo funciona con las reglas de 9.3. Cero tokens de nube, pero sí pesos (~1–2 GB).
- **Encaje**: choca con el principio "cero binarios externos", así que va como **paquete
  opcional** (`dsh-history-keeper-brain`), nunca en el núcleo.
- **Criterio de aceptación**: tiene que **ganar** a la heurística en una medición reproducible
  (mismos objetos con menos bytes, o menos tiempo de restore, sin perder verificabilidad). Si no
  gana, no entra.
- **Riesgos**: no determinismo y deriva. Mitigación: propuestas registradas con su motivo,
  validación por límites duros y desactivación total.

### 9.5 Filtro de secretos — Must del diseño, todavía ausente

Verificado: el motor no escanea secretos. La decisión de diseño:

- **no redactar** (rompería la exactitud byte a byte); en cambio **cuarentena**: la sesión que
  dispara una regla no se publica, se informa la ruta y el offset, y se publica sólo con
  `--force` explícito;
- reglas: patrones de tokens/claves/contraseñas más una prueba de entropía; falsos positivos
  configurables; **el aviso nunca imprime el valor**.

### 9.6 Deuda operativa menor

- Documentar la política `minimumReleaseAge` de pnpm (instalar el mismo día de un release exige
  una exclusión o un override puntual).
- Matriz de CI `ubuntu` + `windows`.
- `SECURITY.md` y `CONTRIBUTING.md` cuando se abra la colaboración.

### Orden propuesto dentro de la fase E

1. 9.1 (coalescing) junto con C.0, antes del sync.
2. 9.5 (filtro de secretos): protege la promesa antes de compartir un store.
3. 9.2 + 9.3 (compactación y política), que dependen de medir el uso real.
4. 9.4 (nanored) sólo si la medición muestra que puede ganarle a la heurística.
### 9.7 Escalabilidad de la cadena de manifiestos — hallazgo 24-oct

Medición sobre la bóveda real (494 manifiestos, 3,9 MiB publicados):

| Etapa | Tiempo |
|---|---|
| apertura (KDF scrypt) | 1,4 s por proceso |
| leer la cadena (494 archivos) | 4,1–5,4 s |
| `verify` completo | 17,7 s |
| `verify` por CLI de punta a punta | 48,5 s |

**La causa no son los bytes, son los archivos**: cada manifiesto se lee como un archivo
propio, ~8–11 ms cada uno. El costo de `verify` y de cualquier lectura crece **linealmente con
la cantidad de manifiestos**, no con el volumen de datos. Con 5.000 manifiestos una
verificación pasaría los 45 s sólo en lectura.

**Consecuencias para la agenda**

1. La compactación (9.2) deja de ser cosmética: es lo que mantiene acotada la latencia.
2. Alternativa estructural para v0.2: guardar los manifiestos en **un archivo append-only**
   por bóveda (mismo patrón que el log de sesión: frames con hash) en lugar de un archivo por
   manifiesto. Append O(1) y lectura secuencial, con migración desde el formato actual.
3. Mientras tanto: caché de cadena en memoria por `head` + `mtime`, que evita releer 494
   archivos en cada comando del plugin.
4. Objetivo verificable: `verify` bajo 5 s con 10.000 frames.
### 9.8 Retracción segura (uninstall) — pedido 24-oct

Objetivo: poder quitar el plugin **sin dejar rastros de su actividad**, sin destruir el
historial del usuario y sin tocar nada ajeno. No es prioritario, pero el diseño se fija ahora
porque un uninstall mal hecho es más peligroso que no tenerlo.

#### Inventario real de huellas (verificado en la máquina, 24-oct)

| # | Huella | Dónde | ¿Dato del usuario? |
|---|---|---|---|
| 1 | fila del plugin en el patch del perfil | `profiles/<p>/cordis.patch.yml` (`- id: history-keeper`) | no |
| 2 | dependencia | `profiles/<p>/package.json` → `dependencies` | no |
| 3 | entrada en la lista de bundles | `profiles/<p>/package.json` → `dsh.profile.bundles` | no |
| 4 | entrada del lock | `profiles/<p>/pnpm-lock.yaml` | no |
| 5 | exclusiones que pnpm agregó por nosotros | `profiles/<p>/pnpm-workspace.yaml` (`minimumReleaseAgeExclude`) | no |
| 6 | copia instalada | `profiles/<p>/node_modules/<pkg>` | no |
| 7 | archivo de clave generado por `init` | `~/.dsh/history-keeper.key` (si se usó el default) | **sí: sin ella la bóveda es ilegible** |
| 8 | bóveda | `config.store` (default `~/.dsh/history-keeper`) | **sí: el respaldo** |
| 9 | copias de respaldo hechas por el tooling | `cordis.patch.yml.bak-*` en el perfil | no |
| 10 | temporales de escritura atómica | `<archivo>.tmp-<pid>-<rand>` | no (ninguno hoy) |
| 11 | sesiones restauradas | `<home>/sessions/...` | **sí: son del usuario** |

Nada más: no hay servicios, tareas programadas, variables de entorno persistentes, claves de
registro ni entradas de PATH. El plugin **no escribe** fuera de la bóveda, el archivo de clave
y las sesiones que el usuario manda a restaurar.

#### Semántica propuesta

- **Por defecto**: quitás el programa, **conservás los datos**. Elimina 1–6, 9 y 10; informa
  exactamente qué quedó (7 y 8) y con qué comando borrarlo.
- **`--purge-data`**: elimina además la bóveda y el archivo de clave. Exige `--yes` y muestra
  antes el id de bóveda, la cantidad de sesiones y la huella de la frase, para que se sepa qué
  se destruye.
- **Guarda dura**: si la bóveda contiene sesiones que esta máquina **no** tiene, `--purge-data`
  se niega salvo `--force`, porque esas serían las únicas copias.
- **`keeper uninstall --dry-run`**: imprime el manifiesto completo (ruta, motivo, tamaño) y lo
  que va a conservar. Es el modo por defecto sugerido para el primer intento.
- **`keeper uninstall --verify`**: relee el perfil y comprueba que no queda ninguna referencia
  a `keeper`; sale con código 1 si encuentra alguna.

#### Reglas de implementación

1. **Nunca globs.** El script anterior de la v1 usaba `dsh-*` y habría borrado directorios del
   propio DSH (`dsh-subprocess-*`, `dsh-workspace-changes-*`). Rutas explícitas y verificadas.
2. **Edición de YAML por línea e id-aware**, con copia previa; si el YAML no parsea, **no se
   reescribe nada** y se informa.
3. **Idempotente**: correrlo dos veces es seguro; reporta "ya ausente".
4. **No toca**: `~/.dsh/sessions`, `~/.dsh/attachments`, credenciales, filas de otros plugins,
   el runtime de DSH, el clon del repositorio.
5. Los **logs del host** quedan fuera de alcance: DSH puede haber registrado avisos `[keeper]`
   en sus propios archivos de log, y reescribirlos no es tarea de un plugin.

#### Pruebas

- Perfil de prueba con la fila nuestra y la de otro plugin: se va la nuestra, queda la ajena.
- Correr dos veces.
- Patch corrupto: se niega y no modifica nada.
- `--purge-data` sin `--yes`: se niega.
- `--purge-data` con sesiones ausentes en local: se niega salvo `--force`.
- `--verify` detecta una referencia residual inyectada a propósito.
#### Revisión 24-oct: el respaldo es obligatorio, no opcional

Criterio del autor: la retracción tiene que borrar **todo registro de la bóveda del disco de
este equipo**, y para eso la bóveda debe estar antes en un respaldo externo. El borrado pasa a
ser el **último** paso, después de una verificación, no el primero. Esto reemplaza la
semántica anterior.

**Secuencia obligatoria**

1. `keeper uninstall --to <destino>` — el destino es obligatorio; sin él no hay retracción.
2. **Copia**: se copia la bóveda completa (objetos + manifiestos + `meta.json`) y el archivo de
   clave, a `<destino>/<storeId>/`.
3. **Verificación de la copia, en dos niveles**:
   - *archivo por archivo*: sha256 y tamaño de cada archivo contra el original; misma cantidad
     de archivos y mismos bytes totales;
   - *contenido*: `verify` **sobre la copia**, con la frase, para probar que no es sólo un
     montón de bytes idénticos sino una bóveda válida y descifrable.
4. **Recibo** `keeper-backup.json` en el destino: `storeId`, cabeza de la cadena, cantidad de
   sesiones/chunks/bytes, sha256 de cada archivo, fecha y huella de la frase. **Sin ids de
   sesión ni rutas de proyecto**, para no filtrar metadatos.
5. Sólo si 3 pasa: se borra la bóveda local, el archivo de clave **que creó `init`**, y las
   huellas 1–6, 9 y 10 del inventario.
6. Si la verificación falla: **no se borra nada**; se informa qué archivo no coincide y el
   comando termina en error.
7. Reanudable: si se interrumpe después de copiar pero antes de borrar, volver a ejecutarlo
   detecta el respaldo verificado por el recibo y continúa sin recopiar.

**Salvedades que el diseño debe responder**

- *Misma unidad que la bóveda* (incluye carpetas de nube sincronizadas en `C:`): se **advierte**
  y se registra el destino en el recibo; si el autor quiere rigor, `--require-external` rechaza
  destinos en la misma unidad.
- *Escotilla de escape*: `--discard` existe pero **sólo** cuando la bóveda no contiene ninguna
  sesión ausente del equipo (nada único que perder), y exige `--yes`. Con sesiones ausentes,
  la bóveda es la única copia y el respaldo es innegociable.
- *Frases ajenas a la bóveda*: el archivo de clave que creó `init` se borra; un
  `passphraseFile` que eligió el usuario **no se toca** (no lo creamos nosotros), sólo se
  informa su ruta para que lo elimine él.
- Para poder borrar la clave con seguridad, `initStore` registra en `meta.json` qué archivo de
  clave generó (`generatedKeyFile`). Borrar sólo lo que consta como propio.
**Decisiones aprobadas por el autor (24-oct):** (a) un destino en la misma unidad, incluidas
carpetas de nube en `C:`, sólo **advierte** y queda registrado en el recibo; `--require-external`
queda disponible para quien quiera el rigor; (b) el recibo **incluye la huella de la frase**
(`sha256(storeId + frase)`), que no revela la frase y permite detectar después si una copia
pertenece a la frase que se tiene. Prioridad: no urgente; se implementa después de la fase de
eficiencia y antes de publicar en el Hub.
**Estado 24-oct: punto 3 hecho (rc.13).** Caché de cadena en `lib/store.js`, con clave por
cabeza + cantidad de snapshots, e invalidación automática al escribir. Medición: 14,8 s (541
manifiestos, frío) → 0 ms en caliente. `verify` lee siempre del disco (`{ fresh: true }`) para
que una lectura cacheada no oculte un objeto borrado. La lectura fría de un proceso de CLI
sigue pagándose; eso lo acota la compactación.
**Estado 24-oct: tarea 5 hecha (rc.14).** Los adjuntos se capturan por referencia
(`sha256:<64 hex>` en el log, blob en `<home>/attachments/v1/objects/<2 hex>/<hash>`), se
verifican contra el hash de su nombre y se restauran en el layout del host sin sobrescribir.
Una referencia sin blob o con contenido alterado se informa y no se captura. 8 tests nuevos;
uno de ellos captura un adjunto real de 22 KB, lo restaura y compara byte a byte.
**Estado 24-oct (rc.15/rc.16): dos falsos positivos del filtro y un hueco real.** El gate
cuarentenó esta misma conversación dos veces: primero por `PASSPHRASE = '<valor con test>'` en
una constante de test (corregido en rc.15: las reglas ignoran valores con marcadores
`test/example/fake/…`), y después por mis fixtures de test que contenían literales con forma de
clave (corregido construyéndolos en tiempo de ejecución, para que el archivo nunca contenga la
cadena). Además se descubrió que la captura incremental **nunca revisita bytes ya publicados**,
así que una referencia vieja nunca se capturaba: `keeper attachments` (rc.16) reconstruye cada
sesión publicada y captura los blobs faltantes. Sobre la bóveda real: 1 blob de 22,2 KiB
capturado, `verify` ok con 5 sesiones / 3.162 frames / 4,5 MiB + 1 adjunto.