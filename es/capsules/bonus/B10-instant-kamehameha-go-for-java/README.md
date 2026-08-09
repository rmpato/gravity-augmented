# Cápsula B10 · Kamehameha Instantáneo — Go para quien ya programa

> *Goku aprende el Kamehameha mirando a Roshi hacerlo una sola vez. No aprende
> a pelear — ya sabe pelear. Aprende una forma nueva para un poder que ya tenía.*

| Power level | Tiempo | Prerrequisitos | Mejor antes de |
|---|---|---|---|
| Bonus · 150 | 70 min | sabés escribir código en **algún** lenguaje | Cápsula 01 |

---

## Por qué existe esta cápsula

Todas las cápsulas de este repo están escritas en Go, y ninguna se detiene a
enseñarlo. Eso es a propósito — Go es el vehículo, no el tema. Pero si nunca lo
escribiste, la primera cápsula te cuesta el doble: estás aprendiendo connection
pooling *y* preguntándote por qué hay un `err != nil` en todos lados.

Esta cápsula te lleva a "puedo leer y modificar el código de estas cápsulas" en
una sola sesión. **No** es un tutorial de Go. Es una capa de traducción.

Las comparaciones de abajo van contra **Java**, porque es el background más
común con el que llega la gente y porque los dos lenguajes se contradicen en
lugares interesantes. **Si no sabés Java no perdés nada** — cada fragmento de
Java está marcado y es salteable, y el Go siempre se sostiene solo. Si venís de
Python, TypeScript, C# o Kotlin aplican los mismos cambios de chip; lo único que
cambia es la columna del "antes".

> Si Go es uno de tus *primeros* lenguajes, arrancá por
> [B11 · Escuela de la Tortuga](../B11-turtle-school-go-basics/README.md). Enseña
> el toolchain — `go vet`, `gofmt`, `go test`, módulos — y las reglas que impone
> el compilador, que esta cápsula da por sabidas.

> Si ya escribís Go, saltá esto y andá a
> [B5 · Imagen Residual](../B5-afterimage-go-concurrency/README.md), que cubre
> la concurrencia que vas a necesitar de verdad.

---

## El lore

El Kamehameha no es poder nuevo. Goku ya tenía el ki; Roshi le mostró una forma
donde ponerlo. Eso es esta cápsula — ya sabés loops, tipos, funciones, errores y
concurrencia. Lo que necesitás son las formas en las que Go los pone, y los
cuatro o cinco lugares donde la forma de Go es genuinamente *distinta* en vez de
estar simplemente escrita distinto.

Esos cuatro o cinco son toda la cápsula. El resto lo podés adivinar.

---

## Las cinco cosas que sí son distintas

Si no te acordás de nada más, acordate de estas. Todo lo demás es sintaxis que
vas a absorber leyendo.

| # | El cambio de chip | Por qué importa acá |
|---|---|---|
| 1 | **Las interfaces son implícitas** | Por esto funciona `Store` en la Cápsula 06 y por esto cada decorator de la 12 a la 17 compone sin tocar la interfaz |
| 2 | **Los errores son valores, no control de flujo** | No hay `try`. El `if err != nil` que vas a tipear 200 veces es el punto, no el ruido |
| 3 | **No hay herencia — composición y embedding** | Las cápsulas 12–17 envuelven `Store` cinco veces. En un lenguaje con herencia eso es una jerarquía de cinco niveles |
| 4 | **Los zero values se usan tal cual** | `var mu sync.Mutex` ya está listo. Sin constructor, sin chequeo de `null` |
| 5 | **La concurrencia es barata y está en el lenguaje** | Una goroutine por request es lo normal, no una decisión de diseño |

---

## 1 · Interfaces implícitas — la grande

**Java:** una clase declara qué implementa. La interfaz tiene que existir
primero, y quien la implementa tiene que conocerla.

```java
// JAVA — skip if unfamiliar
public interface Store { Reading latest(String fighter); }
public class MemStore implements Store {   // <- explicit declaration
    public Reading latest(String fighter) { ... }
}
```

