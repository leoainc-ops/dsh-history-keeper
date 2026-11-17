# Hoja de ruta hacia 1.0 y hacia la bóveda como producto estándar

Asentado el 2026-11-07. **Punto de partida**: `0.1.0-rc.37`. **Destino**: `1.0.0`.

La regla de esta etapa: **no se agregan funciones nuevas**. Todo lo que sigue cierra lo que ya
existe, o completa lo que el estándar necesita para ser un estándar.

> **Cerrada el 2026-11-09 con `1.0.0`.** Este documento queda como registro: qué se planeó, qué se
> aceptó, qué se desvió y qué quedó fuera. Lo que sigue después de 1.0 está en el CHANGELOG, en
> «After 1.0».

## Estado de ejecución

| Fase | Estado | Versión |
|---|---|---|
| M1 — frenar el crecimiento | **hecho** · invariante medido: bóveda/sesiones 1,012 | `rc.38` |
| M2 — escritor confiable | **hecho** · CAS, lock por PID, descriptor más nuevo, guardia de host | `rc.39` |
| M3 — formato v1 y handshake | **hecho** · `writer`/`minReader`, `catalog` derivado, `export --downlevel`, `keeper conform` | `rc.40` + `rc.44` |
| M4 — extracción legible/fiel | **hecho** · `keeper extract` (readable/JSONL/raw), gate de secretos, BOM | `rc.41` + `rc.44` |
| M5 — arranque con importación automática | **hecho en código** · buzón, import al montar, journal, `import --undo`, `/keeper undo`; **falta la prueba real entre PC** | `rc.42` |
| M6 — congelar 1.0.0 | **hecho** · tag `v1.0.0`, release, npm `latest` | `1.0.0` |


## Principios que ordenan la etapa

1. **La bóveda es el activo; el plugin es un adaptador.** El formato (`docs/SPEC-vault.md`) manda;
   el plugin, la CLI y los lanzadores son superficies sobre él.
2. **La bóveda guarda bytes que escribió el host.** No los interpreta, no los recompone, no los
   inventa. Fusionar o reescribir logs queda fuera del contrato (ver `docs/LESSONS.md`).
3. **Eficiencia de espacio desde el día uno.** Invariante permanente:
   `bytes de la bóveda / bytes únicos de sesión ≤ 1,1`, y **0 objetos no referenciados** después de
   cada compactación. No se mide "cuántos viajes aguanta": se mide siempre.
4. **Compatibilidad con handshake.** La bóveda declara su formato y su lector mínimo; el plugin avisa
   cuando está desactualizado; un lector viejo se niega con un código, no adivina.
5. **Una bóveda externa se importa sola.** Si existe y verifica, lo nuevo se trae e informa; el
   usuario puede deshacer.

## Fases del plugin

### M1 — Frenar el crecimiento (`0.1.0-rc.38`)

- `gc` automático y acotado después de cada compactación; retención declarada **dentro** de la bóveda.
- `import` **sin re-sellar**: los objetos idénticos se reutilizan; un viaje no duplica el contenido.
- `export` sin copias residuales (`.replaced-*` deja de quedar por defecto).
- El plugin **no** duplica la bóveda en disco por su cuenta.

**Aceptación**: medido sobre la bóveda real, el total no crece entre transportes y los no
referenciados quedan en 0.

### M2 — Escritor confiable (`0.1.0-rc.39`)

- CAS de cabeza (`HEAD_MOVED`) en `writeManifest`; `snapshot` declara contra qué cabeza trabaja.
- `LOCK` se rompe **sólo** si su dueño ya no existe.
- Dedupe por el descriptor **más nuevo** de la cadena.
- **Guardia**: ninguna escritura de CLI con DSH abierto (error claro, no intento silencioso).

**Aceptación**: dos procesos simultáneos, 10 rondas → `verify: ok`, sin huecos.

### M3 — Formato v1 y estándar (`0.1.0-rc.40`)

Completa lo que falta del contrato (ver la pista E, abajo):

