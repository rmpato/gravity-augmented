# El Códice del Scouter

Cada nombre clave de este repo mapea a algo real. Si algún nombre te estorba,
buscalo acá — el término real es siempre el que usás en el trabajo, y por eso
queda en inglés.

## Estructura

| Nombre clave | Qué es en realidad |
|---|---|
| **Cápsula** | Una lección. Autocontenida, 30–60 min. Las Cápsulas Hoi-Poi guardan una casa entera en el bolsillo; cada cápsula acá guarda un concepto entero. |
| **Saga** | Un grupo de 4–5 cápsulas que comparten tema. |
| **Power level** | Puntaje de progreso. 340 por cápsula, 9000 en total. |
| **Scouter** | La CLI de progreso — y, desde la Cápsula 25, tu stack real de observabilidad. Las dos leen niveles de pelea. |
| **Cámara de Gravedad** (*Gravity Chamber*) | *Tu* repo. Donde construís de verdad. La carga sube en cada cápsula. |
| **Senzu** | La sección de troubleshooting de una cápsula. Te levanta cuando el lab se rompe. |
| **Battle drill** | Preguntas tipo entrevista al final de cada cápsula. |

## Escala y cómputo

| Nombre clave | Qué es en realidad |
|---|---|
| **Kaio-ken ×N** | *Vertical scaling*. Más potencia del mismo cuerpo, a un costo creciente y con riesgo de romperte solo. |
| **Técnica de Multiformas** | *Horizontal scaling*. Ten-Shin-Han se divide en cuatro; cada copia tiene una *fracción* del poder original — que es exactamente el trade-off. |
| **Nave saiyajin / attack ball** | Un *container*. Tamaño estándar, descartable, lleva a un peleador a cualquier lado. |
| **Cápsula #9** | Una *container image* — lo que tirás al piso para obtener una instancia corriendo. |
| **La Torre de Karin** | Un *load balancer*. Todo sube por ahí antes de llegar arriba. |
| **El escritorio de Enma Daio** | Un *API gateway* / *reverse proxy*. Toda alma pasa por un solo escritorio: le verifican la identidad, la juzgan contra una política y la rutean al destino correcto. Nada llega al backend sin pasar por ahí. |
| **El Camino de la Serpiente** | El camino lento. Un millón de kilómetros de latencia entre el gateway y donde realmente querías llegar. |
| **La Habitación del Tiempo** | *Load testing*. Un año de tráfico comprimido en un día, en un entorno del que podés salir. |
| **Nube Voladora** | Cómputo efímero. Aparece al instante, te lleva, desaparece. *Scale to zero*. |

## Datos

| Nombre clave | Qué es en realidad |
|---|---|
| **El Archivo del Gran Patriarca** | La base de datos relacional primaria. Un namekiano viejo que se acuerda de todos los registros. |
| **El Radar del Dragón** | Un *index*. Sin él buscás en todo el planeta; con él vas derecho a la esfera. |
| **Las Siete Esferas del Dragón** | *Sharding*. Un dataset partido a propósito en pedazos repartidos por el mundo, inútiles por separado, completos juntos. |
| **Fusión namekiana** | *Replication* y consistencia. Dos entidades, una verdad — y la pregunta difícil de quién gana ante un conflicto. |
| **Porunga vs Shenron** | Dos bases de datos con garantías distintas para el mismo trabajo (tres deseos vs uno, restricciones distintas). Elegí según el workload. |
| **El Patriarca liberando potencial** | Capacidad que ya existía pero no era alcanzable hasta que ajustaste algo. |

## Latencia

| Nombre clave | Qué es en realidad |
|---|---|
| **Semilla del Ermitaño** (*Senzu*) | Un *cache*. Recuperación instantánea, en cantidad limitada, y peligroso como dependencia. |
| **Tácticas de las Fuerzas Ginyu** | Modos de falla de cache — *stampedes*, *thundering herds*, y las poses que arruinan tu presupuesto de latencia. |
| **Teletransportación** | *CDN* / *edge caching*. Entrega a distancia cero — pero solo a un lugar donde ya estuviste (un POP caliente). |
| **Suprimir el ki** | *Rate limiting* y *throttling*. Emitir a propósito menos de lo que podés. |
| **Sentir el ki** | *Health checks* y descubrimiento de servicios sin registro central. |

## Asincronía

| Nombre clave | Qué es en realidad |
|---|---|
| **Telepatía de Kaio-sama** | *Pub/Sub*. Un emisor, muchas mentes, sin conexión directa entre ellas. |
| **La absorción de Cell** | Semánticas de consumo — entrega *at-least-once*, duplicados, y por qué importa la idempotencia. |
| **Genkidama** | *Fan-in* / agregación. Miles de contribuciones mínimas juntadas en un resultado. |
| **La máquina del tiempo de Trunks** | *Event sourcing* y *replay*. El log es la verdad; reproducirlo crea una línea temporal nueva. |
| **La Zona Muerta** | Una *dead-letter queue*. Adonde van los mensajes que no se pueden procesar. |

## Servicios y operación

| Nombre clave | Qué es en realidad |
|---|---|
| **Danza de la Fusión** | Composición de servicios. Errá un poco los pasos y producís algo peor que cualquiera de las mitades — el *distributed monolith*. |
| **Pendientes Potara vs Danza de la Fusión** | Acoplamiento permanente (una librería o base de datos compartida) vs una integración reversible y acotada (una API). |
| **El Gran Saiyaman** | Un *Backend for Frontend*. Gohan es el mismo peleador, pero se pone una presentación completamente distinta para el público de Ciudad Satán que la que usa en los Juegos de Cell. Mismo dominio abajo, una fachada por audiencia. |
| **Cambio de Cuerpo de Ginyu** | Deploys *blue/green* y *canary*. La misma alma, otro cuerpo, el tráfico movido. |
| **Scouter Mk. II** | Observabilidad: métricas, logs, traces, SLOs. Los scouters explotan cuando leen algo demasiado grande — una lección sobre cardinalidad. |
| **Dende** | *Health checks* y auto-recuperación. |
| **El Templo de Kami** | El *control plane*. Por encima del sistema, mirándolo, sin servir tráfico. |
| **El Registro de Kami** | IAM. Quién puede entrar, quién puede tomar el Agua Ultra Divina, quién puede invocar a Shenron. |
| **El Torneo del Poder** | El capstone. Todo lo que tenés, con límite de tiempo, con jurado. |

## Término real → nombre clave (búsqueda inversa)

autoscaling → Kaio-ken / Multiformas · CDN → Teletransportación ·
cache → Senzu · circuit breaker → Suprimir el ki · DLQ → Zona Muerta ·
idempotencia → Absorción de Cell · index → Radar del Dragón ·
load balancer → Torre de Karin · load test → Habitación del Tiempo ·
observabilidad → Scouter Mk. II · Pub/Sub → Kaio-sama ·
replicación → Fusión namekiana · sharding → Esferas del Dragón ·
límite de servicio → Danza de la Fusión · traffic split → Cambio de Cuerpo ·
API gateway / reverse proxy → Escritorio de Enma Daio · BFF → El Gran Saiyaman ·
IAM → El Registro de Kami