**Go:** un tipo satisface una interfaz por tener los métodos correctos. Nunca lo
declara. Ni siquiera tiene que saber que la interfaz existe.

```go
type Store interface {
	Latest(fighter string) (Reading, bool)
}

type MemStore struct{ /* … */ }

// No "implements". MemStore satisfies Store because it has the method.
func (m *MemStore) Latest(fighter string) (Reading, bool) { /* … */ }
```

Esto invierte quién es dueño de la interfaz. En Java la interfaz suele vivir con
la implementación y se exporta hacia abajo. En Go, **declarás la interfaz donde
la consumís**, listando solo los métodos que realmente llamás.

Esa es la idea más útil de esta cápsula, y es por lo que funciona todo el arco
del Scouter:

```go
// internal/scouter/server.go — the SERVER declares what it needs.
// PostgresStore, ShardedStore, ReplicatedStore, CachedStore and a test fake
// all satisfy it. None of them import this file.
type Store interface {
	Record(r Reading) error
	Latest(fighter string) (Reading, bool)
	Leaderboard(n int) []Reading
}
```

Para la Cápsula 17 lo real es
`CachedStore{ ReplicatedStore{ ShardedStore{ PostgresStore } } }` — cuatro
wrappers, cada uno satisfaciendo `Store`, cada uno sin saber de los otros.
Agregar un quinto no requiere cambiar nada. En un lenguaje de interfaces
explícitas cada capa tiene que nombrar la interfaz, y la interfaz se vuelve algo
que negociás con otros equipos.

> **La regla que repite la gente de Go:** *aceptá interfaces, devolvé structs.*
> Tu función recibe la interfaz más angosta que pueda, y devuelve un tipo
> concreto para que quien llama se quede con todos los métodos.

### La trampa de la interfaz nil

Esta le pega a todo el mundo una vez, y vale 60 segundos ahora para que te
cueste minutos y no una tarde entera.

Un valor de interfaz guarda **dos** cosas: un tipo y un valor. Es `nil` solo
cuando *las dos* son nil.

```go
type MyError struct{ msg string }
func (e *MyError) Error() string { return e.msg }

func broken() error {
	var e *MyError = nil // a nil POINTER
	return e             // wrapped in an interface: type=*MyError, value=nil
}

func main() {
	if broken() != nil {
		fmt.Println("this prints!") // the interface is NOT nil
	}
}
```

**La solución es un hábito, no una técnica:** declará el retorno como `error` y
devolvé el `nil` literal, nunca un puntero nil tipado.

```go
func fixed() error {
	return nil // untyped nil — genuinely nil
}
```

---

## 2 · Los errores son valores

**Java:** las excepciones suben solas por el stack. Vos anotás con `throws` o
capturás.

```java
// JAVA — skip if unfamiliar
try {
    Reading r = store.latest("goku");
} catch (StoreException e) {
    log.error("failed", e);
}
```

**Go:** una función devuelve su error al lado de su resultado. Nada se propaga
solo.

```go
r, err := store.Latest(ctx, "goku")
if err != nil {
	return fmt.Errorf("latest reading for goku: %w", err)
}
```

Tres cosas para internalizar:

- **Los múltiples valores de retorno son normales.** `(result, error)` es la
  forma estándar, y `(value, ok)` es la forma estándar para búsquedas.
- **`%w` envuelve.** Arma una cadena que después podés inspeccionar con
  `errors.Is` (comparación contra un centinela) y `errors.As` (extracción por
  tipo). Es el equivalente de Go a la cadena de causas de una excepción.
- **El mensaje de error lo construye quien llama,** que es por lo que los
  errores de Go se leen como un camino: `record reading: query fighters:
  connection refused`. Cada capa agrega *su* contexto. No agregues el nombre de
  la función — agregá qué estaba intentando hacer.

```go
// The two you'll actually use:
if errors.Is(err, sql.ErrNoRows) { /* sentinel: is this THAT error? */ }

var pgErr *pgconn.PgError
if errors.As(err, &pgErr) { /* type: pull the rich error out of the chain */ }
```

