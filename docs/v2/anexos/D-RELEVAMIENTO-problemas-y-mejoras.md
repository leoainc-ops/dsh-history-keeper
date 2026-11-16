---
id: "D"
titulo: "Relevamiento de problemas y mejoras (2026-11-10 20:44 → 2026-11-16)"
estado: "revisado"
version: "1.0"
depende_de: []
alimenta_a: ["09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "20"]
ultima_revision: "2026-11-16"
---

# D — Relevamiento de problemas y mejoras para 2.0

Repaso del período que va desde el 2026-11-10 20:44 hasta el 2026-11-16, cruzando las dos PCs
(pc-a con `pc-a`, pc-b con `<usuario>`), el pendrive, la Prueba A, las consolidaciones y las
purgas. Cada problema tiene evidencia, causa, mejora propuesta y fase.

**Severidad**: `S1` bloquea la promesa · `S2` cuesta datos o tiempo · `S3` fricción.

---

## 0. Lo que ya funciona y no hay que tocar

| Pieza | Evidencia |
|---|---|
| Integridad de la bóveda (`verify`, `conform`) | 7/7 y byte a byte en hosts distintos |
| Cifrado y `keyCheck` | rechaza frase equivocada antes de escribir |
| Export/import append-only | reimportar es no-op; sólo agrega bytes nuevos |
| `extract` a texto legible/JSONL/raw | 1 MB de transcripción sin pérdida |
| Purga idempotente | segunda ejecución no cambia nada |
| `doctor` y reclamo de espacio | 1,059 de ratio, 0 recuperable |

---

## 1. Emparejamiento entre hosts (el problema central)

| # | Sev | Problema | Evidencia | Mejora | Fase |
|---|---|---|---|---|---|
| P1 | **S1** | El `cwd` es absoluto y no portable: la sesión no se puede montar en otro host | `adfd9b13` (cwd de pc-b) no monta en pc-a; `dd4e2186` no monta en pc-b | **traducción de `cwd`** al montar, registrada en el recibo | F1 |
| P2 | **S1** | No hay `attachSession` en 1.0.2: lo restaurado no aparece en un host ya usado | Prueba A: 2 restauradas, 0 visibles | modo `uso` con `create`+`append`+`attach` | F2 |
| P3 | **S1** | El bootstrap del registro sólo corre en host virgen | `workspaceRegistry` (09) | detectar inicializado y attachar; documentar | F2 |
| P4 | **S1** | El preflight por vocabulario aprendido bloquea sesiones legibles | Prueba A: 9 de 11; `adfd9b13` (`todo/write`) | catálogo del host (`KNOWN_SESSION_EVENT_TYPES` + `ignorable`) | F1 |
| P5 | S2 | Sesión divergente se rechaza sin opciones accionables | `1f151636`, `dd4e2186`: “a different log already exists” | plan con acciones (archivar, nuevo id, apartar) | F1 |
| P6 | S2 | Montaje manual exige crear rutas ajenas con permisos de admin | `C:\Users\<usuario>` → `EPERM` | mount sin depender de rutas ajenas + attach nativo | F2 |

## 2. Frase y bóvedas múltiples

| # | Sev | Problema | Evidencia | Mejora | Fase |
|---|---|---|---|---|---|
| P7 | **S1** | `init` genera frase en silencio → bóveda rival con otra clave | pc-b: 32 caracteres, `CHAIN_FAILED` al copiar | **R1: frase elegida, nunca generada en silencio** | F0 |
| P8 | **S1** | Copiar una bóveda sobre otra mezcla `meta.json` y cabezas; el error dice “cannot decrypt” | `CHAIN_FAILED` del 11-11 | detectar `storeId` distinto y decir “hay dos bóvedas”; `recover` se niega | F0 |
| P9 | S2 | No hay forma de cambiar la frase (rekey) sin bóveda nueva | — | documentar export/import con frase nueva o `rekey` explícito | F1 |
| P10 | S2 | La huella del recibo es `sha256(frase)` truncada: oráculo offline | `carry-*.json` | HMAC con `storeId` o PBKDF; nunca la frase | F1 |
| P11 | S2 | Frase de 12 caracteres (~39 bits) | `Poli<>221187` | medidor de fuerza al crear y mínimo recomendado | F0 |

## 3. Captura e integridad

| # | Sev | Problema | Evidencia | Mejora | Fase |
|---|---|---|---|---|---|
| P12 | **S1** | Cuarentena por secretos **silenciosa**: la sesión no se captura y `status` no lo dice | `dd4e2186` sin capturar desde el 9-11 (`openai-key`, `secret-assignment`) | aviso, no cuarentena (D3); estado visible en `status` | F1 |
| P13 | **S1** | El plugin republica desde memoria si la CLI escribe con DSH abierto | manifest 497 re-publicó las 3 purgadas | un solo escritor; en 2.0 el plugin lo es; CLI se niega | F2 |
| P14 | **S2** | Cadenas por dispositivo + puntero legacy: borrar una cabeza puede perder sesiones | se perdieron 7 y se recuperaron de `objects/` | materializar la unión antes de tocar cabezas; `repair` desde `objects/` | F1 |
| P15 | **S2** | `collectSessions().chunks` es un número; los descriptores están en `mergeChain` | checkpoint corrupto del 16-11 | corregir la API o impedir su uso para escribir | F0 |
| P16 | S2 | Una sesión divergente se saltea sin plan | `9a347509` (DIVERGED) | clasificar y proponer reparación | F1 |
| P17 | S2 | No hay cobertura visible: “¿estoy cubierto?” | `status`/`doctor` | informe por sesión (capturada, cuarentenada, divergente) | F3 |
| P18 | S3 | `gc` no distingue qué borra (manifiestos/chunks/adjuntos) | `gc` del 16-11 | reporte por tipo | F1 |

## 4. Purga

| # | Sev | Problema | Evidencia | Mejora | Fase |
|---|---|---|---|---|---|
| P19 | S2 | Borrar del archivo exige reescribir la cadena; no hay comando | purgas manuales del 14 y 16-11 | `purge` como función (ver `FUNCION-purga-sesiones`) | F1 |
| P20 | S2 | La purga deja ids en `workspace.json` si no se edita a mano | host filtra con warning | `detachSession` nativo | F2 |
| P21 | S3 | Adjuntos exclusivos hay que borrarlos explícitamente | 10 blobs del caso | `gc` los detecta; documentar | F1 |
| P22 | S3 | No hay recibo de purga | — | P5 del documento de función | F3 |

## 5. Instalación y host

| # | Sev | Problema | Evidencia | Mejora | Fase |
|---|---|---|---|---|---|
| P23 | **S1** | El procedimiento instaló el paquete fuera del perfil; el host nunca lo tuvo | `C:\keeper-test`, Prueba A | capítulo de instalación por el mecanismo del perfil + verificación | F0 |
| P24 | S2 | El procedimiento asumía `~/.dsh/dsh-runtimes`, que no existía | pc-b, instalación custom | detección robusta de node/pnpm y mensajes claros | F0 |
| P25 | S2 | La versión del host no es visible desde el plugin | `app.asar` 0.2.2-rc.1, sin acceso desde el proceso | obtenerla del instalador/registro o de `process.resourcesPath` | F0 |
| P26 | S3 | `keeper --help` sin bóveda responde “no keeper store” | pc-b | ayuda y versión siempre disponibles | F1 |
| P27 | S3 | `restore` exige DSH cerrado; en modo `uso` no debe hacerlo | guard del CLI | D5 | F2 |

## 6. Formato y compatibilidad

| # | Sev | Problema | Evidencia | Mejora | Fase |
|---|---|---|---|---|---|
| P28 | S2 | Un lector viejo no ve el handshake; hace falta `export --downlevel` | `COMPATIBILITY.md` | elegir downlevel automáticamente o advertir | F1 |
| P29 | S3 | Campos aditivos sin espacio de nombres formal | `09` | política `x-<vendor>` y validación en `conform` | F1 |
| P30 | S3 | `ignorable` no se verifica en `conform` | catálogo del host | TC de conservación | F1 |

## 7. Observabilidad y UX

| # | Sev | Problema | Evidencia | Mejora | Fase |
|---|---|---|---|---|---|
| P31 | S2 | Mensajes engañosos en casos clave (`CHAIN_FAILED`, `cannot decrypt`) | 11-11 | códigos y mensajes por causa | F1 |
| P32 | S2 | No hay recibo de una página para el usuario final | F3 | recibo imprimible | F3 |
| P33 | S2 | `journal`/`undo` existe pero no se ejerció en el caso real | — | probarlo en TC | F1 |
| P34 | S3 | `status` no muestra antigüedad de captura por sesión | — | columna de última captura | F1 |

## 8. Pruebas y documentación

| # | Sev | Problema | Evidencia | Mejora | Fase |
|---|---|---|---|---|---|
| P35 | S2 | 170 tests no cubren mount con `cwd` inexistente, attach, purge ni republicación | — | TC nuevos (TP-1…TP-6, P1–P4) | F1/F2 |
| P36 | S2 | El manual de la Prueba A asumía rutas y orden; falló | `PRUEBA-A-host-nuevo.txt` | procedimiento con detección y verificaciones | F0 |
| P37 | S3 | La ayuda del plugin no menciona `--allow-host-open`, `--force`, ni la cuarentena | 1.0.2 | completar `--help` | F1 |
| P38 | S3 | El nombre “keeper-nativo” quedó en la carpeta (decisión del usuario) | L8572 | no tocar; sólo documentar | — |

---

## 9. Prioridades para arrancar 2.0

| Orden | Problema | Por qué primero |
|---|---|---|
| 1 | **P1 + P2 + P3** (traducción + attach) | es la promesa: dos hosts del mismo usuario |
| 2 | **P4** (catálogo del host) | desbloquea sesiones legibles y elimina falsos negativos |
| 3 | **P7 + P8** (frase) | es la clase de error que corrompe bóvedas |
| 4 | **P12** (cuarentena visible) | hoy hay datos que no se están guardando y nadie lo ve |
| 5 | **P13 + P14 + P15** (escritor único y cadenas) | evita perder datos al mantener la bóveda |
| 6 | **P19** (purga) | ya se necesitó tres veces |

## 10. Preguntas abiertas

1. ¿P1 se resuelve con mapa explícito o con heurística de ruta relativa? Dueño: producto.
2. ¿P2 entra en F1 o F2? Propuesta: F2, pero P4 y P12 en F1.
3. ¿P19 se ofrece como herramienta del agente? Propuesta: no (irreversible).

## 11. Qué sigue

Llevar P1–P6 a `20-RIESGOS`, P7–P11 a `04` (contrato) y `13`, y P19 a `15-BACKLOG` como tarea K-30.
