# Filosofías

El formato de bóveda (`store/1`, ver `SPEC-vault.md`) no tiene opinión sobre cómo se usa el
historial. Las **filosofías** son esas opiniones. Una filosofía es un paquete de política: elige
entre linajes, decide cuándo se transporta, qué se retiene y qué se muestra. **No cambia un byte del
formato.**

## La línea que no se cruza

| | Filosofía de política | Filosofía de contrato |
|---|---|---|
| Cambia | qué linaje gana, cuándo se aplica, qué se retiene | el log, los ids, el contenido |
| ¿Comparte bóveda? | **sí** | **no** |
| Dónde vive | mismo repo, `packages/policies/<nombre>` | fork explícito, producto distinto |
| Requisito | pasa `npm run conformance` | debe declarar en su README que es **incompatible** |

Regla: **una política no puede inventar contenido.** Si necesita sintetizar o reescribir un log de
sesión, deja de ser una política.

## Catálogo

### 1. Conservadora — la de v1.0

- **Regla**: el linaje visible es el del dispositivo que introdujo la sesión (dueño). La otra rama se
  conserva **archivada**, verificada y reportada.
- **Transporte**: manual y explícito (`export` / `import`), con DSH cerrado para escribir.
- **Continuidad**: una sesión restaurada es de lectura; para seguir trabajando se abre una
  conversación nueva.
- **Optimiza**: que nada se pierda y que la lista de conversaciones sea una sola línea por sesión.
- **Costo**: el trabajo hecho en la máquina que no era dueña no aparece en la conversación visible.
- **Estado**: implementada (rc.31–rc.35). Decisión en `adr/0001-filosofia-conservadora.md`.

### 2. Convergente

- **Regla**: gana el linaje con el último evento; lo demás se archiva.
- **Transporte**: aplicar automáticamente al montar (con respaldo previo y posibilidad de volver).
- **Optimiza**: que "lo último que escribiste" sea lo que ves, sin pensar.
- **Costo**: el automatismo decide por vos; hay que confiar en la comparación de frescura.
- **Estado**: propuesta. Requiere resolver el *catch-up* de una sesión que creció en otra máquina.

### 3. Archivista

- **Regla**: todos los linajes son visibles y etiquetados por dispositivo y fecha.
- **Costo**: la lista se duplica; la regla del producto ("una conversación, una línea") se abandona.
- **Estado**: propuesta. Requiere que el host permita dos sesiones del mismo id (no lo permite:
  habría que reasignar id, y eso deja de ser byte-fiel).

### 4. Cero contacto

- **Regla**: nadie teclea comandos. Un lanzador hace pull al abrir DSH y push al cerrar.
- **Optimiza**: la experiencia; cumple el test de aceptación del proyecto.
- **Costo**: menos control; el viaje ocurre sin que lo veas (aunque con recibo y verificación).
- **Estado**: propuesta, detrás de E5 (scripts) y E5.1 (lanzador). No cambia el formato.

### 5. Retención estricta

- **Regla**: compactación agresiva, adjuntos opcionales, caducidad por antigüedad.
- **Optimiza**: espacio y privacidad.
- **Costo**: menos historial disponible; la caducidad es una decisión destructiva y debe ser
  explícita.
- **Estado**: propuesta; depende del borrado selectivo (agenda §9.9) y de la retracción (§9.8).

## Cómo se agrega una filosofía

1. Crear `packages/policies/<nombre>/` con su regla y sus pruebas.
2. Pasar `npm run conformance` sobre la bóveda de referencia.
3. Escribir su README con: regla, cuándo aplica, qué cambia, qué **no** hace, y su costo.
4. Registrar la decisión en `docs/adr/NNNN-<nombre>.md`.
5. Agregarla a la matriz de `COMPATIBILITY.md`.

## Cómo se descarta una idea que rompe el contrato

No se descarta en silencio: se documenta en `LESSONS.md` con el error observado, y si alguien quiere
insistir, la respuesta es "eso es un fork, y su bóveda no es esta bóveda". El caso de ejemplo es la
fusión de logs: tres intentos, tres rechazos del host (ver `LESSONS.md`).
