---
id: "14"
titulo: "Plan de entrega"
estado: aprobado
version: "1.0"
depende_de: ["04", "06", "11"]
alimenta_a: ["15", "16", "20"]
ultima_revision: "2026-11-11"
---

# 14 — Plan de entrega

Cinco fases. El orden no es por tamaño sino por **riesgo**: primero se habilita el resto (F0), después
se quita fricción (F1), luego se agrega lo que depende de terceros (F2), después el entregable que se
guarda (F3), y la capa C queda fuera de 2.0.

Cada fase se entrega completa: código, pruebas en verde, documento actualizado y recibo de ejemplo.

---

## F0 — Núcleo separado

**Objetivo.** Poder probar y reutilizar la bóveda sin DSH. Sin features nuevas.

**Alcance.**
- `core/` con vault, crypto, chunks, verify, plan; `host/` con adaptadores.
- Interfaces explícitas y detección de capacidades.
- Suite de regresión con la bóveda de laboratorio y una bóveda real.

**Criterio de aceptación.**
- `conform` da 7 de 7 en las dos bóvedas.
- La salida del CLI es idéntica a 1.0.2 para los comandos existentes.
- `capabilities()` informa el host y los modos posibles.
- `TC-1`, `TC-2`, `TC-4`, `TC-5` en verde.

**Riesgo.** Que el refactor cambie comportamiento sin que nadie lo note. Mitigación: comparación de
salidas contra 1.0.2 con las mismas bóvedas.

---

## F1 — Quitar ceremonia (el objetivo inmediato)

**Objetivo.** Que recuperar sea un comando, tolerante y con rastro.

**Alcance.**
- `recover` con plan/apply; verificación automática.
- Vocabulario tolerante con aviso; secretos como aviso.
- Journal, `undo`, recibo base.
- Política `strict`/`default`/`relajado`.

**Criterio de aceptación.**
- El caso de la Prueba A (11 sesiones, 10 adjuntos) se resuelve con **un** comando; las que no se
  pueden escribir se listan una por una.
- Ninguna sesión existente cambia de hash.
- `TC-3` y `T-01`…`T-07`, `T-13`, `T-14`, `T-16` en verde.

**Riesgo.** Que la tolerancia importe sesiones que el host no muestra bien. Mitigación: aviso
explícito por sesión y `--detail` con el motivo.

---

## F2 — Modo `uso`

**Objetivo.** Que DSH administre la conversación: agrupada, sin cerrar nada.

**Alcance.**
- Spike `P1`–`P4` de `09` (condición de entrada).
- `publish-native`: `create` + `append` + `flush`.
- `attachSession` con resolución previa del workspace.
- Sello de contenido y procedencia (C6).
- Repliegue a `archivo` cuando falte una capacidad.

**Criterio de aceptación.**
- La sesión aparece agrupada sin reiniciar.
- Reimportar es no-op.
- Una divergente no se sobrescribe en ninguna política.
- `TC-6` y `T-08`…`T-11`, `T-15` en verde.

**Riesgo.** Que la API de DSH cambie entre versiones. Mitigación: capacidades + repliegue; el modo
queda detrás de flag hasta que F2 cierre.

---

## F3 — Recibo y cobertura

**Objetivo.** Que el usuario pueda guardar y mostrar algo.

**Alcance.**
- Recibo de una página (texto/Markdown).
- `doctor` con "¿estoy cubierto?" y `--privacidad`.
- Tool del agente (`keeper_plan` / `keeper_apply`).
- Documentación de usuario final.

**Criterio de aceptación.**
- `T-12` en verde.
- El recibo se entiende sin abrir una terminal.
- Los pasos manuales para recuperar en una máquina nueva son ≤ 2.

---

## F4 — Capa C (fuera de 2.0)

**Objetivo.** Hablar con un auditor. **No se planifica**: se activa con un cliente concreto.

**Alcance mínimo si se activa.** Journal completo con retención, informe firmado, control de acceso,
política de retención explícita.

**Condición de entrada.** Un cliente que lo pague o un requisito regulatorio escrito. Sin eso, no se
construye.

---

## Dependencias entre fases

```text
F0 ──► F1 ──► F3
 │      │
 └──────┴────► F2 ──► (F4 condicionada)
```

F2 no puede empezar antes de F1 porque necesita journal, política y la clasificación del plan.

## Qué se puede mostrar en cada corte

| Corte | Demo posible |
|---|---|
| F0 | `conform` en verde; nada visible para el usuario |
| F1 | recuperar 11 sesiones con un comando y un recibo |
| F2 | la misma importación, agrupada y sin reiniciar |
| F3 | el recibo imprimible y el "¿estoy cubierto?" |

## Preguntas abiertas

- ¿Se corta un `2.0.0-beta.1` al cerrar F1 o se espera a F2? Dueño: producto. Propuesta: beta al
  cerrar F1, porque ya hay valor demostrable y usuarios que pueden probarlo.

## Qué sigue

`15-BACKLOG.md` para las tareas concretas; `16-PRUEBAS.md` para cómo se verifica cada fase.