`panic` existe y **no** es el mecanismo de excepciones. Es para "este programa
está roto", no para "este request falló". No lo vas a usar prácticamente nunca.
El servidor HTTP de la Cápsula 01 se recupera de un panic en un handler sin
matar el proceso, y esa es la única razón por la que aparece.

---

## 3 · Structs y embedding, no clases

No hay `class`, no hay `extends`, y no hay palabra clave de constructor.

```go
type Reading struct {
	Fighter    string    `json:"fighter"`
	Power      int64     `json:"power"`
	RecordedAt time.Time `json:"recorded_at"`
}

// A "constructor" is just a function that returns one, by convention New*.
func NewReading(fighter string, power int64) Reading {
	return Reading{Fighter: fighter, Power: power, RecordedAt: time.Now()}
}
```

Esos strings con backticks son **struct tags** — metadata que `encoding/json`
lee en runtime. El análogo más cercano en Java: `@JsonProperty`. Así es como las
cápsulas de API controlan el JSON que va por el cable sin una capa de mapeo.

**Los métodos se declaran fuera del tipo**, con un receiver:

```go
// value receiver — gets a COPY. Fine for small read-only structs.
func (r Reading) IsOver9000() bool { return r.Power > 9000 }

// pointer receiver — can mutate, and avoids copying. Use this by default
// once a type has any state worth protecting.
func (m *MemStore) Record(r Reading) error { /* … */ }
```

> **Elegí uno y mantenelo por tipo.** Mezclar receivers por valor y por puntero
> en el mismo tipo es el comentario de review más común en código Go nuevo,
> porque solo el tipo puntero termina satisfaciendo una interfaz que incluya un
> método con receiver por puntero.

### Embedding no es herencia

```go
type Base struct{ ID string }
func (b Base) Describe() string { return "id=" + b.ID }

type Fighter struct {
	Base          // embedded — no field name
	Name string
}

f := Fighter{Base: Base{ID: "f_1"}, Name: "goku"}
f.Describe()    // works: promoted from Base
f.ID            // works: promoted field
```

Parece herencia. Es **delegación con azúcar sintáctico** — y la diferencia es la
que importa: no hay dispatch virtual. Si `Base` tiene un método que llama a
`Describe()`, llama a **`Base.Describe`**, siempre. Nunca va a despachar a un
`Fighter.Describe` que definiste después.

Si venís de Java: todos los patrones template-method que conocés no funcionan
acá. La respuesta de Go es pasar el comportamiento variable como una interfaz o
un valor de función, que es lo que hacen el middleware de la Cápsula 01 y los
decorators de la 14 a la 17.

---

## 4 · Zero values, slices, maps

**Todo tipo tiene un zero value usable**, y el Go idiomático se apoya fuerte en
eso.

```go
var mu sync.Mutex     // ready to Lock(). No initialisation.
var buf bytes.Buffer  // ready to Write().
var s []string        // nil, but append() works and len() is 0
var count int         // 0
var name string       // "" — NOT null. There is no null string.
```

Esa última línea importa más de lo que parece: Go no tiene `null` para los tipos
por valor, así que toda la categoría del `NullPointerException` de Java sobre un
`String` simplemente no existe. Los punteros sí pueden ser nil, y ese es el único
lugar donde mirar.

### Los slices ≈ ArrayList, con un filo

```go
xs := []int{1, 2, 3}
xs = append(xs, 4)        // append RETURNS a new slice — you must reassign
ys := xs[1:3]             // [2 3] — a VIEW, not a copy. Shares the backing array.
ys[0] = 99                // xs is now [1 99 3 4]
```

Lo compartido es el filo, y es genuinamente distinto de un `ArrayList` y de las
listas de Python. Cuando necesitás independencia, copiá explícitamente:

```go
zs := make([]int, len(xs))
copy(zs, xs)
```

### Los maps ≈ HashMap

```go
m := map[string]int{"goku": 9001}
v, ok := m["vegeta"]      // v == 0, ok == false. The two-value form.
delete(m, "goku")
```

