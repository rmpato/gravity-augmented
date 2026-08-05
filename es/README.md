# Gravity Augmented

**Un entrenamiento práctico de Google Cloud y diseño de sistemas a escala.**

> *"La gravedad acá adentro es 100 veces la de la Tierra. Si podés moverte con
> esto, podés moverte en cualquier lado."*
> — Vegeta, entrenando en la Cámara de Gravedad

Los sistemas reales se ponen pesados. El tráfico se multiplica, los datos no
entran más en una máquina, una dependencia lenta se lleva puestos cinco
servicios. Este repo sube ese peso de a poco y a propósito, una **Cápsula** por
vez, hasta que una carga que al principio te aplastaba se siente como gravedad
normal.

Al terminar vas a tener:

- **GCP: de lo esencial a un intermedio sólido.** Projects, IAM, Cloud Run,
  Cloud SQL, Memorystore, Pub/Sub, Cloud Load Balancing, Cloud CDN, Cloud
  Monitoring, Artifact Registry, Terraform — y el criterio para elegir entre
  ellos.
- **Diseño de sistemas: intermedio o mejor.** Caching, sharding, replicación,
  consistencia, colas y semánticas de entrega, backpressure, límites entre
  servicios, deploys, observabilidad, y cómo defender un diseño en voz alta.
- **Un sistema real construido por vos,** en tu propio repo, commit a commit.

> **Sobre el idioma.** Los términos técnicos quedan en inglés a propósito
> (*cache*, *load balancer*, *sharding*, *deploy*, *commit*, *request*,
> *endpoint*, *trade-off*). Es el vocabulario que vas a usar en el trabajo y en
> una entrevista; traducirlo te dejaría hablando un idioma que nadie usa.
>
> **El código queda idéntico al original en inglés** — identificadores, strings y
> comentarios. Dos motivos: ese código está verificado (compila y pasa sus tests),
> y escribir comentarios en inglés es la convención profesional en Go. Toda la
> explicación alrededor está traducida, que es donde vive la enseñanza.

---

## La forma del entrenamiento

Hay **27 Cápsulas**. Cada una es una sesión autocontenida de **45 a 95 minutos**
— las últimas son más largas, y las ocho más largas llevan un ⏸ marcado como punto
para cortar, así podés partirlas en dos noches sin dejar nada roto:
leés el concepto, hacés el lab, verificás con un checkpoint, lo registrás y
cerrás la notebook. Nada te exige acordarte de la semana pasada.

Las cápsulas se agrupan en **Sagas**. Van en orden — las últimas rompen a
propósito lo que construyeron las primeras.

| Saga | Cápsulas | Con qué te vas |
|---|---|---|
| **0 · Kame House** — Fundamentos | 00–04 | Un servicio Go andando, containerizado, reproducible, y un modelo mental correcto de GCP |
| **1 · Saga Saiyan** — Escala y el borde | 05–09 | Escalado vertical vs horizontal, load balancers, reverse proxies y API gateways, y cómo medir capacidad de verdad |
| **2 · Saga de Namek** — Datos | 10–13 | Modelado relacional, índices, sharding, replicación, trade-offs de consistencia |
| **3 · Saga de Freezer** — Latencia | 14–17 | Caching que sobrevive a producción, CDNs, rate limiting, backpressure |
| **4 · Saga de Cell** — Asincronía | 18–21 | Pub/Sub, semánticas de entrega, idempotencia, fan-out, arquitectura event-driven |
| **5 · Saga de Buu** — Operarlo | 22–26 | Límites entre servicios, BFFs, deploys seguros, observabilidad y un diseño capstone completo |

### El Arco de Relleno (opcional)

Siete cápsulas extra con los fundamentos sobre los que se apoya el arco
principal. Cualquier fan de DBZ sabe que los capítulos de relleno no son
obligatorios — pero los que tienen entrenamiento de verdad valen la pena.

| # | Cápsula | Hacela si… | Mejor antes de |
|---|---|---|---|
| B1 | **Reglas de Kame House** — REST API design | armaste APIs de intuición y querés las reglas posta | 01 |
| B2 | **El Camino de la Serpiente** — HTTP y redes | TLS, HTTP/2, keep-alive o DNS te quedan medio borrosos | 07 |
| B3 | **La Adivina Uranai Baba** — identidad, auth y JWT | no tenés claro cuándo usar JWT vs sesión, o qué es OIDC | 08 |
| B4 | **Namekiano Antiguo** — SQL esencial | tu SQL termina en `SELECT … WHERE` | 10 |
| B5 | **Imagen Residual** — concurrencia en Go | goroutines, channels y `context` no te salen solos | 17 |
| B6 | **Leer Niveles de Pelea** — estimación de servilleta | "¿cuántos servidores necesitamos?" te congela | 26 |
| B7 | **El Registro de Kami** — IAM, service accounts y Workload Identity | todavía no podés explicar qué *es* una service account | 04 |
| B8 | **Los cinco minutos de Namek** — incidentes y postmortems | nunca estuviste de guardia, o sí y fue horrible | 25 |
| B9 | **El hechizo de Babidi** — seguridad más allá de auth | sabés qué es un JWT pero no qué es SSRF | 23 |
| B10 | **Kamehameha Instantáneo** — Go para quien ya programa | programás en otro lenguaje y la sintaxis de Go te estorba | 01 |

