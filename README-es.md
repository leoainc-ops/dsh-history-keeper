# dsh-history-keeper

**Tu historial de DeepSeek Harness vuelve — y podés comprobarlo.**

*English: [README.md](README.md)*

> **Estado: pre-alfa (0.1.0 en curso).** El motor funciona: `snapshot`, `verify` y
> `restore` operan sobre logs reales de DSH, validados byte a byte en 8 sesiones. La
> integración con el host y el sync en vivo son los próximos hitos.

## El problema

Tus conversaciones viven en un solo lugar: `~/.dsh/sessions` en una sola máquina. Si esa
máquina muere, se mueren con ella. No queda copia, ni forma de comprobar que la copia que
tenés está intacta.

`dsh-history-keeper` existe para resolver eso: capturar el historial, cifrarlo,
verificarlo y restaurarlo byte a byte.

## Qué va a hacer

| Hito | Entrega |
|---|---|
| **0.1** | `snapshot`, `verify` y `restore` desde una carpeta compartida, con la CLI funcionando sin DSH abierto |
| **1.0** | sync en vivo entre máquinas, manifiestos por dispositivo, conflictos explícitos, vinculación y revocación de dispositivos |

## Probalo ahora (desde un checkout)

La CLI no necesita más que Node: ni DSH, ni git, ni binarios externos.

```sh
export KEEPER_PASSPHRASE='una frase de al menos 8 caracteres'

node bin/keeper.js init     --store ./vault
node bin/keeper.js snapshot --store ./vault --home ~/.dsh
node bin/keeper.js verify   --store ./vault
node bin/keeper.js restore  --store ./vault --home /tmp/restored-home
```

`restore` reproduce el layout del host bajo `sessions/`, verifica cada hash y nunca
sobrescribe un log existente.

## Uso dentro de DSH

Instalá el bundle y corré `/keeper init` una vez, en cualquier conversación. Eso es todo: crea la bóveda (por defecto `~/.dsh/history-keeper`), genera una frase si no elegiste una, y la escribe en `~/.dsh/history-keeper.key`. No hace falta editar el patch del perfil; el YAML de abajo sólo sobrescribe los valores por defecto.
El YAML de abajo sobrescribe los valores por defecto:

```yaml
- insert:
    - id: history-keeper
      name: dsh-history-keeper
      config:
        store: C:\Users\vos\keeper-vault         # por defecto: ~/.dsh/history-keeper
        sessionsRoot: C:\Users\vos\.dsh\sessions # por defecto: ~/.dsh/sessions
        autoSnapshotOnFlush: true                # capturar al cerrar cada turno
        debounceMs: 2000                         # espera antes de ejecutar la captura
        snapshotMinIntervalMs: 30000             # agrupa una ráfaga de turnos (0 lo desactiva)
        maxChunkBytes: 1048576                   # tamaño objetivo; los frames nunca se parten
        secretScan: true                         # cuarentena si parece haber una credencial
        secretScanAllow: []                      # ids de reglas a ignorar, p. ej. [openai-key]
        secretScanEntropy: false                 # cadenas largas de alta entropía (ruidoso)
        captureAttachments: true                 # capturar los blobs que las sesiones referencian
        autoCompact: true                        # checkpoint cuando la política lo apruebe
        compactMinManifests: 50                  # manifiestos desde el último checkpoint antes de actuar
        keyFile: C:\Users\vos\.dsh\history-keeper.key
        passphraseFile: null                     # gana sobre el archivo de clave y sobre la variable
        passphraseEnv: KEEPER_PASSPHRASE
        deviceName: mi-notebook
```

La frase de paso nunca va en el patch: sale de `passphraseFile`, del archivo de clave que crea
`init`, o de `KEEPER_PASSPHRASE`. Después, en una conversación:

```text
/keeper init       crear la bóveda (genera una frase si no hay ninguna configurada)
/keeper status     qué tiene la bóveda, qué falta publicar, qué le falta a esta máquina
/keeper snapshot   capturar ahora los bytes nuevos
/keeper verify     revisar cada objeto, hash y cadena
/keeper help
```

### Filtro de secretos