Dos cosas que Java no hace: leer una clave inexistente devuelve el **zero
value** en vez de null, y **los maps no son seguros para uso concurrente** — dos
escrituras concurrentes matan el proceso con `fatal error: concurrent map
writes`, del cual no te podés recuperar. Ese crash es exactamente el bug que la
Cápsula 01 planta a propósito y que la Cápsula 06 explica.

---

## 5 · Concurrencia

```go
go handleRequest(r)   // that's a goroutine. Cheap: a few KB, not a few MB.
```

**Java:** `new Thread(...)` mapea a un thread del sistema operativo; usás un
pool porque los threads son caros. Los virtual threads (Loom) cierran casi toda
esta brecha, pero el modelo mental de "los threads son escasos" es alrededor de
lo que está escrito casi todo el código Java.

**Go:** el runtime multiplexa las goroutines sobre una cantidad chica de threads
del SO. Una por request es el diseño normal, no uno inteligente. El servidor
HTTP de Go ya hace esto por vos — lo que significa que **todo handler que
escribas en este repo ya es concurrente**, hayas pensado en eso o no.

```go
var wg sync.WaitGroup
for _, f := range fighters {
	wg.Add(1)
	go func() {
		defer wg.Done()
		process(f)     // Go 1.22+: `f` is per-iteration. Older Go: it was NOT.
	}()
}
wg.Wait()
```

Los channels son tuberías tipadas, y el idiom que más vas a ver es un `select`
con un context:

```go
select {
case res := <-results:
	return res, nil
case <-ctx.Done():
	return nil, ctx.Err()   // caller gave up, or the deadline passed
}
```

`context.Context` es el primer parámetro de casi toda función de este repo.
Lleva deadlines y cancelación *hacia abajo* por el árbol de llamadas. No tiene
un equivalente de uso extendido en Java — tratalo como un parámetro que pasás
por todos lados y que nunca guardás en un struct.

Esa es la forma. [B5 · Imagen Residual](../B5-afterimage-go-concurrency/README.md)
es el tratamiento real, incluyendo el race detector.

---

## `defer` ≈ `finally`, pero por sentencia

```go
f, err := os.Open("x")
if err != nil {
	return err
}
defer f.Close()   // runs when the FUNCTION returns, whatever path it takes
```

Las llamadas diferidas corren last-in-first-out. La diferencia crítica con
`finally`: **los argumentos se evalúan de inmediato**, solo la llamada se
difiere.

```go
start := time.Now()
defer log.Info("done", "ms", time.Since(start).Milliseconds()) // ❌ evaluated NOW: always 0
defer func() { log.Info("done", "ms", time.Since(start).Milliseconds()) }() // ✅
```

El idiom del mutex que vas a ver en todas las cápsulas:

```go
func (m *MemStore) Record(r Reading) error {
	m.mu.Lock()
	defer m.mu.Unlock()   // released on every return path, including a panic
	m.data[r.Fighter] = r
	return nil
}
```

---

## Visibilidad, packages, módulos

**La mayúscula es el modificador de acceso.** No hay `public` ni `private`.

```go
func Record(...)   // exported — visible outside the package
func record(...)   // unexported — package-private
type Reading struct {
	Fighter string  // exported field: marshalled to JSON
	secret  string  // unexported: invisible to encoding/json
}
```

No hay `protected`, y package-private es el *único* otro nivel. Ese último
comentario del struct es un gotcha real: `encoding/json` solo puede ver campos
exportados, así que un campo en minúscula desaparece en silencio de la respuesta
de tu API.

| Java | Go |
|---|---|
| `package com.example.scouter` | el directorio es el package; nombre corto en minúscula |
| Maven / Gradle | `go.mod` |
| `mvn dependency:tree` | `go mod graph` |
| anidamiento profundo `src/main/java/...` | directorios planos y chatos |
| `public` / `private` / `protected` | `Mayúscula` / `minúscula` |
| jar | un único binario estático |

Dos reglas propias de Go sin análogo en Java:

- **`internal/` lo impone el compilador.** Nada bajo `internal/` puede ser
  importado por otro módulo. La Cápsula 00 arma esto a propósito — es la única
  frontera que impone un compilador y no un linter.
