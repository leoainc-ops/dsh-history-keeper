---
id: "08"
titulo: "Trazado y restitución"
estado: aprobado
version: "1.0"
depende_de: ["04", "07"]
alimenta_a: ["10", "11", "16"]
ultima_revision: "2026-11-11"
---

# 08 — Trazado y restitución

La pregunta que responde este documento: **¿de dónde salió cada elemento de la bóveda y a dónde
vuelve?** La respuesta tiene que alcanzar para restituir sin el plugin, leyendo sólo la bóveda.

El detalle experimental (disección de una bóveda real, byte por byte) está en
[`anexos/B-TRAZADO-DETALLADO.md`](anexos/B-TRAZADO-DETALLADO.md). Acá va lo normativo.

## La regla

**La bóveda no guarda rutas: guarda los ingredientes de la ruta.**

| Clase | Qué es | ¿Se restituye? |
|---|---|---|
| Datos de sesión | chunks de un log `.jsonl.zstd` | sí, byte por byte |
| Blobs de adjuntos | contenido de una imagen/archivo | sí, byte por byte |
| Índices | `meta.json`, manifiestos, `devices/*.json` | no: son el mapa |

## Mapa elemento → origen → destino

| Elemento | Se reconoce por | Origen | Destino |
|---|---|---|---|
| chunk | `sessions[<sid>].chunks[seq]` | `sessionsRoot\<projectKey(cwd)>\<sid>\session.v<N>.jsonl.zstd`, bytes `[byteFrom, byteTo)` | mismo archivo, mismo offset |
| adjunto | `attachments[<sha256>]` | `attachmentsRoot\v1\objects\<h[0:2]>\<h>` | mismo path (sale del hash) |
| manifiesto | puntero de `meta.manifest` o `devices/*.json` + `prev` | — | — |
| device head | nombre = `deviceId` | — | — |

## Algoritmo de restitución (modo `archivo`)

```text
1. meta = meta.json
   clave = scrypt(NFKC(frase), salt, N, r, p, 32)
   si !keyCheck(clave) → "wrong passphrase"           (C2: antes de escribir)

2. cabezas = [meta.manifest] + [d.head de devices/*.json]
   recorrer prev desde cada una, deduplicar por id, ordenar por seq

3. por sesión: unir chunks sin duplicar por seq (el primero visto es el vigente;
   un manifiesto con reset[sid] invalida los anteriores para esa sesión)

4. ordenar chunks por seq y verificar, en orden:
      seq contiguo · byteFrom == bytes · frameFrom == frames
      prefixSha256 · plainSha256 · endSha256 · cipherSha256 · cipherBytes
   concatenar → log ; exigir len(log) == último byteTo

5. destino = <home>\sessions\<projectKey(header.cwd)>\<sid>\session.v<formatVersion>.jsonl.zstd
   escribir sólo si no existe algo distinto              (C3)

6. por adjunto: descifrar, verificar sha256 y bytes, escribir en
   <home>\attachments\v1\objects\<h[0:2]>\<h> si falta   (C3)

7. archived[] se verifica y NO se escribe.
```

## `projectKey`

La única función no obvia del trazado. Idéntica en DSH y en el keeper:

```js
function projectKey(cwd) {
  let readable = '', separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i), ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') { if (!separatorRun) readable += '-'; separatorRun = true }
    else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) { readable += ch; separatorRun = false }
    else { readable += '~' + code.toString(16).toUpperCase().padStart(4, '0'); separatorRun = false }
  }
  return '--' + ((readable.replace(/^-+/, '') || 'root').slice(0, 251)) + '--'
}
```

`cwd` nulo → `_no-cwd`. La normalización es con pérdida: dos `cwd` distintos pueden compartir
carpeta, y el `sessionId` es lo que los separa.

## Sello de contenido

Para modo `uso`, donde los bytes cambian (`11`), la equivalencia se mide así:

```text
sello = sha256( por cada evento en orden:
                  type + "\u0000" + seq + "\u0000" + time + "\u0000" + json_canónico(data) )
```

Se calcula al leer la bóveda y otra vez al releer la sesión publicada. Deben coincidir. No sustituye
a C1 en modo `archivo`: lo complementa en modo `uso`.

## Perturbaciones que el trazado soporta

| Situación | Efecto |
|---|---|
| capturas sucesivas | chunks nuevos con `seq` creciente; mismo destino |
| importación | re-sellado con ids nuevos; posiciones y hashes intactos |
| compactación | un checkpoint con todos los descriptores, `prev:null`, `covers` |
| `gc` | borra manifiestos viejos; el checkpoint los cubre |
| divergencia | la perdedora va a `archived`; se verifica, no se restituye |
| `reset` | invalida el linaje anterior de esa sesión |
| cola rota | no se publica; el destino queda con el último prefijo confirmado |
| corrupción | C4: se aborta todo, no se escribe parcial |

## Lo que el trazado no puede devolver

Agrupación y orden (`workspace.json`), caché de proyección, pin/archivado del panel, títulos
derivados, credenciales y perfiles. Por eso el modo `uso` existe: para que DSH reconstruya lo que la
bóveda no guarda (`09`, `11`).

## Preguntas abiertas

- ¿El sello canónico incluye `data` completo o sólo los campos con contenido semántico? Dueño:
  arquitectura. Propuesta: completo, con claves ordenadas; es más simple de auditar.

## Qué sigue

`09-INTEGRACION-DSH.md`: qué servicios del host se usan para que la restitución sea nativa.