- **Catálogo** dentro de la bóveda (E2).
- **Handshake** de versión de formato, de escritor y de lector mínimo (E3).
- Extensiones con **espacio de nombres** en la especificación (E1, ampliación).
- `export --downlevel <versión>` (E3).

**Aceptación**: `keeper conform` valida bóvedas de versiones anteriores, rechaza una mayor con
código claro, y el plugin avisa si está desactualizado indicando qué versión hace falta.

### M4 — Extracción (`0.1.0-rc.41`)

- `export --jsonl` (fiel, reimportable) y `export --readable` (texto).
- Condiciones no negociables: ruta de salida obligatoria, permisos de sólo el usuario, sin
  sobrescribir, encabezado que declara "copia en texto plano", y el *gate* de secretos antes
  (se niega con `--force` para continuar).
- El render se guarda **cifrado** como un objeto más; sale en claro sólo por este comando.

**Aceptación**: una sesión sale como `.txt` legible y como `.jsonl` reimportable, y la bóveda no
cambia de naturaleza.

### M5 — Arranque con importación automática (`0.1.0-rc.42`)

1. Al iniciar el host, el plugin **detecta** una bóveda externa en los canales conocidos.
2. La **verifica** y comprueba la versión del formato.
3. **Compara**: sesiones que sólo están en la externa, y las que están más largas.
4. **Importa por defecto** lo nuevo y **informa** qué trajo (no pregunta: la existencia de la bóveda
   lo justifica).
5. Deja **diario de deshacer**: la bóveda anterior y las sesiones reemplazadas. `import --undo`
   vuelve exactamente al estado previo.
6. **Confirmación** del diario: automática en el primer `export` posterior, o a los **7 días**, lo
   que ocurra primero.
7. **Guarda en el export**: se niega a sobrescribir una bóveda externa que tenga contenido que la
   local no tiene; `--replace` para forzar.

**Cambio de regla que esto implica**: el plugin **sí** escribe en `sessions/`, pero **sólo** por esta
vía, con el lock tomado y con el diario de deshacer.

**Dependencia dura**: M5 **no puede entregarse antes de M2** (escritor confiable) ni sin el diario de
deshacer.

**Aceptación**: con la bóveda externa conectada, al abrir DSH el trabajo de la otra máquina ya está
disponible; `import --undo` deja todo como estaba.

### M6 — Congelar 1.0.0

- Matriz de compatibilidad: **parcial y declarada**. Dos generaciones del plugin (rc.38 y 1.0.0)
  probadas contra la misma bóveda; el eje de la segunda versión de DSH no se pudo cubrir (sólo había
  una build) y está escrito en `docs/COMPATIBILITY.md`.
- `docs/CLI.md`, `docs/OPERATIONS.md`, `docs/TRANSFER.md`, `docs/SPEC-vault.md`, `docs/HISTORY.md`,
  `docs/COMPATIBILITY.md` y los dos README al día.
- Sin funciones nuevas: sólo correcciones que bloqueen la aceptación de M5.

## Pista E — la bóveda como producto estándar

| # | Pieza | Estado |
|---|---|---|
| **E1** | Especificación del formato (`docs/SPEC-vault.md`) | **hecho**: extensión con espacio de nombres, handshake, retención, buzón y actualización |
| **E2** | Catálogo dentro de la bóveda: host y versión, equipo, usuario, proyecto, sesión, rango de turnos, fechas, tamaños, hashes, adjuntos | **hecho** (`rc.40`/`rc.44`): hashes por sesión y contrato del host. Decisión: «host» = contrato del log, no la versión de la app, que no es visible para un plugin |
| **E3** | Handshake de versión y `export --downlevel` | **hecho** (`rc.40`) |
| **E4** | Conformidad (`conformance/`, `npm run conformance`) | **ampliada** (`rc.44`): 7 puntos, incluido catálogo con hashes y rechazo de formato mayor; además `keeper conform` valida cualquier bóveda |
| **E5** | Matriz de compatibilidad documentada y probada | **falta** — entra en M6 |
| **E6** | Después de 1.0: especificación pública, licencia del formato y validadores de terceros | post-1.0 |

