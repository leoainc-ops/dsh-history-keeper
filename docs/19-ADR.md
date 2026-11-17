---
id: "19"
titulo: "Registro de decisiones (ADR)"
estado: aprobado
version: "1.0"
depende_de: ["04", "06", "18"]
alimenta_a: ["20", "21"]
ultima_revision: "2026-11-11"
---

# 19 — Registro de decisiones (ADR)

Cada decisión con su contexto, su alternativa descartada y sus consecuencias. Una decisión sin
alternativa escrita no está decidida: está improvisada.

---

## ADR-001 — 2.0.0, no 1.1.0

**Contexto.** 2.0 agrega modos y quita ceremonia. La bóveda no cambia.

**Decisión.** Versión mayor, porque cambian defaults que alteran qué se bloquea y sube el piso de DSH.

**Alternativa descartada.** 1.1.0 con defaults estrictos y `uso` opt-in. Se descarta porque el
objetivo declarado (capa B) es justamente cambiar los defaults; un 1.1 con los defaults viejos sería
un producto que no entrega lo prometido.

**Consecuencias.** `release/1.x` congelada; sin migración de datos; el contrato gana C6.

---

## ADR-002 — Rama nueva, no fork

**Contexto.** El producto continúa el linaje de `dsh-history-keeper`, con el mismo titular
(`leoainc-ops`) y la misma bóveda.

**Decisión.** `main` = 2.0; `release/1.x` para arreglos; ramas cortas `feat/*`; sin fork.

**Alternativa descartada.** Fork: partiría la base de usuarios y los arreglos, y duplicaría la
gobernanza sin beneficio.

**Consecuencias.** Un solo repo, dos líneas vivas, CI con matriz de interoperabilidad.

---

## ADR-003 — Licencia y titularidad

**Contexto.** El código está bajo PolyForm Noncommercial 1.0.0, copyright `leoainc-ops`.

**Decisión (confirmada).** El titular del copyright es el autor del proyecto (`leoainc-ops`), por lo
que puede relicenciar y publicar 2.0 sin restricciones de terceros.

**Decisión pendiente (no tomada).** El modelo de licencia de 2.0 —mantener PolyForm NC, dual
NC + comercial, o pasar a permisiva— **no está decidido**. Queda registrado como pregunta abierta en
`20` (R-15, R-16). Hasta que se decida, el paquete conserva la licencia actual.

**Alternativas.** (a) Mantener NC: coherente con el uso comunitario, limita la venta. (b) Dual
NC + comercial: habilita la monetización que asume `02`, exige gestionar licencias. (c) Permisiva
(MIT/Apache): máxima adopción, renuncia a la monetización.

**Consecuencias.** Cualquiera sea la elección, el `package.json` debe declarar la licencia
explícitamente y el repo debe incluir la nota de titularidad. Las contribuciones externas requieren
cesión o licencia compatible.

---

## ADR-004 — Dos modos, un producto

**Contexto.** El camino sellado y el nativo tienen garantías distintas.

**Decisión.** Un solo plugin con dos modos explícitos por operación (`archivo`, `uso`), no dos
productos ni dos paquetes.

**Alternativa descartada.** Dos productos separados: duplicaría mantenimiento y obligaría al usuario a
elegir antes de entender.

**Consecuencias.** El modo es un parámetro del plan; el default es `archivo`; el aviso de texto en
claro es obligatorio en `uso`.

---

## ADR-005 — El formato no se toca

**Contexto.** 2.0 necesita registrar procedencia y sello.

**Decisión.** `store/1` se mantiene; la procedencia va en campos opcionales del manifiesto y en el
journal, nunca en un campo obligatorio. `minReader` no sube.

**Alternativa descartada.** `store/2` con campos nuevos: obligaría a migrar el archivo del usuario,
que es lo único que no se puede perder.

**Consecuencias.** C5 se puede probar en las dos direcciones; si algún día hace falta `store/2`, exige
un plan de migración que hoy no existe.

---

## ADR-006 — El contrato es la suite de pruebas

**Contexto.** Un contrato en prosa se erosiona.

**Decisión.** Cada cláusula C1–C6 tiene un test con el mismo nombre (`TC-n`); modificar el contrato
exige modificar la suite en el mismo cambio.

**Alternativa descartada.** Contrato sólo documental: se vuelve retórica en tres versiones.

**Consecuencias.** `16` es el índice real del contrato; un PR que toca C1–C6 sin tocar TC-n se
rechaza.

---

## ADR-007 — Núcleo y adaptador separados

**Contexto.** Hoy los módulos de bóveda y los que dependen del host conviven.

**Decisión.** `core/` sin DSH; `host/` sin criptografía; la flecha va del adaptador al núcleo.

**Alternativa descartada.** Mantener la estructura plana de 1.0.2: impide probar la bóveda sin el
host y acopla el producto a cada versión de DSH.

**Consecuencias.** F0 es un refactor sin features; la revisión rechaza imports de `host` en `core`.

---

## ADR-008 — Capa C fuera de 2.0

**Contexto.** El segmento regulado paga más pero exige informe firmado, journal completo y control de
acceso.

**Decisión.** No se construye en 2.0. Se activa sólo con un cliente concreto o un requisito escrito.

**Alternativa descartada.** Construirla "por si acaso": consume el esfuerzo que necesita la capa B y
no tiene comprador hoy.

**Consecuencias.** El posicionamiento excluye explícitamente al segmento regulado hasta que exista
(`02`).

---

## Plantilla para nuevas decisiones

```text
## ADR-00N — Título
Contexto. …        Decisión. …
Alternativa descartada. …   Consecuencias. …
```

Una ADR se reemplaza, no se edita: se marca `obsoleto` y se agrega la que la sustituye.

## Qué sigue

`20-RIESGOS-Y-SUPUESTOS.md` para lo que puede invalidar estas decisiones.
