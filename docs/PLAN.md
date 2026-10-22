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

1. Crear el repo público `dsh-history-keeper` con topic `dsh-plugin`, licencia MIT y CI mínimo.
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