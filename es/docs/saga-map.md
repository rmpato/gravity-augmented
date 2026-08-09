# El Mapa de Sagas

27 cápsulas en el arco principal, más 10 opcionales. En orden. Las últimas rompen
a propósito lo que hicieron las primeras.

Referencias — **Local**: corre entero en tu máquina. **☁️**: tiene una sección
opcional en GCP real, elegible para el free tier. **Concepto**: se enseña con
comandos y Terraform reales, pero no se levanta (costaría plata dejarlo prendido).

---

## Saga 0 · Kame House — Fundamentos
*Poné un servicio a andar, containerizado y reproducible, y entendé qué es GCP
antes de tocarlo.*

| # | Cápsula | Qué aprendés | Modo |
|---|---|---|---|
| 00 | **Kame House** — Setup, herramientas y tu propio repo | Toolchain, andamiaje de `gravity-chamber`, convenciones de commits | Local |
| 01 | **Scouter** — Tu primer servicio | Servicio HTTP en Go, config 12-factor, health checks, logs estructurados, graceful shutdown | Local |
| 02 | **Cápsula #9** — Containers | Dockerfile multi-stage, distroless, tamaño de imagen, lazydocker, cache de capas | Local |
| 03 | **Los planos de Bulma** — Entornos reproducibles e IaC | docker compose, Makefile, fundamentos de Terraform, state, `plan` vs `apply` | Local |
| 04 | **El Templo de Kami** — El modelo mental de GCP | Projects/orgs/IAM, regiones y zonas, el espectro de cómputo, gcloud, seguridad de facturación | Local + ☁️ |

## Saga 1 · Saga Saiyan — Escala y el borde
*Hacé una máquina más grande, después pará y hacé muchas máquinas — y después
poné algo sensato adelante.*

| # | Cápsula | Qué aprendés | Modo |
|---|---|---|---|
| 05 | **Kaio-ken** — Vertical scaling y su precio | Límites de CPU/memoria, la curva de costo, ley de Amdahl, cuándo más grande es la respuesta correcta | Local |
| 06 | **Multiformas** — Horizontal scaling y statelessness | Réplicas, dónde se esconde el estado, sticky sessions, señales de autoscaling, concurrencia en Cloud Run | Local + ☁️ |
| 07 | **La Torre de Karin** — Load balancing | L4 vs L7, algoritmos, health checks, connection draining, anycast, anatomía del GCLB | Local + Concepto |
| 08 | **El escritorio de Enma Daio** — Proxies, gateways y el borde | Forward vs reverse proxy, sidecars, responsabilidades de un API gateway, terminación TLS, auth en el borde, service mesh, Apigee/API Gateway/URL maps | Local + Concepto |
| 09 | **La Habitación del Tiempo** — Load testing y capacidad | k6, percentiles, ley de Little, modelos cerrados vs abiertos, encontrar la rodilla | Local |

## Saga 2 · Saga de Namek — Datos
*Donde viven los problemas difíciles de verdad.*

| # | Cápsula | Qué aprendés | Modo |
|---|---|---|---|
| 10 | **El Archivo del Gran Patriarca** — Datos relacionales | Postgres, diseño de schema, transacciones, niveles de aislamiento, connection pooling, N+1 | Local + Concepto |
| 11 | **El Radar del Dragón** — Índices y planes de query | B-trees, orden de columnas en índices compuestos, `EXPLAIN ANALYZE`, keyset pagination, covering indexes | Local |
| 12 | **Las Siete Esferas** — Sharding y particionado | Particionado vertical vs horizontal, hash vs range, hotspots, scatter-gather, resharding, diseño de claves en Bigtable/Spanner | Local |
| 13 | **Fusión namekiana** — Replicación y consistencia | Leader/follower, lag de replicación, read-your-writes, quórums, CAP/PACELC, Spanner y TrueTime | Local |

## Saga 3 · Saga de Freezer — Latencia
*Ponerse rápido, y seguir rápido cuando las cosas salen mal.*