Una captura nunca publica una sesión cuyos bytes nuevos parezcan contener una credencial. El
filtro **pone en cuarentena**, no redacta: reescribir rompería la promesa de exactitud byte a
byte. De esa sesión no se escribe nada, y `/keeper snapshot` informa la regla y la línea,
nunca el valor. Se puede publicar igual con `--force`, o silenciar una regla con
`--allow-rule <id>`.

Detecta secretos estructurados (claves de API, tokens, asignaciones de clave, bloques de clave
privada). Una contraseña escrita en prosa **no** es detectable por patrón: el filtro es una red
de seguridad, no una garantía.

`restore` **no** está disponible dentro de DSH a propósito: escribe el store de sesiones
vivo y un host en ejecución no lo notaría. Sigue siendo una operación de la CLI, con DSH
cerrado — que es justamente el punto de una herramienta de recuperación.

### Configuración mínima

Todas las claves son opcionales. Sin `config`, el plugin busca la bóveda en
`~/.dsh/history-keeper`, lee las sesiones de `~/.dsh/sessions`, y te dice cómo crear la
bóveda si no existe.

Las marcas de tiempo se guardan en UTC (un instante tiene que ser inequívoco entre
máquinas) y se muestran en tu zona horaria local junto al desfase.
## Principios de diseño

1. **Sin binarios externos.** Sólo `node:` — ni `git`, ni `age`, nada que instalar.
2. **Falla cerrado.** Sin clave no se sincroniza. Un conflicto nunca escribe. El cifrado nunca degrada a texto plano.
3. **Nunca sobrescribir, nunca borrar.** El restore sólo crea; lo que ya existe y difiere se aparta.
4. **Append-only y verificable.** Cada objeto es inmutable y se nombra por su contenido; la cadena de chunks permite auditar la integridad incluso sin la clave.
5. **Copias por dispositivo**, nunca un archivo mutable compartido.
6. **El transporte es tonto.** Una carpeta (o cualquier proveedor) sólo mueve blobs: no interpreta, no ordena, no fusiona.
7. **Auditable por vos.** `verify` y un reporte legible: no tenés que confiar en nosotros.

## Privacidad

El historial se cifra antes de salir de la máquina, y los metadatos también: los nombres y
tamaños de archivo no revelan en qué proyectos trabajás. Sin la clave, el almacén es
opaco. No hay servidor ni cuenta.

## Instalación

Todavía no está publicado. Cuando salga 0.1:

```sh
dsh plugin --profile web add dsh-history-keeper
```

## Compatibilidad

Desarrollado contra DeepSeek Harness `0.2.0-rc.2`. El bundle declara `engines.dsh`, así
que un host incompatible lo rechaza en lugar de comportarse mal.

## Desarrollo

```sh
node --test "test/*.test.mjs"   # tests unitarios, sin dependencias que instalar
npm run guard                   # rechaza logs de sesión commiteados
```

Diseño y hoja de ruta: [`docs/`](docs/). Historial de versiones, incluidas las que nunca se
publicaron y por qué: [CHANGELOG.md](CHANGELOG.md).

## Licencias

Este repositorio utiliza un modelo de licencias dividido:

- **Código fuente** (`bin/`, `lib/`, `scripts/`, `test/`, `package.json`, `cordis.patch.yml`): licenciado bajo **PolyForm Noncommercial License 1.0.0**. Ver [`LICENSE-CODE`](LICENSE-CODE).
- **Documentación** (`README.md`, `README-es.md`, `CHANGELOG.md`, `docs/`): licenciado bajo **CC BY-NC 4.0**. Ver [`LICENSE-DOCS`](LICENSE-DOCS).

El uso comercial del código fuente no está permitido sin permiso explícito del autor.

### Historial de licencias

Las versiones `0.1.0-rc.1` a `0.1.0-rc.7` se publicaron bajo **MIT** y siguen disponibles bajo
MIT para quien las haya obtenido. El modelo dividido rige desde `0.1.0-rc.9`; `0.1.0-rc.8` se
publicó con metadata MIT por error y está deprecada. No hay forks del proyecto al 2026-10-24.
Cronología completa, estado de forks y condiciones para contribuir:
[`LICENSING-HISTORY.md`](LICENSING-HISTORY.md).
