# Función futura — `purge` de sesiones (bóveda + host)

Documento de implementación para 2.0. Nace del procedimiento manual del 2026-11-14, que se
ejecutó dos veces y dejó lecciones que la función debe incorporar de fábrica.

- Estado: propuesta
- Alcance: borrado definitivo de una o más conversaciones, sin copias ni respaldos
- Implementación de referencia (temporal): `<tools>/purge-sessions.mjs`

---

## 1. Qué hace

`keeper purge` elimina conversaciones de **dos lugares a la vez**:

1. la **bóveda**: deja de estar en la cadena, y sus objetos (y adjuntos exclusivos) se borran;
2. el **host**: archivo de sesión, caché de proyección y registro de workspaces.

Es **irreversible**. No deja `.bak`, ni papelera, ni cuarentena: si se quiere conservar algo, se
extrae antes con `keeper extract`.

## 2. Contrato propuesto

| # | Regla |
|---|---|
| P1 | **Sólo borra lo pedido.** Ninguna otra sesión cambia de hash ni de contenido. |
| P2 | **Falla cerrado.** Si la cadena no verifica, o un objetivo no se resuelve, no escribe nada. |
| P3 | **Sin restos.** Al terminar, la bóveda verifica, el catálogo no las lista, el árbol no las tiene y el registro no las referencia. |
| P4 | **Confirmación explícita.** `--yes` obligatorio; `--dry-run` muestra el plan y sale con 0. |
| P5 | **Recibo de purga.** Un registro de qué se borró, cuándo, con qué ids y qué totales quedaron (sin contenido). |

## 3. Interfaz

```text
keeper purge --session <id|título> [--session …] [--dry-run] [--yes]
keeper purge --list                       # títulos e ids de la bóveda
```

- Acepta **id** (con o sin el prefijo `session-`) y **título exacto** (resuelto por el catálogo).
- `--dry-run` imprime: sesiones a borrar, sesiones que quedan, adjuntos huérfanos, bytes a
  reclamar y las rutas del host que tocaría.
- Salida: recibo de una página + un JSON para auditoría.

## 4. Algoritmo

```text
1. resolver objetivos      título → id (catálogo); normalizar el prefijo `session-`
2. verificar la cadena     collectSessions + verify; si hay problemas → abortar (P2)
3. reconstruir la unión    mergeChain sobre TODAS las cadenas alcanzables
                           (cabezas por dispositivo + puntero legacy); no confiar en una sola
4. escribir el checkpoint  sesiones conservadas, `prev: null`, `kind: checkpoint`,
                           `covers.purged = [ids]`, based en la cabeza actual (CAS)
5. consolidar cabezas      dejar una sola cabeza de escritura; las demás se retiran para que
                           sus cadenas dejen de ser alcanzables
6. reclamar                gc: borra manifiestos viejos, chunks y adjuntos sin referencias
7. limpiar el host         carpeta session-<id>/ · session_projcache/sessions/<id>.json ·
                           sessionIds del registro de workspaces · .bak que las referencie
8. verificar y sellar      verify ok · catálogo sin ellas · árbol sin archivos ·
                           registro sin ids · recibo de purga
```

### Modo nativo (dentro del plugin, 2.0)

El modo CLI exige **DSH cerrado**: el plugin tiene su propia vista en memoria y, si escribe
después, puede reponer lo borrado. En modo nativo el plugin es el escritor legítimo:

```text
1. workspaceRegistry.detachSession(id)   (desagrupar)
2. sessionPersistence: cerrar/borrar la sesión si el host lo permite; si no, borrar el artefacto
3. reescribir la cadena con el checkpoint sin las sesiones (mismo algoritmo)
4. gc + verificación + recibo
```

El paso 1 es obligatorio: sin él, el registro conserva el id y el panel lo filtra con un aviso.

## 5. Lecciones que la función debe incorporar

| Lección (2026-11-14) | Requisito |
|---|---|
| El plugin **republicó** lo borrado desde su memoria (snapshot a los 2 minutos del purgado) | el modo CLI exige DSH cerrado; el nativo usa los servicios del host |
| `collectSessions().chunks` es un **número**; los descriptores viven en `mergeChain` | el checkpoint se arma siempre desde `mergeChain`, nunca desde `collectSessions` |
| Hay **cadenas por dispositivo** además del puntero legacy | la unión se arma con todas; al purgar se consolidan las cabezas |
| Los ids aparecen con y sin `session-` según la capa | normalizar en la resolución y en las rutas del host |
| Borrar la cabeza ajena sin reconstruir la unión **perdió 7 sesiones** (recuperadas desde `objects/`) | nunca borrar una cabeza sin antes haber materializado la unión en un checkpoint |
| `gc` por defecto es `dryRun` | pasar `{dryRun:false, yes:true}` explícito |

## 6. Criterios de aceptación

| # | Prueba |
|---|---|
| TP-1 | purgar una sesión de una bóveda de 11 deja 10, `verify ok`, y su hash no cambia |
| TP-2 | reejecutar la purga es no-op (0 escrituras, 0 borrados) |
| TP-3 | un id inexistente aborta sin escribir |
| TP-4 | con DSH abierto, el modo CLI se niega; con DSH cerrado, no hay republicación |
| TP-5 | después de purgar, el panel no la muestra y el registro no la referencia |
| TP-6 | los adjuntos exclusivos desaparecen del host y de la bóveda; los compartidos se conservan |

## 7. Preguntas abiertas

1. ¿Se permite purgar por **rango de fechas** o sólo por id/título? (Propuesta: sólo id/título en 2.0.)
2. ¿El recibo de purga se guarda dentro de la bóveda o al lado? (Propuesta: al lado, como los
   `carry-*.json`, para no dejar rastro de lo borrado dentro del archivo.)
3. ¿`detachSession` alcanza cuando el host no expone borrado de sesiones? (Spike P5.)
4. ¿La purga debe ofrecerse también como herramienta del agente (`keeper_purge`)? Riesgo: una
   acción irreversible desde un modelo. Propuesta: no; sólo CLI con `--yes`.