| # | Cápsula | Qué aprendés | Modo |
|---|---|---|---|
| 14 | **Semilla del Ermitaño** — Fundamentos de caching | Cache-aside vs write-through vs write-behind, TTLs, evicción, hit ratio vs reducción de carga, Redis/Memorystore | Local + Concepto |
| 15 | **Tácticas de las Fuerzas Ginyu** — Cuando el cache te traiciona | Stampede, thundering herd, singleflight, negative caching, invalidación, hot keys, consistent hashing | Local |
| 16 | **Teletransportación** — CDN y el borde | Cache-Control, ETag, assets inmutables, cache keys, purga, Cloud CDN y Armor, presupuestos de latencia | Local + Concepto |
| 17 | **Suprimir el ki** — Rate limiting, timeouts y backpressure | Token bucket, propagación de deadlines, reintentos con jitter, circuit breakers, bulkheads, load shedding | Local |

## Saga 4 · Saga de Cell — Asincronía
*Dejá de hacer que todo sea un request sincrónico.*

| # | Cápsula | Qué aprendés | Modo |
|---|---|---|---|
| 18 | **Telepatía de Kaio-sama** — Pub/Sub | Topics, subscriptions, push vs pull, ack deadlines, el emulador, desacoplamiento | Local + ☁️ |
| 19 | **La absorción de Cell** — Semánticas de entrega e idempotencia | At-least-once, estrategias de dedup, ordering keys, DLQs, mensajes veneno, el backlog como señal | Local |
| 20 | **Genkidama** — Fan-in, fan-out y batch | Agregación, ventanas, batch vs stream, BigQuery, Dataflow, cuándo *no* usar streaming | Local + ☁️ |
| 21 | **La máquina del tiempo de Trunks** — Arquitectura event-driven | Transactional outbox, CDC, event sourcing liviano, replay, evolución de schema, coreografía vs orquestación | Local |

## Saga 5 · Saga de Buu — Operarlo
*Convertirlo en algo que un equipo pueda mantener.*

| # | Cápsula | Qué aprendés | Modo |
|---|---|---|---|
| 22 | **Danza de la Fusión** — Partir el monolito | Límites entre servicios, DDD liviano, el distributed monolith, contratos, gRPC vs REST, el monolito modular como default | Local |
| 23 | **El Gran Saiyaman** — Backend for Frontend | El patrón BFF, clientes charlatanes, agregación en el borde, APIs por audiencia, GraphQL vs BFF, cuándo un BFF vuelve a ser un monolito | Local |
| 24 | **Cambio de Cuerpo de Ginyu** — Deploys seguros | Blue/green, canary, revisiones y traffic splitting en Cloud Run, expand/migrate/contract, feature flags, rollback | Local + ☁️ |
| 25 | **Scouter Mk. II** — Observabilidad y SLOs | RED/USE, traces con OpenTelemetry, cardinalidad, SLIs/SLOs/error budgets, alertar sobre síntomas, Cloud Monitoring | Local + ☁️ |
| 26 | **El Torneo del Poder** — El capstone | Diseño completo con restricciones, modelo de capacidad y costo, análisis de fallas, ADRs, defenderlo en voz alta | Local |

## Arco de Relleno · bonus opcional
*Los fundamentos sobre los que se apoya el arco principal. No es obligatorio —
pero los capítulos de relleno donde alguien entrena en serio valen la pena. 150
de power cada uno, y la única forma de pasar los 9000.*