Valen **150** cada una. El arco principal termina exactamente en 9000 — el Arco
de Relleno es literalmente cómo pasás de **9000**.

**Lista completa de cápsulas:** [`docs/saga-map.md`](docs/saga-map.md)

---

## Tres repos: este enseña, el tuyo entrena, uno es el solucionario

```
gravity-augmented/            ← este repo. Para vos es de solo lectura. El programa.
gravity-chamber/              ← TU repo. Lo creás en la Cápsula 00.
                                Cada lab agrega un commit acá. Para la Cápsula 25
                                es un sistema multi-servicio que podés mostrar.
gravity-chamber-reference/    ← una build funcionando de lo anterior, con un tag
                                por cápsula. Para cuando estés trabado a las 11pm
                                — no antes.
```

La referencia tiene un tag `capsule-NN` por cada cápsula, así que
`git diff capsule-13 capsule-14` te muestra exactamente qué pide una cápsula,
sin la prosa. **Recurrí a ella después de haberte trabado en serio**, no en vez
de trabarte — trabarse es donde está el aprendizaje.

No vas a copiar y pegar una app terminada. Vas a construir **Scouter** — un
servicio que registra lecturas de nivel de pelea y rankea peleadores —
empezando por un solo binario de Go con un map en memoria, y terminando con
varios servicios, base de datos, cache, CDN, deploys con traffic split y SLOs.

Cada cápsula te dice exactamente qué archivos tocar en `gravity-chamber`.

---

---

## Estado: primera versión

Es muy posible que seas la primera persona en hacer esto de punta a punta. El
código está verificado — cada snippet de Go compila, cada cálculo embebido fue
ejecutado, y 21 de los labs se corrieron contra containers reales en vez de solo
escribirse. Lo que **no** está probado es la enseñanza: si una explicación es
clara para alguien que todavía no sabe la respuesta.

Esa es la parte que vos podés ver y el autor no. Si un paso asume algo que nunca
te dijo, o un lab te deja trabado por el motivo equivocado, eso es un bug —
decilo. Es lo más útil que podés devolver.

## Empezá por acá

```bash
# 1. Verificá que tu máquina tenga lo necesario (te dice qué falta)
./bin/doctor

# 2. Leé en el navegador — sidebar, búsqueda, progreso, seis themes
./bin/serve

# …o quedate en la terminal
./bin/scouter status
```

En cualquiera de los dos casos, arrancá con
[`capsules/00-kame-house-setup/README.md`](capsules/00-kame-house-setup/README.md).

---

## El lector web

```bash
./bin/serve            # http://localhost:8420, te abre el navegador
./bin/serve 9000       # otro puerto
./bin/serve --no-open  # sin abrir el navegador
```

Solo biblioteca estándar de Python 3 — sin `pip install`, sin `npm install`, sin
build. Sirve las cápsulas como una app: navegación lateral, búsqueda (`/`),
`j`/`k` para moverte entre cápsulas, botón de copiar en cada bloque de código,
los seis themes de Capsule Corp y el **selector de idioma EN/ES**.

**El progreso vive en el mismo archivo que usa la CLI.** Marcás una cápsula como
completa en el navegador y `./bin/scouter status` muestra el nuevo power level al
instante, y viceversa. En el navegador solo se guarda tu elección de theme e
idioma.

---

## El Scouter (tu tracker de progreso)

Acá el power level no es chiste: es la barra de progreso. Cada cápsula vale
**340**, el capstone **500**, y todo el arco suma exactamente **9000**.

```bash
./bin/scouter status              # power level + progreso por saga
./bin/scouter next                # qué hacer ahora, y dónde está el archivo
./bin/scouter start 03            # marcar una cápsula como en progreso
./bin/scouter done 03             # marcarla completa y sumar power level
./bin/scouter list                # todas las cápsulas con su estado
./bin/scouter review              # lo que estás por olvidarte — ver abajo
./bin/scouter reset 03            # rehacer una
```

