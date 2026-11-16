---
id: "04"
titulo: "Contrato del producto"
estado: aprobado
version: "1.0"
depende_de: ["01", "03"]
alimenta_a: ["06", "07", "09", "10", "11", "12", "16", "18"]
ultima_revision: "2026-11-11"
---

# 04 — Contrato del producto

Este documento es **vinculante**. Cualquier especificación que lo contradiga está mal. Modificarlo
exige una versión mayor del software (`18`) y una revisión registrada en `21`.

Hay dos zonas, y la frontera es lo que hace que el producto sea lo que es:

- **Invariantes** (C1–C6): no se relajan nunca, ni para el cliente más chico.
- **Negociable** (D1–D5): ceremonia, avisos y defaults. Se ajusta a favor de la fluidez.

---

## C1 — Integridad

**Enunciado.** Lo que se entrega es exactamente lo archivado: cada chunk verifica `plainSha256`,
`prefixSha256` y `endSha256`; el último `endSha256` es el hash del archivo completo; el objeto
cifrado coincide con el `cipherSha256` que lo referencia.

**Alcance.** Aplica a modo `archivo`. En modo `uso` la integridad se mide sobre el **sello de
contenido** (C6), porque el archivo lo escribe DSH y sus bytes difieren.

**Prueba.** `TC-1`: restituir una bóveda de referencia y comparar byte a byte; alterar un objeto y
verificar que falla con código.

**Si se viola.** El producto deja de ser un archivo y pasa a ser una copia.

## C2 — La frase se comprueba antes de escribir

**Enunciado.** Una frase equivocada falla con `wrong passphrase` **antes** de crear, publicar, mover
o borrar nada.

**Alcance.** Toda operación que escriba, en los dos modos, incluida la creación de una sesión nativa.

**Prueba.** `TC-2`: abrir con frase incorrecta y comparar el árbol de sesiones, el journal y la
bóveda contra una instantánea previa: deben ser idénticos.

**Si se viola.** Un error de tipeo deja el home a medio escribir.

## C3 — Nada existente se reemplaza

**Enunciado.** Ni un log de sesión, ni un adjunto, ni un manifiesto se sobrescriben con contenido
distinto. Un conflicto se resuelve con un id nuevo, con un rechazo, o archivando lo existente; nunca
escribiendo encima.

**Alcance.** Incluye: no reemplazar un adjunto con el mismo nombre y distinto contenido
(`ATTACHMENT_CONFLICT`), no mover de lugar una sesión existente, no reescribir un manifiesto.

**Prueba.** `TC-3`: importar dos veces la misma bóveda; importar una versión divergente; adjuntar
dos blobs distintos con el mismo hash declarado. Comparar hashes antes y después.

**Si se viola.** "No perder nada" se convierte en "perder algo en silencio".

## C4 — Ante corrupción, se falla cerrado

**Enunciado.** Estas condiciones abortan la entrega con código y sin escribir el resultado parcial:
frame completo inválido, `HASH_MISMATCH`, `MISSING_OBJECT`, `CHAIN_FAILED`, `SEQ_GAP`, `BYTE_GAP`,
`FRAME_GAP`, `PREFIX_MISMATCH`, `PLAINTEXT_MISMATCH`, `END_MISMATCH`, `LENGTH_MISMATCH`,
`HEADER_MISMATCH`, `HEADER_INVALID`.

**Frontera.** Una **cola truncada** (último frame incompleto) no es corrupción: es recuperable, se
descarta y se informa. Un frame **completo** inválido sí lo es.

**Prueba.** `TC-4`: fixtures con objeto borrado, byte alterado, frame truncado y cadena cortada.

**Si se viola.** Se entrega una conversación a medias que parece entera.

## C5 — El formato no cambia

**Enunciado.** `store/1` se sigue leyendo y escribiendo; sólo se agregan campos opcionales, y un
lector anterior debe poder abrir lo nuevo. `minReader` no sube en 2.0.

**Prueba.** `TC-5`: bóveda escrita por 2.0 leída por 1.0.2 y viceversa; `conform` en las dos
direcciones.

**Si se viola.** Obligamos al usuario a migrar su archivo, que es lo único que no se puede perder.

## C6 — Toda entrega deja procedencia

**Enunciado.** Cada operación registra de qué bóveda (`storeId`), de qué dispositivo (`deviceId`),
con qué huella de contenido (`endSha256` de origen) y en qué modo se entregó; ese registro acompaña
al recibo.

**Alcance.** Obligatorio en modo `uso`, donde el archivo entregado no es idéntico al original. En
modo `archivo` se registra igual, como refuerzo.

**Prueba.** `TC-6`: importar en modo `uso`, re-extraer el original de la bóveda, recalcular el sello
y comparar.

**Si se viola.** El modo `uso` vuelve a ser "confiá en mí".

---

## Zona negociable

| # | Qué | Default 2.0 | Por qué |
|---|---|---|---|
| D1 | Verificación | automática e invisible; se reporta sólo si falla | la garantía no cambia, se deja de pedir permiso |
| D2 | Preflight de vocabulario | tolerante: importa y advierte | bloquear una sesión legible cuesta datos (falso negativo) |
| D3 | Escaneo de secretos | aviso, no cuarentena | el usuario decide; el bloqueo silencioso es peor |
| D4 | Entorno de importación | no exige home vacío | la regla de no sobrescribir ya protege |
| D5 | Cerrar DSH | no hace falta en modo `uso` | el plugin es el escritor legítimo |

`strict` restaura los defaults de 1.0.2 para D1–D5. Ver `12`.

## Reglas de cambio

1. Cambiar un invariante (C1–C6) = versión mayor + revisión de `21`.
2. Cambiar el default de D1–D5 = versión mayor si altera qué se bloquea; menor si sólo agrega.
3. Agregar un invariante requiere una prueba `TC-n` antes de aprobarse.
4. El contrato se versiona aparte: `contract/1`. Un cambio incompatible produce `contract/2`.

## Preguntas abiertas

- Ninguna. Las dudas sobre cómo se implementa cada cláusula van a `06`, `07`, `10` y `11`.

## Qué sigue

`05-GLOSARIO-Y-CONVENCIONES.md` para fijar el vocabulario con el que se escriben las
especificaciones.