| # | Cápsula | Qué aprendés | Mejor antes de |
|---|---|---|---|
| B1 | **Reglas de Kame House** — REST API design | Recursos vs acciones, semántica de métodos, códigos de estado que todos confunden, errores RFC 9457, paginación, versionado, idempotency keys | 01 |
| B2 | **El Camino de la Serpiente** — HTTP y redes | Números de latencia, TCP slow start y la regla de los 14 KB, TLS 1.3, HTTP/1.1 vs 2 vs 3, connection pooling, TTLs de DNS | 07 |
| B3 | **La Adivina Uranai Baba** — Identidad, auth y JWT | authn vs authz, sesiones vs tokens, los cinco checks de un JWT, `alg:none` y confusión de algoritmos, OAuth2 vs OIDC, PKCE, RBAC/ABAC/ReBAC | 08 |
| B4 | **Namekiano Antiguo** — SQL esencial | Joins y la trampa del LEFT JOIN/WHERE, semántica de NULL, `NOT EXISTS`, window functions, CTEs, upserts, `SKIP LOCKED`, JSONB | 10 |
| B5 | **Imagen Residual** — Concurrencia en Go | Goroutines y sus leaks, channels, `context`, mutex vs channel, worker pools, `errgroup`, el race detector | 17 |
| B6 | **Leer Niveles de Pelea** — Estimación de servilleta | Los números para memorizar, las fórmulas, tres ejemplos resueltos, y cómo estimar evita sobre-ingeniería | 26 |
| B7 | **El Registro de Kami** — IAM, service accounts y Workload Identity | El modelo de IAM, service accounts como principal *y* recurso, SAs adjuntas, Workload Identity Federation, impersonación, mínimo privilegio, audit logs | 04 |
| B8 | **Los cinco minutos de Namek** — Respuesta a incidentes y postmortems | Mitigar antes de diagnosticar, niveles de severidad, roles de incident command, los primeros cinco minutos, status updates sin ETA, postmortems sin culpa, factores contribuyentes en vez de root cause, guardias sostenibles | 25 |
| B9 | **El hechizo de Babidi** — Seguridad más allá de auth | SQL injection y por qué escapar pierde, allowlists para identificadores, SSRF y el metadata service, bloquear en el dial para frenar DNS rebinding, higiene y rotación de secretos, un tipo Secret que no se puede loguear, govulncheck y reachability | 23 |
| B10 | **Kamehameha Instantáneo** — Go para quien ya programa | Interfaces implícitas, errores como valores, embedding vs herencia, zero values, slices y su array compartido, goroutines, `defer`, mayúscula-como-visibilidad, `go.mod` vs Maven — con una columna Java que podés ignorar | 01 |
| B11 | **Escuela de la Tortuga** — Go desde cero y las herramientas | El comando `go`, `gofmt` sin opciones, qué agarra `go vet` que el compilador no puede, table-driven tests, módulos y `go mod tidy`, las reglas opinionadas que al principio se sienten mal, cómo leer panics y errores de compilación — más un cheatsheet para guardar | 01 |

---

## Qué vas a haber construido al final

Arrancando de un solo binario de Go con un map en memoria, `gravity-chamber`
crece hasta esto:

```
     browser / mobile / partner API
                  │
          ┌───────▼────────┐
          │   Cloud CDN    │  GETs estáticos y cacheables         (C16)
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │ Load Balancer  │  L7, health checks, draining         (C07)
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │  API Gateway   │  TLS, authn, cuotas, routing         (C08)
          └───┬────────┬───┘
              │        │
      ┌───────▼──┐  ┌──▼────────┐
      │ web BFF  │  │mobile BFF │  agregación por audiencia       (C23)
      └───────┬──┘  └──┬────────┘
              └────┬───┘
                   │  (interno, gRPC)
     ┌─────────────▼──────────────┐
     │  scouter-api  ×N           │  sin estado, autoescalado     (C06)
     │  timeouts, límites, breaker│                               (C17)
     └──┬──────────┬───────────┬──┘
        │          │           │
  ┌─────▼───┐ ┌────▼─────┐ ┌───▼──────────┐
  │  Redis  │ │ Postgres │ │   Pub/Sub    │            (C14 / C10 / C18)
  │  cache  │ │ +réplicas│ │   topics     │
  └─────────┘ │ sharded  │ └───┬──────────┘
              └──────────┘     │
                        ┌──────▼────────┐
                        │ ranker worker │                        (C20)
                        │ notifier      │                        (C22)
                        └───────────────┘
                               │
        ┌──────────────────────▼─────────────────┐
        │ traces · métricas · logs · SLOs        │                (C25)
        └────────────────────────────────────────┘
```

Cada caja aparece porque una cápsula específica demostró que la necesitabas — no
porque un diagrama lo dijera. Ese es el punto.
