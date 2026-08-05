# Estándares de ingeniería

Las prácticas que atraviesan todas las cápsulas, juntas en un solo lugar. No son
"higiene de tutorial" — son lo que separa a alguien que hace que funcione de
alguien con quien los equipos quieren estar de guardia.

Cada una nombra la cápsula donde te la cruzás en serio.

---

## 1. La configuración viene del entorno

*(Cápsula 01)*

Nada de hostnames, credenciales, puertos o feature flags en el código. El mismo
binario tiene que correr en tu máquina, en CI y en producción sin más cambio que
las variables de entorno.

```go
port := getenv("PORT", "8080")            // default razonable
dsn  := os.Getenv("DATABASE_URL")         // sin default; explotá si falta
```

**Fallá rápido al arrancar** si falta config obligatoria. Un servicio que
bootea contento y después tira 500 en el primer request que toca la base de
datos convirtió un error de configuración en un incidente.

## 2. Todo servicio expone `/healthz` y `/readyz`

*(Cápsula 01, obligatorio desde la 07)*

No son el mismo check, y confundirlos causa caídas reales:

- **liveness (`/healthz`)** — "¿este proceso está colgado?" Respondé solo desde
  memoria. Nunca chequees la base de datos acá. Si tu DB parpadea y liveness
  falla, el orquestador reinicia todas las réplicas a la vez y convertiste una
  degradación en una caída total.
- **readiness (`/readyz`)** — "¿esta réplica debería recibir tráfico *ahora*?"
  Esta sí chequea dependencias. Fallar readiness te saca del pool del load
  balancer sin matarte, así que podés recuperarte.

## 3. Logs estructurados, una línea por evento, sin PII

*(Cápsula 01, profundizado en la 25)*

JSON lines, no prosa. Las máquinas leen logs mucho más seguido que los humanos.

```go
slog.Info("reading recorded", "fighter_id", id, "power", p, "trace_id", tid)
```

Reglas: nada de `fmt.Println`. Nada de secretos, tokens, emails ni bodies
completos. Logueá *decisiones y resultados*, no "entré a la función X". Siempre
llevá un ID de correlación (Cápsula 25).

## 4. Timeouts y deadlines en toda llamada de red

*(Cápsula 17)*

Cualquier llamada que pueda bloquear necesita un deadline, y ese deadline tiene
que *heredarse* del que llamó. El `context.Context` de Go existe exactamente
para esto.

El default en la mayoría de los clientes HTTP es **sin timeout**. Una
dependencia que se pone lenta — no caída, solo lenta — te va a agotar el pool de
conexiones, después las goroutines, después la memoria. Lento es peor que caído.

## 5. Los reintentos necesitan presupuesto, jitter e idempotencia

*(Cápsulas 17, 19)*

Reintentar es cómo una falla chica se vuelve grande. Tres reglas:

- **Backoff exponencial con full jitter.** Los reintentos sincronizados son un
  DDoS que te hacés solo.
- **Un presupuesto de reintentos** — limitá el total como fracción de los
  requests.
- **Reintentá solo operaciones idempotentes**, o hacelas idempotentes con una
  idempotency key.

Nunca reintentes un 4xx. Va a fallar igual para siempre.

## 6. Diseñá para at-least-once

*(Cápsula 19)*

La entrega *exactly-once* no existe a través de una red. Toda cola, webhook y
camino de reintento te va a dar un duplicado tarde o temprano. Hacé el *handler*
idempotente — un unique constraint, un upsert, o una tabla de mensajes
procesados — y dejá de preocuparte.

## 7. Las migraciones son expand → migrate → contract

*(Cápsula 24)*

No podés deployar código y schema en el mismo instante, así que nunca escribas
una migración que lo requiera.

1. **Expand** — agregá la columna/tabla nueva, nullable. El código viejo no se
   entera.
2. **Migrate** — deployá código que escribe en las dos y lee la nueva con
   fallback. Backfill.
3. **Contract** — cuando nada lee la forma vieja, borrala. Un deploy aparte,
   normalmente días después.

Toda migración tiene que poder correr mientras la versión vieja sigue sirviendo.

## 8. Deploy ≠ release

*(Cápsula 24)*

