# Lecciones acumuladas — 2026-11-03

Documento de referencia obligada antes de tocar el transporte de bóvedas o los logs de sesión.
Recoge lo aprendido en campo (dos PCs, pendrive, versiones distintas de DSH) y los errores de
diseño propios, para no repetirlos. Nada de esto es código: es el criterio.

## 1. El log de sesión de DSH no es un archivo de texto

Un `session.v4.jsonl.zstd` es una secuencia de **frames zstd independientes** que descomprimen a
un JSONL. Cada línea es un evento con `seq`, `time` y `data`. Pero el contenido obedece a una
**máquina de estados** que el lector exige:

| Regla | Observada |
|---|---|
| `turn/start` | exige `data.turn` = el turno siguiente y que no haya otro abierto |
| `turn/end` | exige el turno abierto y ningún `step` abierto |
| `step/start` | exige turno abierto y `data.step` = el paso siguiente del turno |
| `step/end` | exige el paso abierto |
| `tool/call` ↔ `tool/result` | una llamada sin resultado deja el cierre en error |
| `system/`, `developer/`, `assistant/attempt` | exigen turno y paso abiertos que coincidan |
| `surfaceOp` / `sourceEventSeqs` | los eventos de **reemplazo** referencian `seq`s anteriores, únicos |
| `shadowedSeqs` | las compactaciones referencian un tramo exacto de la superficie |

**Conclusión dura**: el log es un **historial de ediciones**, no una lista de mensajes.
**Empalmar o recomponer líneas produce logs corruptos.** Se intentó tres veces y falló tres veces
con errores distintos (`turn/start does not open the expected turn`, `sourceEventSeqs ranges must
contain unique earlier seqs`, y antes un rechazo por eventos desconocidos). Cualquier log que no
escriba el propio host es sospechoso.

## 2. Lo que sí funciona (verificado en campo, varias veces)

- **Copiar la bóveda como carpeta** entre PCs y versiones: 8/8 sesiones restauradas byte a byte.
- `restore` es **byte-exacto** y **nunca sobrescribe**: informa los rechazos y sale con código
  propio (`3` cuando completó con rechazos).
- **Portabilidad del formato de bóveda** entre versiones del plugin: `store/1`, manifiesto con
  campos aditivos, objetos direccionados por hash. Un plugin nuevo lee bóvedas viejas.
- Verificación completa (frames, hashes, cadena), cuarentena de secretos, dedupe por contenido,
  cabezas de cadena por dispositivo.
- **Compatibilidad de lectura entre versiones de DSH**: lo que decide es el **vocabulario de
  eventos**, no el número de versión. Se detecta con un preflight antes de escribir.

## 3. Errores de diseño propios (no repetir)

| Error | Consecuencia |
|---|---|
| `carry` hacía `snapshot` (escritura) y se anunciaba como seguro con DSH abierto | carrera con el plugin del host |
| `land` unía bóvedas pero **no escribía en `sessions`** | la conversación no aparecía en DSH |
| `merge` desempataba por **autoría** (`owner`) y no por frescura | el trabajo nuevo quedaba archivado y desaparecía de la vista |
| Dedupe por `(sesión, seq)` dejaba ganar al descriptor **más viejo** (la cadena se lee de nuevo a viejo) | un linaje viejo podía resucitar sobre el nuevo |
| El lock vencido se rompía **por antigüedad**, aunque el dueño siguiera vivo | dos escritores sobre la misma cabeza |
| El CLI escribía con la **cabeza legacy** mientras el plugin usaba la de su dispositivo | dos "dueños" de la misma sesión |
| Guard por **bytes** al republicar | la compresión engaña: dos colas parecidas pesan menos juntas |
| Fusionar/republicar logs del host | tres intentos, tres rechazos del lector |

## 4. Correcciones que quedaron probadas y **hay que re-aplicar** cuando se retome el escritor

1. **CAS en `writeManifest`**: el escritor declara contra qué cabeza preparó el payload y el
   escritor se niega si la cabeza se movió (`HEAD_MOVED`).
2. **Lock**: romperlo sólo si el proceso dueño **ya no existe**; nunca por antigüedad sola.
3. **Dedupe**: gana el descriptor **más nuevo** (el primero de la cadena, que se lee nuevo→viejo).
4. **`carry`**: usar la identidad del dispositivo (no la cabeza legacy) y **no** hacer snapshot si
   DSH está abierto.
5. **Regla dura**: con DSH abierto, sólo lectura (`status`, `verify`, `inventory`, `lineage`).

## 5. Compatibilidad entre versiones

- **DSH**: se detecta por vocabulario de eventos. Actualizar **primero el host más viejo**. El
  keeper no puede hacer que un host viejo lea eventos nuevos, y no debe intentarlo.
- **Plugin**: el formato de bóveda es aditivo; nunca se reescriben objetos ni se cambia el esquema.
  Un plugin nuevo debe leer bóvedas de cualquier versión anterior y decirlo (`keeper status`).
- **Sesiones**: entre versiones de DSH, lo que viaja son **bytes del host**. No se interpretan ni se
  recomponen.

## 6. Reglas operativas que evitaron desastres

- **Verificar antes de viajar y antes de montar**: una copia que no verifica no se usa.
- **Nunca sobrescribir** un log del host ni una bóveda: se aparta (`*.superseded-*`,
  `*.replaced-*`, `*.broken-*`) y se informa.
- **Backup verificado** antes de cualquier operación que escriba, con manifiesto de hashes.
- **Restaurar es copiar bytes**, no recomponer.
- **Un solo escritor** por bóveda; si hay dudas, cerrar DSH.

## 7. Lo que no se vuelve a intentar

- Fusionar, recomponer o republicar logs de sesión del host.
- Escribir en `sessions` con DSH abierto.
- Confiar en la antigüedad del lock.
- Medir el valor de un cambio por la cantidad de funciones: el proyecto es **resguardar, llevar y
  traer** historial. Todo lo demás es accesorio.

## 8. Estado al cerrar esta etapa

Código de vuelta al conjunto de funciones de `0.1.0-rc.23` (control: `inventory`, preflight,
`lineage`, códigos de salida, regla del dueño). Se retiraron `carry`, `land`, `merge` sintético,
`fuse`, `install`, `rebaseline` y `backup` del código; las versiones rc.24–rc.30 quedan publicadas
como registro de lo intentado y **no deben usarse**.
