# Cómo estudiar esto de verdad

Corto. Leelo una vez.

## El ciclo

Todas las cápsulas son los mismos seis movimientos:

```
  leer el concepto  →  hacer el lab  →  romperlo a propósito  →
  pasar el checkpoint  →  commitear en gravity-chamber  →  scouter done NN
```

Más o menos 15 minutos de lectura, 30 de manos en la masa, 5 de escribirlo. Si
pasaste los 90 minutos, pará — mirá "cuando te trabás" más abajo.

## Anatomía de una cápsula

| Sección | Qué hacer con ella |
|---|---|
| **Tabla de encabezado** | Power level (dificultad), tiempo, prerrequisitos, y si es local o tiene opción en la nube |
| **Por qué existe esta cápsula** | El problema real de producción. Si no te acordás de nada más, acordate de esto |
| **El concepto** | La enseñanza posta. Leelo bien, no lo escanees |
| **En GCP** | Qué servicio de Google hace esto, cuánto sale, qué límites tiene |
| **Lab** | Pasos numerados, en *tu* repo `gravity-chamber` |
| **Checkpoint** | Comandos con salida esperada. Pasar esto es lo que significa "terminado" |
| **Llevátelo al trabajo** | La práctica transferible |
| **Battle drill** | Preguntas tipo entrevista. Contestalas en voz alta *antes* de abrir la respuesta |
| **Senzu** | Troubleshooting para cuando el lab se rompe |

## Tres reglas que deciden si esto queda o no

**1. Escribí el código. No lo pegues.**
La memoria muscular de escribir un handler, un Dockerfile, una query, es buena
parte de lo que estás comprando acá. Pegar produce la sensación de aprender sin
la sustancia.

**2. Contestá el Battle Drill en voz alta antes de leer la respuesta.**
Recuperación, no reconocimiento. Si no lo podés decir, no lo tenés — y el hueco
que encontrás es exactamente el párrafo que vale la pena releer. Además es
literalmente la habilidad que evalúa una entrevista de system design.

**3. Hacé el paso de "rompelo".**
Varias cápsulas terminan pidiéndote que mates un container en medio de un
request, o tires 10× de tráfico, o desenchufes el cache. Esa falla no es un
bonus; es la lección. Saber *cómo* falla algo es lo que separa a quien operó
sistemas de quien leyó sobre ellos.

## Ritmo

- **Una cápsula por sesión.** Están diseñadas para entrar en una.
- **Dos o tres por semana** termina el arco en unos dos meses y le da tiempo a
  las ideas a asentarse. Meterte seis en un fin de semana da una linda sensación
  y muy poca retención.
- **No saltees hacia adelante.** La Cápsula 15 rompe a propósito lo que armaste
  en la 14. La 22 parte lo que construiste entre la 10 y la 21. Fuera de orden,
  las lecciones pierden los dientes.
- **Releer es barato.** `./bin/scouter open 12` cuando quieras.

## Repetición espaciada, versión mínima

Al empezar cada sesión, antes de abrir la cápsula nueva, contestá una pregunta
del Battle Drill de una cápsula que terminaste **dos o más cápsulas atrás**.
Sesenta segundos. Este solo hábito vale más que cualquier app de notas.

## Llevá un registro

En tu repo `gravity-chamber`, mantené un `NOTES.md`. Después de cada cápsula,
tres líneas:

```markdown
## Cápsula 14 — Semilla del Ermitaño
- Cache-aside es el default; write-through solo cuando las lecturas no pueden
  quedar viejas nunca.
- Me sorprendió: un hit rate de 90% puede dejar igual la DB al 100% de carga si
  ese 10% son las queries caras. Hit *ratio* no es lo mismo que reducción de
  carga.
- Pregunta abierta: ¿cómo invalido un leaderboard que cambia todo el tiempo?
```

La línea de "me sorprendió" es la valiosa. La sorpresa marca el lugar exacto
donde tu modelo mental estaba mal, que es el único lugar donde ocurre el
aprendizaje.

## Cuando te trabás

1. Leé la sección **Senzu** de la cápsula.
2. Leé el mensaje de error de verdad. En voz alta. Entero.
3. Reducilo: ¿es el código, el container, la red o la configuración? Probá cada
   uno por separado.
4. Dale **20 minutos concentrados**.
5. Después: escribí la pregunta en `gravity-chamber/NOTES.md` lo más precisa que
   puedas — qué esperabas, qué pasó, qué ya descartaste — y seguí con la
   siguiente cápsula. Volvé más tarde.

Poder escribir la pregunta con precisión es la mayor parte de la habilidad de
debuggear. Una pregunta que podés formular así de clara normalmente se contesta
sola, y las que no, son justo las que vale la pena preguntarle a alguien.

## Qué significa "terminado"

El checkpoint pasó y commiteaste el trabajo. No "lo leí y tenía sentido". El
Scouter es deliberadamente tonto: solo sabe lo que le contás, así que la única
persona a la que le podés hacer trampa es a vos.