Publicar un binario y exponerlo a los usuarios son eventos separados. Los traffic
splits y los feature flags te dejan separarlos en la práctica, que es lo que hace
que un rollback tarde segundos en vez de un rebuild.

**Siempre sabé tu comando de rollback antes de deployar.**

## 9. Medí percentiles, nunca promedios

*(Cápsula 09)*

Una latencia promedio de 100 ms con un p99 de 4 s significa que 1 de cada 100
usuarios la pasa pésimo — y los usuarios pesados pegan en el p99 todo el tiempo.
Seguí **p50 / p95 / p99** y, para cualquier cosa de cara al usuario, mirá el
p99.9.

Corolario: un SLO es un número con una *ventana* y un *presupuesto*. "99,9% de
los requests bajo 300 ms en 28 días" es un SLO. "Tiene que ser rápido" es un
deseo.

## 10. Instrumentá las cuatro cosas que importan

*(Cápsula 25)*

**RED** para servicios que responden requests: **R**ate, **E**rrors,
**D**uration.
**USE** para recursos: **U**tilization, **S**aturation, **E**rrors.

Cuidado con la cardinalidad — una métrica con un label que contenga un user ID te
va a salir más cara que el cómputo. (Los scouters explotan cuando leen algo
demasiado grande.)

## 11. La infraestructura es código, y el state es sagrado

*(Cápsula 03)*

Todo lo clickeado en una consola es invisible e irrepetible. Ponelo en Terraform,
commiteálo, revisalo. Guardá el state en un bucket remoto con versionado, nunca
en git. `terraform plan` en CI en cada PR; un plan con destroys inesperados es un
PR bloqueado.

## 12. Los secretos no tocan git

*(Cápsulas 03, 10)*

`.env` en `.gitignore` desde el primer commit. Secret Manager o el almacén de
secretos de tu plataforma en la nube. Si un secreto se commitea, la solución es
rotarlo — no reescribir el historial, porque ya fue clonado.

## 13. Commits chicos con una historia

*(todas las cápsulas)*

Usá prefijos de conventional commits; hacen el historial grepeable y los
changelogs gratis:

```
feat(scouter): add power reading endpoint
fix(cache): prevent stampede with singleflight
perf(db): add composite index on (fighter_id, recorded_at)
refactor(api): extract handler from main
docs(capsule-12): note the resharding trade-off
chore(deps): bump go to 1.23
```

Cada cápsula debería ser al menos un commit en `gravity-chamber`. El historial es
tu evidencia de que entendiste esto en un orden específico.

## 14. Escribí la decisión, no solo el código

*(Cápsula 22, usado en la 26)*

Para cualquier cosa con un trade-off real, dejá un ADR en
`docs/adr/NNN-titulo.md`:

```markdown
# ADR 004 — Shardear readings por fighter_id
## Estado: aceptado (2026-03-02)
## Contexto
El camino de escritura de un solo Postgres se satura a ~4k writes/s; proyectado 12k.
## Decisión
Hash-shard sobre fighter_id en 4 shards lógicos, ruteados en la capa de app.
## Consecuencias
+ Las escrituras escalan lineal. + Las queries por peleador quedan en un shard.
- Los leaderboards globales necesitan scatter-gather. - Resharding es un proyecto.
## Alternativas consideradas
Range sharding (rechazado: hotspots en los IDs recientes). Spanner (rechazado: costo).
```

Seis meses después, esto es la diferencia entre un equipo que puede cambiar el
diseño y uno que le tiene miedo.

## 15. Borrá lo que creaste

*(todas las secciones ☁️)*

El teardown es parte del trabajo, no algo posterior. Acá te protege la billetera.
En el trabajo protege tu presupuesto, tu superficie de ataque, y la capacidad de
tus compañeros de razonar sobre qué hay corriendo.

---

## La versión de una página

> Config del entorno · fallá rápido · liveness ≠ readiness · logs estructurados ·
> deadlines en todos lados · reintentos con jitter y solo idempotentes ·
> asumí duplicados · expand/migrate/contract · deploy ≠ release ·
> percentiles no promedios · RED + USE · IaC con state remoto ·
> secretos fuera de git · commits chicos · ADRs para los trade-offs ·
> siempre hacé teardown.
