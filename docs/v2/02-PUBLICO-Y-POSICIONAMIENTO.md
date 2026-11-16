---
id: "02"
titulo: "Público y posicionamiento"
estado: aprobado
version: "1.0"
depende_de: ["01"]
alimenta_a: ["12", "13", "14"]
ultima_revision: "2026-11-11"
---

# 02 — Público y posicionamiento

## La tesis

La tolerancia a relajar garantías no la decide el tamaño de la empresa ni el sector: la decide **a
quién le tiene que rendir cuentas el dueño del historial**, y en segundo lugar **dónde vive el dato**.

## La escalera de relajación

| Grado | Qué acepta | Qué sigue exigiendo |
|---|---|---|
| 0 | sólo el original, byte por byte | huella del original, cadena de custodia |
| 1 | que lo reescriba otro, si deja sello y procedencia y se puede re-verificar | poder probar la equivalencia |
| 2 | que lo reescriba otro y listo | que funcione y no se pierda nada |
| 3 | ni le importa el cifrado en reposo | nada |

## El público objetivo

> **El técnico que ya usa DSH en más de una máquina y que alguna vez perdió —o estuvo a punto de
> perder— trabajo que no puede reconstruir.**

Perfil operativo:

- una persona, 2 a 4 máquinas;
- Windows;
- abre una terminal sin miedo;
- tiene un historial que creció más allá de lo que puede rehacer;
- le importa más **recuperar** que **demostrar**;
- tolera el grado 2 y, si se lo advierten, el 3.

**Momento de compra** (el evento, no la necesidad abstracta): compró una notebook nueva; reinstaló
Windows; le robaron o se le cayó el disco; se cambió de trabajo; perdió una sesión en una
actualización.

## Segmentos y veredicto

| Segmento | Grado | Veredicto 2.0 |
|---|---|---|
| Técnico solo con historial valioso | 2–3 | **objetivo principal** |
| Freelance con NDA | 1–2 | objetivo secundario: usa `archivo` como respaldo defendible |
| Estudio chico (2–15) | 2 | habilitado por el modo `uso` (agrupación); no antes |
| Compliance interno | 1 | fuera de 2.0: falta capa C |
| Legal / pericial | 0 | fuera de 2.0 |
| Periodismo / fuentes | 0 | fuera: el modo `uso` deja texto en claro |
| Educación | 3 | difusión, no ingresos |

## Anti-personas

- Quien no usa DSH.
- Quien quiere sincronización automática en la nube.
- Quien organiza todo por proyecto y vive del panel (lo cubre el modo `uso`, pero no lo buscamos primero).
- Quien no instala un `.tgz` ni abre una terminal.
- Quien necesita mostrarle algo a un auditor mañana.

## Posicionamiento

Frase única, la misma en el producto, el recibo y la documentación:

> **"Tu historial de DSH, cifrado, idéntico y comprobable, en cualquier máquina."**

Y la variante para quien ya compró: **"recuperás, no adivinás"**.

## Precio y canal (hipótesis a validar)

- **Licencia única por persona**, con derecho a 3–4 máquinas (su situación real).
- **Sin nube, sin cuentas, sin telemetría.** Es parte de la propuesta, no una limitación.
- **Soporte acotado**: documentación + correo.
- Canal: el propio ecosistema de DSH y el boca a boca técnico.

Nada de esto se implementa en el código: son decisiones comerciales que el producto debe permitir
(licencia verificable, sin dependencia de red).

## Hipótesis a validar antes de la Fase 2

| # | Hipótesis | Cómo se falsa |
|---|---|---|
| H1 | El técnico solo no paga por integridad, paga por no perder tiempo | 10 entrevistas: ¿pagaría por un sello que no usa? |
| H2 | La agencia chica relaja el grado 1 sólo si puede mostrarle algo al cliente | pedir el recibo antes/después |
| H3 | El cliente regulado no compra comodidad: compra capacidad de responder | ofrecerle el modo `uso` y ver si lo rechaza |
| H4 | Nadie acepta texto en claro si el disco no es propio | preguntar por notebooks compartidas |
| H5 | El miedo real es que DSH cambie y rompa, no que el plugin adultere | medir objeciones en la demo |

## Consecuencias para el producto

- El modo `archivo` debe ser el **default** y el que se documenta primero: es el que sostiene la
  promesa.
- El modo `uso` debe pedir **consentimiento explícito** la primera vez y recordar el estado de texto
  en claro (`12`).
- El recibo (`13`) no es un extra: es el entregable que este público guarda.

## Preguntas abiertas

- Precio exacto: se define después de las 10 entrevistas. Dueño: producto.
- ¿Hay apetito por una edición "equipo" antes de la capa C? Dueño: producto.

## Qué sigue

`03-ESTADO-ACTUAL-1.0.2.md` para ver qué hay construido; `12-CONFIANZA-Y-PRIVACIDAD.md` para las
reglas de consentimiento.
