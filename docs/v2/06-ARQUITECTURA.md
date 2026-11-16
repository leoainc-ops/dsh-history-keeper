---
id: "06"
titulo: "Arquitectura"
estado: aprobado
version: "1.0"
depende_de: ["04", "05"]
alimenta_a: ["07", "09", "10", "11", "15"]
ultima_revision: "2026-11-11"
---

# 06 — Arquitectura

## La forma

Dos capas y una regla: **el núcleo no conoce DSH; el adaptador no conoce el cifrado.**

```text
                    ┌──────────────────────────────────────────┐
   superficies      │ CLI · comandos / · tool del agente       │
                    └───────────────────┬──────────────────────┘
                                        │ operaciones (plan/apply)
                    ┌───────────────────▼──────────────────────┐
   adaptador        │ host/                                    │
   (DSH)            │  publish-native · publish-files ·        │
                    │  workspaces · attachments · policy       │
                    └───────────────────┬──────────────────────┘
                                        │ interfaces del núcleo
                    ┌───────────────────▼──────────────────────┐
   núcleo           │ core/                                    │
   (sin DSH)        │  vault · crypto · chunks · manifests ·   │
                    │  verify · plan · journal · receipt       │
                    └──────────────────────────────────────────┘
```

La flecha importa: el adaptador llama al núcleo, nunca al revés. Un `import` de `core` en `host` es
legal; un `import` de `host` en `core` es un error de arquitectura que la revisión debe rechazar.

## Mapa de módulos

| Módulo | Responsabilidad | Depende de |
|---|---|---|
| `core/vault.js` | abrir/crear bóveda, leer/escribir meta, cabezas, manifiestos | crypto, store |
| `core/crypto.js` | scrypt, sobres `DKO1`, `keyCheck` | — |
| `core/chunks.js` | escaneo de frames, corte, cadena de hashes | — |
| `core/verify.js` | recorrido y verificación completa; `collectSessions` | vault, chunks |
| `core/plan.js` | convierte una bóveda en un **plan** de entrega (sin efectos) | vault, verify |
| `core/journal.js` | registra lo creado; sostiene `undo` | — |
| `core/receipt.js` | arma el recibo desde el reporte | — |
| `host/publish-files.js` | modo `archivo`: escribe logs y adjuntos | core, fs |
| `host/publish-native.js` | modo `uso`: crea y publica sesiones en DSH | core, sessionPersistence |
| `host/workspaces.js` | resuelve/crea workspace y adjunta la sesión | core, workspaceRegistry |
| `host/attachments.js` | publica blobs por hash | core, attachments/fs |
| `host/policy.js` | resuelve `strict`/`default`/`relajado` | core |
| `host/capabilities.js` | detecta servicios del host y decide el modo posible | — |
| `plugin/index.js` | monta el servicio, comandos y tool | host |
| `bin/keeper.js` | CLI: sólo habla con `core` y `host/publish-files` | host |

## La operación, en dos fases

Toda operación que escribe tiene la misma forma. Es la decisión estructural más importante después
de la separación de capas: permite previsualizar, permite que el agente decida, y hace el `apply`
idempotente.

```text
plan(input) → {
  modo,                       // "archivo" | "uso"
  sesiones: [ { id, cwd, estado: nueva|identica|divergente|incompatible|sin_cwd,
                bytes, chunks, sello, origen } ],
  adjuntos: [ { hash, bytes, estado, origen } ],
  workspaces: [ { path, accion: usar|crear|omitir } ],
  avisos: [ … ],              // lo que en strict sería bloqueo
  bloqueos: [ … ],            // lo que no se puede hacer ni en relajado
  estimacion: { sesiones, bytes, minutos }
}

apply(plan) → {
  creadas, identicas, omitidas, rechazadas, adjuntos, workspaces,
  sello_verificado: true|false, recibo
}
```

Reglas del plan:

1. **Sin efectos.** Un `plan` no escribe ni crea nada, ni en la bóveda ni en el home.
2. **Completo.** Todo lo que `apply` va a hacer está en el plan; nada se decide después.
3. **Compatible con `strict`.** El plan ya marca `bloqueos` y `avisos` según la política: `apply`
   no reinterpreta la política.
4. **Repetible.** Planificar dos veces la misma entrada produce el mismo plan (salvo el estado
   cambiante del host).

## Detección de capacidades

`host/capabilities.js` es el seguro contra la evolución de DSH. Expone:

```text
capabilities() → {
  dsh: "0.2.2-rc.1",
  sessionPersistence: true,   // create/append/flush/stat/list/open
  workspaceRegistry:   true,  // resolveByPath/create/attachSession
  attachments:         "batch" | "generic" | false,
  modos: ["archivo", "uso"],
  motivoDeRepliegue: null | "sin sessionPersistence" | ...
}
```

Regla: **si una capacidad falta, el modo que la necesita no se ofrece**. No se simula, no se degrada
en silencio: se informa y se cae a `archivo`. Es lo que permite que el plugin se instale en un DSH
futuro sin romperse.

## Flujo de una entrega

```text
1. capabilities()            ¿qué puedo hacer acá?
2. core/vault.open()         frase, meta, cabezas
3. core/verify.collect()     reconstruir sesiones y adjuntos verificados
4. core/plan.build()         clasificar y decidir
5. host/policy               filtrar avisos y bloqueos
6. host/publish-*            escribir (archivo) o publicar (uso)
7. core/journal.record()     registrar lo creado
8. core/receipt.emit()       recibo con sellos y procedencia
```

## Errores

- El núcleo lanza errores con `code` (los de `C4`) y **nunca** imprime.
- El adaptador traduce `code` a mensaje según `05` (qué pasó / qué no se tocó / qué hacer).
- Una falla en el paso 6 deja journal vacío para esa sesión: no hay estado a medias.

## Qué se conserva de 1.0.2

Los módulos de bóveda, cifrado y chunks se **mueven** a `core/` sin cambios de comportamiento. El
refactor de la Fase 0 no agrega features: mueve archivos y fija interfaces. Cualquier tentación de
"aprovechar para mejorar" en esa fase se rechaza: la fase existe para poder probar el resto.

## Preguntas abiertas

- ¿`core/plan.js` conoce el modo, o el plan lo recibe como parámetro? Dueño: arquitectura. Impacto:
  si lo conoce, el plan puede clasificar mejor; si no, es más puro. Propuesta: lo recibe.
- ¿El journal vive en el `home` de DSH o junto a la bóveda? Dueño: arquitectura. Propuesta: en el
  `home`, porque describe efectos sobre el `home`.

## Qué sigue

`07-MODELO-DE-DATOS-BOVEDA.md` para el detalle de lo que el núcleo lee y escribe.