- **Los imports y las variables locales sin usar son errores de compilación**,
  no warnings. Es chocante por un día y después dejás de notarlo.

---

## La sintaxis que podés adivinar

Pasale el ojo a esta tabla; no la estudies.

| Java | Go |
|---|---|
| `String s = "x";` | `s := "x"` (inferido) o `var s string = "x"` |
| `final int x = 5;` | `const x = 5` |
| `for (int i = 0; i < n; i++)` | `for i := 0; i < n; i++` |
| `for (String f : fighters)` | `for _, f := range fighters` |
| `while (cond)` | `for cond` |
| `while (true)` | `for` |
| `if/else if/else` | igual, sin paréntesis en la condición |
| `switch` con `break` | `switch` — **sin fallthrough por defecto** |
| `List<String>` | `[]string` |
| `Map<String, Integer>` | `map[string]int` |
| `Optional<T>` | `(T, bool)` o `(T, error)` |
| `null` | `nil` (solo punteros, slices, maps, channels, funcs, interfaces) |
| `toString()` | `String() string` |
| `equals()` | `==` para tipos comparables; `reflect.DeepEqual` si no |
| `@Override` | nada — no existe el overriding |
| `System.out.println` | `fmt.Println` |
| `Thread.sleep(1000)` | `time.Sleep(time.Second)` |
| `@Test` de JUnit | `func TestX(t *testing.T)` en `*_test.go` |
| `assertEquals(a, b)` | `if a != b { t.Errorf(...) }` — no hay librería de assertions en la stdlib |

El formato no es una preferencia: `gofmt` es canónico, viene con el toolchain, y
todo repo de Go está formateado idéntico. Nadie te revisa dónde ponés las llaves
porque no hay nada que revisar.

---

## Lab — traducí algo real

La mejor forma de chequear que esto quedó es leer código que vas a encontrar en
la Cápsula 01 *antes* de llegar ahí.

### Paso 1 — un archivo Go, desde cero

```bash
mkdir -p ~/go-warmup && cd ~/go-warmup
go mod init warmup
```

**`main.go`**

```go
package main

import (
	"errors"
	"fmt"
	"sort"
	"sync"
)

// Reading is a power-level measurement. Exported fields only — an unexported
// field would be invisible to encoding/json later.
type Reading struct {
	Fighter string
	Power   int64
}

// ErrUnknownFighter is a SENTINEL error: callers compare against it with
// errors.Is instead of matching on a message string.
var ErrUnknownFighter = errors.New("unknown fighter")

// Store is declared here, where it is USED. Any type with these two methods
// satisfies it — without importing this file or naming this interface.
type Store interface {
	Record(r Reading) error
	Top(n int) []Reading
}

type MemStore struct {
	mu   sync.RWMutex          // zero value is ready to use
	data map[string]Reading    // a map must be MADE before writing
}

func NewMemStore() *MemStore {
	return &MemStore{data: make(map[string]Reading)}
}

func (m *MemStore) Record(r Reading) error {
	if r.Fighter == "" {
		return fmt.Errorf("record: %w", ErrUnknownFighter)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if cur, ok := m.data[r.Fighter]; !ok || r.Power > cur.Power {
		m.data[r.Fighter] = r
	}
	return nil
}

func (m *MemStore) Top(n int) []Reading {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]Reading, 0, len(m.data)) // len 0, capacity len(m.data)
	for _, r := range m.data {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Power > out[j].Power })
	if n < len(out) {
		out = out[:n]
	}
	return out
}

func main() {
	// The variable is typed as the INTERFACE, assigned a concrete value.
	var s Store = NewMemStore()

	for _, r := range []Reading{
		{"goku", 9001}, {"vegeta", 8500}, {"krillin", 1770}, {"goku", 150},
	} {
		if err := s.Record(r); err != nil {
			fmt.Println("failed:", err)
		}
	}

	if err := s.Record(Reading{Power: 1}); errors.Is(err, ErrUnknownFighter) {
		fmt.Println("rejected as expected:", err)
	}

	for i, r := range s.Top(2) {
		fmt.Printf("%d. %-8s %d\n", i+1, r.Fighter, r.Power)
	}
}
```

