# Manual del usuario

Para quien usa DeepSeek Harness y quiere que su historial no se pierda. No hace falta saber
programar, ni tocar archivos, ni entender de cifrado: todo lo de abajo se hace desde la conversación
o con un comando y un pendrive.

> Los documentos técnicos están en inglés (`docs/CLI.md`, `docs/SPEC-vault.md`); este manual y el
> [manual técnico](MANUAL-TECNICO.md) están en español.

## 1. Qué es esto

`dsh-history-keeper` guarda una **copia cifrada y verificable** de tus conversaciones de DeepSeek
Harness, y te deja llevarlas de una computadora a otra sin duplicar nada.

Pensalo como dos cosas juntas:

- una **caja fuerte** donde cada conversación queda guardada tal como el programa la escribió;
- una **copia de seguridad** que se puede llevar en un pendrive y abrir en otra máquina.

Lo que guarda no es un resumen ni una reconstrucción: son los **bytes exactos** que escribió el
programa. Por eso, cuando se restaura, la conversación es idéntica, no “parecida”.

## 2. Qué problema resuelve

| Situación | Sin el keeper | Con el keeper |
|---|---|---|
| El programa borra o rota una sesión | se pierde el trabajo | se restaura desde la bóveda |
| Cambiás de PC | copiás carpetas a mano y algo se rompe | se importa y aparece en el historial |
| Querés leer una charla fuera del programa | no hay forma | se extrae a texto o a JSONL |
| Sospechás que un archivo se corrompió | te enterás tarde | `verify` te lo dice con un código |
| Tenés miedo de que la copia ocupe cada vez más | crece sin control | invariante de tamaño y reclamo automático |

## 3. Qué **no** es

- **No es sincronización en vivo.** No hay nube, ni servidor, ni cuenta. La bóveda viaja cuando vos
  la llevás.
- **No es una interfaz nueva.** El plugin vive dentro de DSH; no reemplaza su pantalla.
- **No es un gestor de contraseñas.** Guarda tu historial, no tus claves.
- **No recupera una frase olvidada.** No hay “pregunta secreta” ni llave maestra.

## 4. Qué necesitás antes de empezar

1. **DeepSeek Harness** instalado y funcionando (versión `0.1.0-rc.6` o posterior, anterior a
   `0.3.0`).
2. **El plugin** instalado en el perfil de DSH (sección 5).
3. **Una frase** (contraseña) para la bóveda. En la primera instalación la herramienta puede
   generarla; si la generás vos, que sea larga: es el único secreto que protege todo.
4. Opcional: un **pendrive** para llevar la bóveda a otra máquina.

## 5. Instalación, paso a paso

### 5.1 Instalar el plugin