## Definición de terminado de la 1.0

1. El ciclo completo funciona **sin editar archivos ni escribir comandos finos**: trabajar en A →
   pendrive → abrir DSH en B (ya está) → trabajar en B → abrir DSH en A (ya está).
2. **Ninguna operación duplica la bóveda**; el tamaño se mantiene pegado a las sesiones únicas.
3. La bóveda se describe a sí misma; `conform` la valida; una versión mayor se rechaza con código.
4. Se extrae a texto legible y a JSONL fiel, con la clave y sólo por comando explícito.
5. Con DSH abierto no hay escrituras de CLI; el plugin captura, compacta, importa y no copia.
6. La matriz de versiones está escrita y probada.

## Ampliaciones registradas (desvíos aceptados)

| Fecha | Desvío | Motivo |
|---|---|---|
| 2026-11-08 | M4 se llama `keeper extract`, no `export --jsonl`/`--readable` | `export` ya significa copiar la bóveda al pendrive; sobrecargarlo hacía inseguro recordar cuál es cuál |
| 2026-11-08 | El render se deriva, no se guarda cifrado | Guardarlo duplicaría estado que puede desfasarse y agregaría una escritura por captura; `--raw` cubre el «fiel y reimportable» |
| 2026-11-08 | El journal de M5 registra archivos de sesión, no «la bóveda anterior» | El swap que esa frase suponía lo eliminó M1 |
| 2026-11-08 | «Versión del host» = versión del formato de log | La versión de la app DSH no es alcanzable desde el plugin; el contrato del log sí es lo que la bóveda carga |

## Higiene y uso de recursos (cerrada el 2026-11-09, salvo la poda de recibos)

Controlar la basura y el consumo es parte del producto, no una limpieza ocasional. Cada artefacto
tiene que tener dueño, política y comando. Estado al 2026-11-09:

| Artefacto | Quién lo crea | Política | Estado |
|---|---|---|---|
| `history-keeper.incoming` (buzón) | `import --stage` / `/keeper import <ruta>` | **borrar** cuando el import termina bien; **apartar** a `.failed-<sello>` si falla | **hecho** (`rc.48`) |
| `history-keeper.incoming.imported-*` | `autoImport` (comportamiento anterior) | ya no se crea: el éxito borra el buzón (`--keep-staged` si se quiere conservar) | **hecho** (`rc.48`) |
| `meta.json.before-upgrade-*` | `keeper upgrade` | se conservan los **últimos 3** y se borran los anteriores | **hecho** (`rc.48`) |
| `.replaced-*` / `.superseded-*` / `.broken-*` / `.backup-*` | versiones anteriores | no se crean más; los existentes se revisan y se borran | ok (ninguno hoy) |
| `<store>.key` o `history-keeper.key` | `init` sin frase | **una sola copia de la frase**; ya no se genera en el home cuando hay `passphraseFile` ni con `--store` explícito | **hecho** (rc.45) |
| `~/.dsh/pending/*.tgz` | instalación desde paquete local | borrar después de instalar | ocasional |
| `carry-*.json` en el pendrive | cada export | conservar los últimos 20 (son de KB) y podar el resto | **falta** (hoy hay 5) |
| Objetos no referenciados | capturas y compactaciones | `gc` automático tras compactar (`retention.autoGc`) | **hecho** (rc.38) |
| Manifiestos viejos | cada captura | compactar cada 50; el checkpoint reemplaza la cadena | hecho (política activa) |
| `sessions/*.incoming-*` | `restore --force` | aparta la copia del host; revisar y borrar | manual |

### Auditoría de recursos que debe existir

Un comando `keeper doctor` (**hecho en `rc.48`**) que informa y propone acciones:

