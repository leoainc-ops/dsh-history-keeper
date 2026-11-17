---
id: "01"
titulo: "Visión y alcance"
estado: aprobado
version: "1.0"
depende_de: []
alimenta_a: ["02", "04", "06", "14"]
ultima_revision: "2026-11-11"
---

# 01 — Visión y alcance

## La visión

Que el historial de conversaciones de DeepSeek Harness deje de ser algo que se pierde cuando cambia
la máquina, y pase a ser un activo que se guarda cifrado, se recupera idéntico y se usa todos los
días.

## Qué es `dsh-history-keeper` v2.0.0

Un plugin de DSH con dos formas de entregar el historial
desde una bóveda cifrada:

- **Modo `archivo`** — recupera el original, byte por byte, con verificación criptográfica. Es el
  camino que ya existe en 1.0.2, mejorado en ceremonia.
- **Modo `uso`** — entrega la conversación a DSH para que DSH la administre como propia: la escribe,
  la indexa y la agrupa. Es la novedad de 2.0.

Y una tercera cosa que atraviesa a las dos: **todo lo entregado deja un recibo** que dice de dónde
salió y cómo comprobarlo.

## La promesa

> En modo `archivo` recuperás el original, idéntico y comprobable. En modo `uso`, DSH lo administra
> desde el primer segundo. En los dos casos, el recibo dice de dónde salió.

## Qué NO es

- **No es sincronización en vivo.** No hay nube, ni servidor, ni cuenta. La bóveda viaja cuando el
  usuario la lleva.
- **No es un gestor de contraseñas.** Guarda conversaciones, no secretos de otros sistemas.
- **No es una interfaz nueva.** Vive dentro de DSH.
- **No es una herramienta forense.** No emite informes firmados ni cadena de custodia formal; eso es
  la capa C, futura y condicionada (`12`).
- **No reemplaza el árbol de sesiones de DSH.** En modo `archivo` escribe en él respetando su
  formato; en modo `uso` deja que DSH lo escriba.

## Los cuatro principios

1. **La integridad no se negocia.** El contrato (`04`) fija lo que nunca se relaja.
2. **La ceremonia sí se negocia.** Todo paso que no aporte garantía se elimina o se automatiza.
3. **El formato sobrevive al software.** La bóveda no cambia de versión en 2.0; sólo el plugin.
4. **Nada se destruye.** Ni una sesión, ni un adjunto, ni un manifiesto se reemplazan.

## A quién sirve

Al técnico que ya usa DSH en más de una máquina y que alguna vez perdió —o estuvo a punto de
perder— trabajo que no puede reconstruir. El detalle está en `02`.

## Cómo se mide el éxito

Métricas simples, verificables sin instrumentación de terceros:

| Métrica | Objetivo | Dónde se mide |
|---|---|---|
| Recuperaciones completas con un solo comando | 100% de los casos de la suite de regresión | 16 |
| Sesiones importadas que quedan agrupadas (modo `uso`) | 100% cuando el `cwd` existe | 11, 16 |
| Fallas de importación que terminan en bóveda intacta | 100% | 16 |
| Pasos manuales para recuperar todo en una máquina nueva | ≤ 2 | 13 |
| Reinstalaciones de 1.0.2 a 2.0 con migración de datos | 0 | 18 |

## Qué queda fuera de 2.0

Explícitamente afuera, para que no entre por la puerta de atrás:

- capa C completa (informe firmado, journal de auditoría, control de acceso, retención);
- sincronización automática;
- soporte de macOS/Linux como plataforma primaria (el objetivo es Windows; el código no se cierra);
- interfaz gráfica propia más allá de los comandos y del panel de DSH.

## Preguntas abiertas

- Ninguna. Si aparece, va a `20-RIESGOS-Y-SUPUESTOS.md`.

## Qué sigue

`02-PUBLICO-Y-POSICIONAMIENTO.md` para entender a quién se le vende; `04-CONTRATO.md` para saber qué
no se toca.
