# Transporte de la bóveda — diseño vigente (2026-11-03)

Este documento reemplaza el ciclo `carry`/`land` de rc.24–rc.30, retirado. La regla que lo ordena
todo: **la bóveda viaja como carpeta; el host sólo ve bytes que él mismo escribió.**

## 1. Principios

1. **Nunca se sintetizan logs de sesión.** Restaurar es copiar bytes exactos. Se intentó recomponer
   logs (fusión de linajes) y el host los rechazó tres veces por tres motivos distintos: ver
   `docs/LESSONS.md`.
2. **La bóveda es el paquete.** Una carpeta cifrada; copiarla es transportarla. No hay estado fuera
   de ella, salvo la frase.
3. **Un solo escritor por bóveda.** Con DSH abierto, el plugin es el escritor. Las herramientas de
   línea de comandos **sólo leen** mientras el host esté abierto.
4. **Nada se sobrescribe.** Lo reemplazado se aparta con sufijo (`*.superseded-*`, `*.replaced-*`,
   `*.broken-*`) y se informa.
5. **Verificar antes de viajar y antes de montar.** Una copia que no verifica no se usa.
6. **Compatibilidad por vocabulario, no por número de versión.** Antes de restaurar se compara el
   vocabulario de eventos de las sesiones con el que este host ya escribió.

## 2. Disposición canónica (igual en todas las PCs)

Todo cuelga del home de DSH, que ya es por usuario. Los scripts y el código **derivan** estas rutas;
ninguna se escribe a mano.

| Qué | Ruta |
|---|---|
| Bóveda | `<home>/history-keeper/` |
| Frase | `<home>/history-keeper.key` |
| Identidad del dispositivo | `<home>/history-keeper-device.json` |
| Bóveda reemplazada | `<home>/history-keeper.replaced-<ts>/` |
| Backup verificado | `<home>/history-keeper.backup-<ts>/` + `.manifest.json` |
| Sesiones (del host, nunca se recomponen) | `<home>/sessions/` |
| Adjuntos (del host) | `<home>/attachments/` |
| Pendrive | `<raíz>/keeper-transfer/{vault,carry.json}` |
| Scripts del pendrive | `<raíz>/scripts/` |

Compatibilidad hacia atrás: si existe `<usuario>/keeper-vault` (disposición usada en pc-a hasta
rc.30), se acepta como bóveda y `keeper status` sugiere moverla a la canónica.

## 3. Las dos operaciones

### Enviar (`keeper export`)

1. Verifica la bóveda (sólo lectura).
2. Copia la carpeta al pendrive, reemplazando la copia anterior.
3. Escribe un recibo `carry.json`: store, dispositivo, sesiones, frames, bytes, resultado de la
   verificación, huella de la frase (nunca la frase).
4. **No** hace snapshot si DSH está abierto; si se quiere capturar lo último, cerrar DSH y correr
   `keeper snapshot` primero (o dejar que el plugin lo haga).

### Recibir (`keeper import`)

1. Verifica la copia del pendrive. Si no verifica, no toca nada.
2. Une bóvedas **sin sintetizar nada**: la regla es la del dueño (una conversación visible por
   sesión); las otras versiones quedan archivadas y reportadas.
3. **Restaura** las sesiones a `sessions/` con `restore` (byte-exacto, nunca sobrescribe; rechaza
   las que ya existen y lo informa).
4. Deja la bóveda local anterior apartada y verifica la resultante.

Lo que **no** hace: recomponer logs, fusionar linajes, republicar sesiones ni escribir en `sessions`
con DSH abierto.

## 4. Compatibilidad

| Eje | Cómo se garantiza |
|---|---|
| Bóveda entre versiones del plugin | formato aditivo (`store/1`, manifiesto con campos extra); nunca se reescriben objetos |
| Sesiones entre versiones de DSH | preflight de vocabulario antes de restaurar; el host más viejo se actualiza primero |
| Frase | una por bóveda; viaja aparte, nunca con la bóveda por defecto |
| Rutas | derivadas del home; `keeper paths` las imprime para que los scripts no las adivinen |

## 5. Orden de trabajo para volver a habilitar el transporte

1. `keeper paths` (base de todo: una sola fuente de rutas).
2. `keeper export` (lectura + copia verificada + recibo). Sin escrituras: seguro con DSH abierto.
3. `keeper import` (verificar + unir bóvedas + `restore`). Requiere DSH cerrado.
4. Re-aplicar las correcciones del escritor listadas en `LESSONS.md` §4 antes de permitir cualquier
   escritura de CLI sobre la bóveda.
5. Prueba de aceptación: **A trabaja → pendrive → B abre DSH y ve la conversación con su contenido;
   sigue trabajando → vuelve a A y la ve actualizada, sin escribir comandos** (una vez por sentido,
   con el host cerrado donde haga falta).