```bash
go run .
```

```
rejected as expected: record: unknown fighter
1. goku     9001
2. vegeta   8500
```

Fijate que `goku` quedó en 9001 — `Record` se queda con el máximo, que es por lo
que la segunda lectura de 150 no lo pisó.

### Paso 2 — un test, y el race detector

**`main_test.go`**

```go
package main

import (
	"sync"
	"testing"
)

func TestRecordKeepsMax(t *testing.T) {
	s := NewMemStore()
	_ = s.Record(Reading{"goku", 100})
	_ = s.Record(Reading{"goku", 9001})
	_ = s.Record(Reading{"goku", 50})

	got := s.Top(1)
	if len(got) != 1 || got[0].Power != 9001 {
		t.Fatalf("Top(1) = %v, want goku 9001", got)
	}
}

// The test that matters. Run it with -race.
func TestConcurrentRecord(t *testing.T) {
	s := NewMemStore()
	var wg sync.WaitGroup
	for i := range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = s.Record(Reading{"goku", int64(i)})
		}()
	}
	wg.Wait()
}
```

```bash
go test -race ./...
```

Los dos tienen que pasar. **Ahora rompelo a propósito** — comentá el
`m.mu.Lock()` y el `defer m.mu.Unlock()` de `Record`:

```bash
go test -race ./...
```

```
==================
WARNING: DATA RACE
Read at 0x00c0000a4450 by goroutine 8:
  runtime.mapassign_fast64ptr()
  warmup.(*MemStore).Record()
      .../main.go:43 +0x104
```

(Los números de goroutine y las direcciones cambian de corrida en corrida, y el
race detector muestrea — si una corrida sale limpia, correla de nuevo.)

Esa es la herramienta más valiosa del toolchain de Go, y es un solo flag. Volvé
a poner el lock.

> Ojo con `for i := range 100` — el range sobre enteros es Go 1.22+. Si eso no
> compila, tu Go es muy viejo; la Cápsula 00 cubre cómo arreglarlo.

### Paso 3 — leé para adelante

Abrí la [Cápsula 01](../../01-scouter-first-service/README.md) y leé el código
de `MemStore` y del handler **sin hacer la cápsula**. Ahora deberías reconocer:
la sintaxis del receiver, `(value, ok)`, `if err != nil`, `defer mu.Unlock()`, la
interfaz declarada en el punto de uso, y los struct tags.

Si algo de eso todavía te parece ruido, esa es la sección para releer acá.

---

## Llevátelo al trabajo

- **Declará las interfaces donde las consumís, no donde las implementás.** Este
  consejo es portable — es el Principio de Inversión de Dependencias con la
  ceremonia sacada, y funciona en Java también. Go simplemente lo convierte en
  el camino de menor resistencia.
- **Los errores como valores te obligan a decidir en cada call site.** Vas a
  notar cuántas excepciones en tu código Java se capturan tres frames más arriba
  de donde se podía tomar una decisión sensata.
- **Un build que falla por variables sin usar** atrapa una clase real de
  refactor a medio terminar. Vale la pena quererlo en cualquier lenguaje.
- **Un único formateador canónico, sin opciones.** La discusión sobre formato
  vale más que el formato en sí, y `gofmt` la termina.

---

## Battle drill

<details>
<summary><b>1.</b> Una función declara <code>*MyError</code> como tipo de retorno y devuelve <code>nil</code>. El <code>if err != nil</code> de quien llama da true. ¿Por qué?</summary>

El tipo de retorno declarado es un puntero concreto, así que devolverlo como una
interfaz `error` produce un valor con tipo `*MyError` y valor `nil`. Una interfaz
es nil solo cuando **las dos** mitades son nil, así que el chequeo falla.

Declará el tipo de retorno como `error` y devolvé un `nil` literal. La lección
general: un valor de interfaz es un par (tipo, valor), y de ahí sale casi toda la
confusión con nil en Go.
</details>

