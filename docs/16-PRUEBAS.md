---
id: "16"
titulo: "Pruebas"
estado: borrador
version: "0.8"
depende_de: ["04", "14", "15"]
alimenta_a: ["20"]
ultima_revision: "2026-11-11"
---

# 16 — Pruebas

El contrato (`04`) es el índice de la suite: **cada cláusula tiene un test con el mismo nombre**. Si
un test no existe, la cláusula no está garantizada.

## Pruebas de contrato

| ID | Cláusula | Qué hace | Cómo se ve el verde |
|---|---|---|---|
| TC-1 | C1 Integridad | restituye una bóveda de referencia y compara bytes; altera un objeto | igualdad byte a byte + `HASH_MISMATCH` al alterar |
| TC-2 | C2 Frase antes de escribir | abre con frase mala sobre un `home` con instantánea previa | árbol, journal y bóveda idénticos |
| TC-3 | C3 Nada se reemplaza | importa dos veces, importa una divergente, adjunta dos blobs con el mismo hash | hashes iguales antes/después; conflictos reportados |
| TC-4 | C4 Falla cerrado | fixtures: objeto borrado, byte alterado, frame truncado, cadena cortada | cada uno con su código; nada escrito |
| TC-5 | C5 Formato estable | bóveda de 2.0 leída por 1.0.2 y viceversa | `conform` en verde en las dos direcciones |
| TC-6 | C6 Procedencia | importa en `uso`, re-extrae el original y recalcula el sello | sellos iguales; recibo suficiente para repetirlo |

## Pruebas de requisito

| ID | Requisito | Fixture | Verifica |
|---|---|---|---|
| T-01 | RF-01 | bóveda nueva | creación, frase, `keyCheck` |
| T-02 | RF-02 | log con cola truncada | publica sólo frames completos |
| T-03 | RF-03 | bóveda de laboratorio | verificación completa y códigos |
| T-04 | RF-04 | bóveda + soporte vacío | export verifica y emite recibo sin frase |
| T-05 | RF-05 | bóveda ajena | import en `archivo` con verificación previa |
| T-06 | RF-06 | `home` con sesión idéntica y con divergente | no sobrescribe; escribe sólo lo nuevo |
| T-07 | RF-07 | 3 adjuntos (presente, faltante, conflictivo) | estados `present`/`created`/`conflict` |
| T-08 | RF-08 | bóveda de laboratorio | sesión creada con `id` original |
| T-09 | RF-09 | `cwd` existente y ausente | agrupa o queda Ungrouped, informado |
| T-10 | RF-10 | sesión importada en `uso` | sello origen == sello publicado |
| T-11 | RF-11 | recibo de una importación `uso` | procedencia completa y re-derivable |
| T-12 | RF-12 | cualquier operación | recibo de una página, sin contenido ni frase |
| T-13 | RF-13 | los tres perfiles | D1–D5 cambian comportamiento |
| T-14 | RF-14 | importación + `undo` | borra sólo lo creado |
| T-15 | RF-15 | host simulado sin servicios | repliegue a `archivo` sin error |
| T-16 | RF-16 | estado real | `status`/`doctor` responden sin abrir el log |

## Fixtures

| Fixture | Contenido | Uso |
|---|---|---|
| `lab-vault` | 1 sesión (481 B, 4 frames), 1 adjunto (900 B) | TC-1, T-03, T-08, T-10 |
| `golden-vault` | caso real: 11 sesiones, 10 adjuntos, 16 MiB | TC-1, TC-3, TC-5 |
| `corrupt-*` | objeto borrado, byte alterado, frame truncado, cadena cortada | TC-4 |
| `home-empty` / `home-dirty` | sin sesiones / con una sesión idéntica y una divergente | TC-2, TC-3, T-06 |
| `host-no-native` | doble del host sin `sessionPersistence` | T-15 |

Los fixtures viven en el repo, versionados, con su hash listado. Un fixture que cambia sin cambiar su
hash esperado es un bug de la suite.

## La regresión del caso real

El escenario de la Prueba A es la prueba de aceptación de F1:

```text
dado un home vacío, una bóveda de 11 sesiones y 10 adjuntos, y la frase correcta
cuando se ejecuta `keeper recover`
entonces  11 sesiones quedan restituidas (o listadas una por una con su motivo)
          y 10 adjuntos quedan presentes
          y ninguna sesión preexistente cambió de hash
          y el recibo dice 11 de 11
```

Cualquier versión que no pase esto no se publica.

## Matriz de interoperabilidad

| Línea | Lee bóveda 1.0.2 | Lee bóveda 2.0 | Escribe |
|---|---|---|---|
| 1.0.2 | sí | sí (campos aditivos) | `store/1` |
| 2.0 | sí | sí | `store/1` |

Se corre en CI con las mismas bóvedas doradas en las dos líneas (`18`).

## Cómo se corre

```text
npm test                unitarios
npm run test:contract   TC-1 … TC-6
npm run test:fixtures   T-01 … T-16
npm run test:interop    matriz de interoperabilidad
npm run test:e2e        escenario de la Prueba A
```

Sin red: toda la suite corre offline. Si un test necesita red, está mal diseñado.

## Definición de terminado de una prueba

- Falla antes del cambio y pasa después.
- Es determinista: dos corridas seguidas dan lo mismo.
- No imprime contenido de sesión ni la frase.
- Tiene un nombre que cita el contrato o el requisito (`TC-3`, `T-06`).

## Preguntas abiertas

- ¿La bóveda dorada puede vivir en el repo (16 MiB) o se genera desde un fixture sintético? Dueño:
  arquitectura. Propuesta: sintética para CI, real para la corrida de aceptación.

## Qué sigue

`17-OPERACIONES.md`: qué hacer cuando algo falla en la máquina de un usuario.