El progreso vive en `.scouter/progress` (texto plano, ignorado por git). Sin más
dependencias que un shell POSIX.

### `scouter review` — la parte que hace que quede

Terminar una cápsula no es aprenderla. Sin recuperación activa perdés la mayor
parte en una semana, y releer casi no ayuda — *se siente* productivo porque el
texto te resulta familiar, que es justamente la ilusión.

Así que `scouter` registra cuándo completaste cada cápsula y te pide recordarla
de nuevo a los **3, 7 y 21 días**:

```bash
./bin/scouter review          # todo lo pendiente, una pregunta por cápsula
./bin/scouter review 03       # el drill completo de esa cápsula, y lo registra
```

Respondé en voz alta *antes* de abrir nada. Una respuesta equivocada que te
jugaste te enseña más que una correcta que leíste — ahora sabés exactamente qué
parte de tu modelo estaba rota. `scouter status` te avisa cuándo hay algo
pendiente.

---

## Costo: esto no te va a sorprender con una factura

Cada lab corre **primero local** — Docker, Postgres, Redis, el emulador de
Pub/Sub, el emulador de Firestore. Ese es el camino por defecto y no cuesta nada.

Cuando una cápsula puede enseñar algo que el tooling local genuinamente no puede,
agrega una sección opcional claramente marcada:

> ### ☁️ Opcional: en GCP de verdad
> Elegible para el free tier. Teardown al final. Si la salteás, igual completás
> la cápsula.

Antes de correr un solo comando `gcloud`, hacé
[`docs/gcp-safety.md`](docs/gcp-safety.md). Configura una alerta de presupuesto,
un project acotado y el hábito del teardown. No es negociable.

---

## Qué necesitás saber de antes

- **Git**: branch, commit, push. Con eso alcanza.
- **Terminal**: `cd`, pipes, editar un archivo. Con eso alcanza.
- Todo lo demás — Go, Docker, SQL, Terraform, gcloud — se enseña desde cero
  *cuando hace falta*, nunca como un muro de prerrequisitos.

**Plataformas:** macOS, Linux y **Windows vía WSL2** — adentro de WSL2 todos los
comandos de todas las cápsulas funcionan tal cual, porque estás en Ubuntu. En
[`docs/tools.md`](docs/tools.md) está el setup de WSL2 y las cinco cosas que
tenés que saber si usás Windows (la principal: guardá tu código en el filesystem
de Linux, no en `/mnt/c`).

---

## Documentación

| Archivo | Para qué sirve |
|---|---|
| [`docs/setup.md`](docs/setup.md) | El camino corto: instalá lo que pide la Cápsula 00 y verificalo. |
| [`docs/tools.md`](docs/tools.md) | Todas las herramientas recomendadas, con equivalentes en macOS / Linux / Windows-WSL2. Ghostty, lazydocker, Oh My Zsh, direnv, fzf, y por qué cada una. |
| [`docs/saga-map.md`](docs/saga-map.md) | Las 37 cápsulas, una línea cada una. El mapa. |
| [`docs/scouter-codex.md`](docs/scouter-codex.md) | Nombre clave de DBZ → término real de ingeniería. Leelo si algún nombre te confunde. |
| [`docs/gcp-safety.md`](docs/gcp-safety.md) | Barreras de facturación, free tier, disciplina de teardown. Hacelo antes de tocar la nube. |
| [`docs/engineering-standards.md`](docs/engineering-standards.md) | Las prácticas que atraviesan todas las cápsulas, en un solo lugar. Llevátelas al trabajo. |
| [`docs/how-this-works.md`](docs/how-this-works.md) | Cómo estudiar esto para que quede. Leelo una vez, es corto. |

---

## Reglas del juego

1. **Hacé el lab.** Leer una cápsula no es completarla. Al Scouter no le importa
   lo que leíste.
2. **Rompelo a propósito.** Varias cápsulas terminan pidiéndote que mates un
   container o tires 10× de tráfico. Esa falla *es* la lección.
3. **Commiteá en tu repo en cada cápsula.** El formato del mensaje está en
   `docs/engineering-standards.md`. El historial es la prueba del trabajo.
4. **Si una cápsula se te va 50% por encima del tiempo declarado, pará y abrite
   un issue a vos mismo en `gravity-chamber`.** Después seguí. La ambigüedad que
   podés nombrar es progreso; la que te comés, no. Las cápsulas largas tienen un
   marcador ⏸ — cortar ahí es terminar, no abandonar.

---

*Dragon Ball Z es © Toei Animation / Shueisha / Akira Toriyama. Este repositorio
es un proyecto educativo sin afiliación ni fines comerciales que toma prestado su
vocabulario por puro cariño.*