<details>
<summary><b>2.</b> Embebés <code>Base</code> en <code>Fighter</code> y definís <code>Fighter.Describe()</code>. Un método de <code>Base</code> llama a <code>Describe()</code>. ¿Cuál corre?</summary>

`Base.Describe`. Siempre. El embedding es delegación, no herencia — no hay
dispatch virtual, así que un método base nunca puede llamar a un override
derivado.

Todo diseño template-method que escribirías en Java hay que reestructurarlo:
pasás el comportamiento variable como una interfaz o un valor de función. Eso es
lo que hace la cadena de middleware de la Cápsula 01.
</details>

<details>
<summary><b>3.</b> ¿Por qué <code>ys := xs[1:3]</code> es peligroso de una forma en que <code>subList</code> o un slice de Python no lo son?</summary>

El slice de Go es una vista sobre un array subyacente compartido, así que
escribir a través de `ys` muta `xs`. (Python copia; el `subList` de Java es una
vista pero de una `List`, y su comportamiento ante modificación estructural está
al menos ruidosamente documentado.)

La versión más sutil: hacer `append` sobre un slice con capacidad de sobra
escribe **dentro del array compartido**, cambiando en silencio el contenido de
otro slice. Cuando necesitás independencia, `make` + `copy`.
</details>

<details>
<summary><b>4.</b> Tu struct tiene un campo <code>fighter string</code> y nunca aparece en la respuesta JSON. ¿Por qué?</summary>

Está en minúscula, así que no está exportado, así que `encoding/json` — que usa
reflection y solo puede ver campos exportados — no lo puede leer. Sin error, sin
warning, el campo simplemente no está.

Ponelo en mayúscula, y agregá un tag `json:"fighter"` para controlar el nombre
que va por el cable.
</details>

<details>
<summary><b>5.</b> Dos goroutines escriben al mismo map. ¿Qué pasa, y por qué es peor que una race sobre un <code>HashMap</code> de Java?</summary>

`fatal error: concurrent map writes` — el runtime lo detecta y mata **el proceso
entero**. No es un panic y `recover()` no lo puede atrapar.

Una race sobre un `HashMap` de Java corrompe el map y puede colgarse o dar
resultados incorrectos, lo cual es discutiblemente peor de debuggear pero no te
tira el servicio abajo. Go eligió ruidoso e inmediato. Protegelo con un mutex, o
usá `sync.Map` para los casos específicos read-mostly para los que está hecho — y
corré `go test -race` en CI.
</details>

---

## Senzu

| Síntoma | Solución |
|---|---|
| `declared and not used` | Las locales sin usar son errores, no warnings. Borrala, o asignala a `_`. |
| `imported and not used` | Lo mismo para los imports. Tu editor debería hacerlo al guardar — configurá `gopls`. |
| `cannot use x (type T) as type I` | Tu tipo no tiene todos los métodos de la interfaz — muchas veces porque definiste los métodos sobre `T` pero estás asignando un `*T`, o al revés. Revisá los receivers. |
| `invalid memory address or nil pointer dereference` | Un puntero nil. El stack trace de Go te da la línea exacta; a diferencia de un NPE no hay null para strings/ints que lo confunda. |
| `fatal error: concurrent map writes` | Acceso a un map sin sincronizar. No es recuperable. Agregá un mutex y volvé a correr con `-race`. |
| La variable del `for` se captura mal en una goroutine | Go 1.22+ le da scope por iteración. En Go más viejo necesitabas `f := f` — si ves ese idiom en código viejo, por eso es. |
| `go: cannot find main module` | Estás fuera de un módulo. `go mod init <nombre>`. |
| Los tests no corren | El archivo tiene que terminar en `_test.go` y la función tiene que ser `TestXxx(t *testing.T)` — T mayúscula, nombre exportado. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done B10
```

**Siguiente:** [Cápsula 01 · Scouter — Tu primer servicio](../../01-scouter-first-service/README.md),
que es donde todo esto deja de ser teoría. O
[B5 · Imagen Residual](../B5-afterimage-go-concurrency/README.md) si querés el
tratamiento de concurrencia primero.