En una terminal, dentro del perfil de DSH:

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add dsh-history-keeper@latest
```

Si tu instalación de DSH trae el comando de plugins, también sirve:

```powershell
dsh plugin --profile desktop add dsh-history-keeper
```

**Reiniciá DSH.** El plugin se carga al arrancar; hasta que no reinicies, la conversación no lo ve.

### 5.2 Crear la bóveda

En el chat, escribí:

```text
/keeper init
```

Qué esperar: crea la bóveda en `~/.dsh/history-keeper` y te dice si generó una frase o si usó una que
ya tenías configurada. **Anotá dónde queda la frase** (si la generó, guardala en un lugar seguro y
fuera de la computadora).

### 5.3 Comprobar que quedó bien

```text
/keeper status
```

Te va a mostrar qué tiene la bóveda, qué falta publicar y si esta máquina tiene todo. Si dice
`published 0 session(s)`, todavía no capturó nada: seguí usando DSH normalmente y volvé a mirar.

## 6. El día a día: no hacés nada

Con DSH abierto, el plugin captura solo cuando la conversación se “vacía” al disco, verifica lo que
escribió y, cuando corresponde, compacta y libera espacio. No hay que acordarse de nada.

Cada tanto, si querés tranquilidad:

```text
/keeper verify
```

`ok` significa que todos los archivos están completos y coinciden con sus hashes. Si alguna vez no
dice `ok`, **no sigas trabajando**: anotá el código que aparece y buscá ayuda (sección 12).

## 7. Llevar el historial a otra computadora

Hay dos maneras. Las dos empiezan igual: **con el pendrive conectado**.

### 7.1 La forma directa (dos pasos)

En la PC que **envía** (podés dejar DSH abierto: esto sólo lee):

```powershell
$node = 'C:\Program Files\nodejs\node.exe'   # o el node que uses
$cli  = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-history-keeper\bin\keeper.js"
& $node $cli export --to F:\keeper-transfer
```

En la PC que **recibe**, **con DSH cerrado**:

```powershell
& $node $cli import --from F:\keeper-transfer --stick-key <archivo con la frase>
```

Al abrir DSH, las conversaciones que faltaban aparecen.

### 7.2 La forma “dejarlo listo” (buzón)

Si no querés importar en ese momento:

```powershell
& $node $cli import --stage F:\keeper-transfer --stick-key <archivo con la frase>
```

Eso deja la bóveda en un “buzón”. La próxima vez que abras DSH, el plugin la importa solo y **borra la
copia temporal** al terminar.

### 7.3 Deshacer

Si importaste y no querías ver esas conversaciones:

```text
/keeper undo
```

Quita del historial de esta máquina lo que el import agregó. **No borra la historia de la bóveda**:
eso queda, y es lo correcto. Tenés **7 días**, o hasta que hagas un export, para arrepentirte.

## 8. Recuperar todo en una computadora nueva

Esta es la promesa central: **bóveda + frase = historial**.

1. Instalá DSH y el plugin (sección 5.1).
2. Copiá la carpeta `vault` del pendrive a `~/.dsh/history-keeper`.
3. Poné la frase en un archivo temporal.
4. Validá y restaurá, **con DSH cerrado**:

```powershell
& $node $cli conform --store "$env:USERPROFILE\.dsh\history-keeper" --key-file C:\temp\frase.txt
& $node $cli restore --store "$env:USERPROFILE\.dsh\history-keeper" --home "$env:USERPROFILE\.dsh" --key-file C:\temp\frase.txt
```

5. Abrí DSH: las conversaciones están ahí.
6. **Borrá el archivo temporal de la frase.**

## 9. Sacar una conversación a texto

A veces querés leer una charla en otro lado, o pasársela a alguien. Hay tres formatos:

```powershell
# texto legible (se abre en Notepad, con títulos y turnos)
& $node $cli extract --session <id> --out C:\temp\charla.md

# el registro fiel, una línea por evento
& $node $cli extract --session <id> --out C:\temp\charla.jsonl --jsonl