- objetos totales vs referenciados, y bytes recuperables con `gc`;
- manifiestos desde el último checkpoint, y si la compactación está por vencer;
- invariante de tamaño: bytes de la bóveda ≤ 1,1 × bytes de sesiones únicas;
- restos en el home (buzón, `.imported-*`, `.failed-*`, `.before-upgrade-*`, `.key` duplicada);
- espacio libre en el destino de export y en el buzón antes de copiar;
- estado del journal de deshacer (armado, vence el …).

### Regla

Ninguna operación deja una copia completa de la bóveda en el disco. La copia existe sólo mientras
está en tránsito (el pendrive, el buzón durante un import) y se borra al terminar. Lo que falla se
aparta con nombre y fecha, y se informa.

## Fuera de la 1.0 (a propósito)

Consolidar o fusionar conversaciones en la vista (depende del host) · UI propia · Hub · sincronización
por red o nube · adaptadores para otros hosts · cambios de cifrado o de frase.

## Decisiones tomadas (registro)

| Fecha | Decisión |
|---|---|
| 2026-11-03 | La bóveda es el producto; el plugin es un adaptador. No se sintetizan logs. |
| 2026-11-07 | La clave pertenece a la bóveda (autodescriptiva); la frase es el único secreto. Recuperación en un host nuevo = bóveda + frase. |
| 2026-11-07 | Eficiencia de espacio como invariante permanente, no como prueba de N viajes. |
| 2026-11-07 | La bóveda externa se importa sola al arrancar; se informa; hay deshacer (7 días o primer export). |
| 2026-11-07 | El export no sobrescribe una externa con contenido que la local no tiene (`--replace` para forzar). |
| 2026-11-07 | El plugin escribe en `sessions/` sólo por el import, con lock y diario de deshacer. |

## Riesgos conocidos

- **M5 depende de M2**: importar automáticamente escribe en el home del host; sin escritor confiable
  repetiría la carrera que dañó una bóveda en campo.
- **El aviso al iniciar depende de la API de UI del host**: si DSH no expone modal o selector, la
  alternativa es un aviso visible en la conversación más `/keeper import <ruta>`. Se verifica al
  llegar a M5 y se informa antes de prometerlo.
- **El catálogo agrega superficie al contrato**: se define en M3 junto con la conformidad, no antes.

## Cierre de la sesión 2026-11-09 (previo a la prueba A)

**Hecho y verificado**

- M1–M5 en código y probados; 167 tests, conformidad de 7 puntos, guard de sesiones.
- `0.1.0-rc.47` en el repositorio y en el perfil, con el merge que agrega en vez de reescribir (hoy el perfil y el repositorio están en `1.0.0`).
- Bóveda real: 11 sesiones, 11.486 frames, 16,0 MiB; `verify` y `conform` ok.
- Export al pendrive verificado y conformado (11 sesiones, 16,0 MiB, 10 adjuntos).
- README/README-es declaran el estado real; `PLAN.md` saneado (sin nombre de equipo ni rutas de drive).

**Cerrado después de ese cierre**

- **Compactado y reclamado**: 28,38 → 16,91 MB (ratio 1,059) y pendrive reexportado.
- **npm**: `latest` = `1.0.0`; rc.45 y rc.46 deprecadas con motivo.
- **1.0.0**: tag, release y publicación. Aceptación en un host nuevo: pendiente de la prueba A.

**Decisiones de esa sesión (opción prudente)**

- `PLAN.md` y `LESSONS.md` siguen públicos, saneados: son la memoria del proyecto.
- La especificación se queda en este repositorio hasta 1.0; se extrae sólo si hay terceros.
- Tags: sólo `v1.0.0` al congelar, más los hitos que se decidan entonces.
- No se depreca nada mientras `latest` no tenga una versión sana y legible.

**Material de trabajo (fuera del repositorio)**

- `C:\Users\leoai\keeper\docs\PREPRINT-documentacion-1.0.md` — propuesta de documentación y
  trazado de las 45 versiones publicadas, para publicar después de 1.0.