# el archivo exacto de la sesión (para devolverlo a sessions/)
& $node $cli extract --session <id> --out C:\temp\charla.jsonl.zstd --raw
```

El `<id>` lo saca `keeper catalog`. Tres advertencias que no son burocracia:

- **El archivo de texto NO está cifrado.** Es una copia en claro: borralo cuando termines.
- La herramienta **se niega a escribirlo dentro de la bóveda** o del árbol de sesiones.
- Si el texto contiene algo que parece una contraseña o una clave, **se niega a escribirlo** salvo
  que insistas con `--force`. Pensalo dos veces antes de insistir.

## 10. Mantenimiento (una vez cada tanto)

| Cuándo | Qué hacer | Cómo |
|---|---|---|
| Querés saber cómo está | informe de espacio y restos | `keeper doctor` |
| La bóveda ocupa más de lo que debería | compactar y reclamar | `keeper compact` y `keeper gc --yes`, **con DSH cerrado** |
| Una bóveda de una versión vieja | actualizarla sin tocar la historia | `keeper upgrade` |
| Querés validar una copia antes de confiar en ella | conformidad | `keeper conform --store <copia>` |

El número que importa es el **ratio**: bytes de la bóveda ÷ bytes de las sesiones. Debe quedar por
debajo de **1,1**. `doctor` lo muestra.

## 11. La frase: lo único que no se puede perder

- Vive en un archivo (por ejemplo `Documents\Secretos-DSH\passphrase.txt`) o en la variable
  `KEEPER_PASSPHRASE`.
- **No viaja en el pendrive** (salvo que la pongas a propósito, y entonces hay que borrarla).
- **No hay recuperación.** Si la perdés, la bóveda es ilegible para siempre.
- Guardá una copia **fuera** de la computadora y **fuera** de la bóveda: papel en un cajón, o un
  gestor de contraseñas.
- Cuanto más larga, mejor. Una frase de cinco o seis palabras es mucho más fuerte que doce
  caracteres.

## 12. Cuando algo sale mal

| Lo que ves | Qué significa | Qué hacer |
|---|---|---|
| `DSH is open on this machine` | intentaste una operación de mantenimiento con DSH abierto | cerrá DSH y repetí |
| `wrong passphrase for this store` | la frase no es la de esa bóveda | revisá mayúsculas y espacios; compará la huella que muestra |
| `no keeper store at ...` | la bóveda no está en esa ruta | revisá la ruta; si copiaste del pendrive, ¿copiaste `vault` completa? |
| `verify` no dice `ok` | un archivo se dañó | no sigas escribiendo; buscá una copia sana (otra PC o un `.replaced-*`) |
| `the vault requires format ... or newer` | el plugin de esta máquina es más viejo que la bóveda | actualizá el plugin |
| `the drop box is not empty` | quedó una copia de un intento anterior | `keeper import` la reutiliza; si no, borrala |
| `the import failed and the previous state was restored` | el merge encontró algo inconsistente | no se perdió nada; la copia quedó en `.failed-<fecha>` |

## 13. Preguntas frecuentes

**¿Se sincroniza sola entre mis computadoras?**
No. La bóveda viaja cuando vos la llevás en el pendrive. Es una decisión, no una limitación
pendiente: sin red no hay servidor que atacar.

**¿Puedo usar la misma bóveda desde dos computadoras a la vez?**
Podés tener la misma bóveda en las dos, pero **no escribiendo a la vez**. Se usa una, se lleva, se
importa en la otra.

**¿Qué pasa si continúo la misma conversación en dos máquinas?**
La herramienta no elige por vos: conserva la línea del equipo dueño y **archiva** la otra. Ambas
quedan guardadas; la archivada no se restaura encima.

**¿Cuánto ocupa?**
Poco más que las sesiones: en la bóveda real, 16,91 MB para 15,97 MB de conversaciones (ratio
1,059). Los objetos son inmutables y el espacio que sobra se reclama.

**¿Puedo borrar la bóveda?**
Sí, pero perdés el historial que no esté en el árbol de sesiones de DSH. Si dudás, exportá primero.

**¿La bóveda se puede abrir sin la frase?**
No. Los objetos están cifrados con AES-256-GCM y la clave sale de la frase con scrypt.

**¿Qué datos se ven sin la frase?**
Los metadatos de `meta.json`: identificador de la bóveda, nombre del equipo, cantidad de manifiestos
y política de retención. No los nombres de tus proyectos ni el contenido de las conversaciones.

**¿Puedo mover la bóveda de carpeta?**
Sí: es una carpeta. Después decile al plugin dónde está (configuración `store`) y verificá con
`keeper conform`.

**¿Qué pasa si pierdo el pendrive?**
Quien lo tenga ve sólo archivos cifrados. Si además llevaba la frase, ahí sí tiene todo: por eso la
frase viaja sólo cuando hace falta y se borra.

**¿Puedo extraer una conversación y mandarla por correo?**
Podés, pero es texto plano: cualquiera que lo reciba lo lee. Es una decisión tuya y explícita.

**¿Funciona si nunca abro DSH?**
La CLI funciona sola, pero no captura: la captura la hace el plugin mientras DSH escribe sesiones.

**¿Necesita internet?**
No. Ni para capturar, ni para verificar, ni para viajar.

**¿Qué pasa si apago la máquina en medio de una captura?**
El próximo arranque retoma: nunca se publica una parte incompleta de una conversación, y la última
parte se captura cuando está entera.

**¿Puedo borrar conversaciones viejas de la bóveda?**
No por ahora: la bóveda es un archivo de historia, no un gestor. Si querés espacio, compactá y
reclamá; si querés privacidad, borrá la bóveda y creá otra.

**¿Cómo sé qué versión tengo?**
`keeper capabilities` (o `/keeper status`). La última publicada está en npm.

## 14. Glosario

| Palabra | Qué es |
|---|---|
| **bóveda** | la carpeta cifrada donde vive el historial |
| **frase** | la contraseña que la protege; la única que hay |
| **sesión** | una conversación, tal como DSH la guarda |
| **captura (snapshot)** | el momento en que el plugin copia lo nuevo |
| **verificar (verify)** | comprobar que nada se alteró |
| **restaurar (restore)** | devolver las conversaciones al historial de DSH |
| **exportar / importar** | llevar la bóveda a un pendrive / traerla |
| **buzón** | carpeta donde queda una bóveda para que DSH la importe al arrancar |
| **compactar** | reemplazar la cadena de cambios por un único punto de control |
| **reclamar (gc)** | borrar los archivos que ya nadie referencia |
| **extraer** | sacar una conversación a texto, a JSONL o al archivo exacto |

## 15. La promesa, y sus límites

**Promete**: que tu historial no se pierde por un borrado o una corrupción del programa; que se
puede llevar a otra máquina y volver; que ocupa lo que debe; que se puede leer fuera del programa si
vos lo pedís.

**No promete**: recuperar una frase olvidada; proteger una máquina desbloqueada; arreglar errores del
propio DSH; sincronizar sin que vos lleves la bóveda.

Si algo de esto no se cumple, es un error y nos interesa saberlo.
