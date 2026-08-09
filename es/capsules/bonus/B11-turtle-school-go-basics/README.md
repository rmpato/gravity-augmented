# Cápsula B11 · Escuela de la Tortuga — Go desde cero y las herramientas del día a día

> *Antes de enseñarle una técnica a nadie, Roshi lo manda a repartir leche a
> pie, a arar un campo con las manos y a nadar escapándole a un tiburón. Goku
> quiere el Kamehameha. Le dan un carrito de leche. El entrenamiento parece no
> tener nada que ver con pelear, y un día le sacan el caparazón y es más rápido
> que todos los que se lo saltearon.*

| Power level | Tiempo | Prerrequisitos | Mejor antes de |
|---|---|---|---|
| Bonus · 150 | 120 min, más un cheatsheet que te queda | sabés escribir un `for` en *algún* lenguaje; Go 1.22+ instalado (Cápsula 00) | Cápsula 01 |

---

## Por qué existe esta cápsula

El curso está escrito en Go y nunca se detiene a enseñarlo.
[B10 · Kamehameha Instantáneo](../B10-instant-kamehameha-go-for-java/README.md)
cubre el lenguaje para gente que ya programa en otra cosa — asume que sabés qué
es una herramienta de build, que tenés opiniones sobre formato, y que "correr
los tests" es una frase que ya tipeaste.

Esta va abajo de aquella. Es para quien está en su primer o segundo laburo y se
encuentra con Go como uno de sus primeros lenguajes, y enseña la parte que nadie
escribe: **los cinco comandos que vas a tipear todo el día, qué te está gritando
el compilador, y por qué Go se siente todo el tiempo como si te estuviera
retando.**

Go es un lenguaje *opinionado*. Cosas que en otros lados son preferencias de
estilo, acá son errores de compilación. Cosas que en otros lados son una
elección de librería, acá vienen en la herramienta. Eso desorienta durante una
semana — y el punto es justamente que después de esa semana, cualquier codebase
de Go que abras se parece a la que dejaste.

Nada de acá es profundo. Es lo que hace que el primer mes cueste la mitad.

> **¿Ya estás cómodo en otro lenguaje?** Leé
> [B10](../B10-instant-kamehameha-go-for-java/README.md) en su lugar, o leé esta
> rápido por la parte de herramientas y saltá al cheatsheet.

---

## Cómo usar esta página

Son dos documentos abrochados juntos, a propósito.

1. **Leela una vez, en orden, con una terminal abierta.** Las partes 1 a 7
   construyen las herramientas y los hábitos, y el **Lab** del final comete
   todos esos errores deliberadamente, así ya viste cada mensaje antes de que te
   pase en serio.
2. **Después volvé [al cheatsheet](#el-cheatsheet)** cada vez que estés en medio
   de algo y no te acuerdes si es `go mod tidy` o `go tidy mod`. Está al final,
   es todo tablas, y asume que ya leíste el resto.

Guardate esta página. Está pensada para volver a abrirla.

---

## El lore

El entrenamiento de Roshi no es sobre fuerza, es sobre volver automático lo
aburrido. Repartís la leche todas las mañanas y un día te das cuenta de que
venís subiendo la montaña corriendo sin pensarlo.

El toolchain de Go es el carrito de leche. `gofmt`, `go vet` y `go test` no son
herramientas avanzadas a las que ascendés — son las primeras tres cosas que
corrés, todos los días, siempre, y son la razón por la que los equipos de Go
discuten de diseño en vez de discutir de llaves.

El caparazón con peso es el compilador. Se niega a cosas que otros lenguajes
permiten, te da bronca, y después te lo sacás en un code review donde nadie
tuvo que mencionar que te dejaste un import sin usar.

---

## Parte 1 — El toolchain es la mitad del lenguaje

Go trae un solo binario, `go`, y es el sistema de build, el test runner, el
package manager, el formateador, el navegador de documentación y el analizador
estático. No hay Maven, no hay npm, no hay un `Makefile` que tengas que escribir
primero, y no hay ningún plugin para instalar.

Esa es la diferencia práctica más grande con el lugar del que venís, y es por
eso que un repo de Go puede no tener absolutamente ninguna configuración de
build.

### Los comandos, en el orden en que los vas a conocer

| Comando | Qué hace | Cuándo lo tipeás |
|---|---|---|
| `go version` | imprime la versión del toolchain | lo primero, cuando algo está raro |
| `go mod init <nombre>` | arranca un módulo — crea `go.mod` | una vez por proyecto, en la vida |
| `go run .` | compila a un directorio temporal y lo ejecuta | el loop interno mientras escribís |
| `go build ./...` | compila todo, reporta errores | "¿todavía compila?" |
| `go test ./...` | corre todos los tests de todos los paquetes | antes de cada commit |
| `gofmt -l .` | lista los archivos sin formatear | en CI; tu editor ya lo hace al guardar |
| `go vet ./...` | chequeos estáticos que el compilador no hace | antes de cada commit, junto con los tests |
| `go doc <cosa>` | imprime la doc de un paquete o símbolo | en vez de abrir el browser |
| `go mod tidy` | agrega lo que importás, borra lo que no | después de agregar o sacar un import |
| `go env` | muestra la configuración del propio toolchain | cuando el module cache se porta mal |

`./...` significa "este directorio y todos los paquetes que cuelgan de él". Lo
vas a tipear unas cuantas miles de veces. No es un typo ni un glob que expande
tu shell — es un patrón de paths de Go, y por eso nunca hace falta ponerlo entre
comillas.

### `go run` vs `go build` vs `go install`

Estos tres confunden a todo el mundo una vez.

```bash
go run .                 # compile to a temp dir, run it, throw the binary away
go build -o turtle .     # compile, leave ./turtle behind, don't run it
go install ./cmd/scouter # compile and put the binary in $(go env GOBIN)
```

`go run` es para el loop en el que estás ahora. `go build` es lo que hace CI y
lo que produce la cosa que metés en un container (Cápsula 02). `go install` es
para herramientas que querés tener en el `PATH`.

La salida de `go build` es **un solo binario estático sin runtime que instalar**
— por eso el Dockerfile de la Cápsula 02 puede terminar con una etapa
`FROM scratch` y por eso Go está sobre-representado en infraestructura.

### La trampa del archivo suelto

Todo junior se come esta en la primera semana:

```bash
go run main.go
```

```
# command-line-arguments
./power.go:14:7: undefined: NewStore
./power.go:19:14: undefined: Shout
```

Nombrar un archivo compila *solamente ese archivo*, así que todo lo demás de tu
paquete desaparece. **Tipeá `go run .`** — el punto significa "el paquete de
este directorio", que es casi siempre lo que querías decir.

---

## Parte 2 — `gofmt`: la discusión se terminó

```bash
gofmt -l .      # which files are not formatted? (prints nothing if all are)
gofmt -d .      # show me the diff
gofmt -w .      # fix them in place
```

Existe exactamente un formato correcto para cualquier programa de Go, `gofmt` lo
produce, viene con el toolchain, y **no tiene opciones**. No "pocas opciones".
Ninguna. No podés configurar la indentación, porque son tabs.

Viniendo de un lenguaje donde el formato es un archivo de config que heredaste y
una regla de lint que alguien desactivó en 2019, esto se siente autoritario. Dos
cosas para notar una vez que convivís con eso:

- **Los code reviews dejan de tener comentarios de estilo.** Todos ven la misma
  forma, así que la conversación es sobre el diseño.
- **Los diffs quedan chicos,** porque a nadie se le reformatea un archivo entero
  del que tocó una línea.

Configurá tu editor para que lo corra al guardar — `gopls`, el language server
oficial, hace esto y lo usa cualquier editor con soporte de Go. Después nunca
más pensás en el tema, que es exactamente el objetivo de diseño.

> `go fmt ./...` es un wrapper finito que corre `gofmt -l -w` sobre paquetes.
> Cualquiera de los dos sirve. `gofmt` es el que acepta los flags interesantes.

---

## Parte 3 — `go vet`: el primo paranoico del compilador

**Esta es la sección que la gente saltea y no debería.** `go vet` encuentra bugs
que compilan perfecto y están mal en runtime.

El ejemplo canónico: esto compila, corre y sale con código 0.

```go
fmt.Printf("%s is at %s\n", f.Name, f.Power)   // Power is an int
```

```
goku is at %!s(int=9001)
```

Ese `%!s(int=9001)` es la forma que tiene Go de decir "me pediste imprimir un int
como string". No falló nada. Simplemente está mal, en tus logs, en producción.
Ahora:

```bash
go vet ./...
```

```
# turtle
# [turtle]
./power.go:12:23: fmt.Printf format %s has arg f.Power of wrong type int
```

Encontrado estáticamente, antes de correr una sola vez. Ese es todo el argumento.

> El par `# turtle` / `# [turtle]` es solo vet etiquetando el paquete y su
> variante de test; los toolchains más viejos imprimen únicamente la primera.
> Ignorá las dos líneas y leé la que tiene archivo y número de línea.

### Qué chequea vet en serio

`go vet` es un conjunto de analizadores chicos. Mirá la lista que tiene tu
toolchain con `go tool vet help`. Los que te van a agarrar a *vos*:

| Analizador | Agarra |
|---|---|
| `printf` | el verbo del formato no coincide con el tipo del argumento, o sobran/faltan argumentos |
| `copylocks` | un `sync.Mutex` copiado por valor — la copia no protege nada |
| `lostcancel` | el `cancel` de `context.WithTimeout` que nunca se llama (un context leak) |
| `structtag` | un tag `json:"..."` mal escrito, que silenciosamente no hace nada |
| `loopclosure` | una variable de loop capturada por una goroutine (el clásico pre-Go 1.22) |
| `httpresponse` | usar `resp` antes de chequear `err`, o un `defer resp.Body.Close()` faltante |
| `unusedresult` | llamar a `fmt.Sprintf` o `errors.New` y tirar el resultado |
| `tests` | una función de test con la firma equivocada, que entonces nunca corre |
| `nilfunc`, `unreachable`, `shift`, `assign` | código que demostrablemente no hace nada |

Dos de esos merecen verse completos, porque el mensaje de error *te enseña* la
regla:

```
./store.go:11:9: Record passes lock by value: turtle.Store contains sync.Mutex
./tmp_vet.go:14:7: the cancel function returned by context.WithTimeout should be called, not discarded, to avoid a context leak
./tmp_vet.go:9:2: struct field tag `json: "fighter"` not compatible with reflect.StructTag.Get: bad syntax for struct tag value
```

El primero es un value receiver sobre un tipo que contiene un mutex — cada
llamada se lleva su propia copia del lock, así que el lock no protege nada y la
race es invisible. El último es un espacio después de `json:` en un struct tag;
el tag se ignora, tu campo se serializa con su nombre de Go, y el contrato de tu
API cambia sin un solo error.

### `go test` ya corre vet, parcialmente

```
As part of building a test binary, go test runs go vet on the package
and its test source files… Only a high-confidence subset of the default
go vet checks are used. That subset is: atomic, bool, buildtags, directive,
errorsas, ifaceassert, nilfunc, printf, stringintconv, and tests.
```
*(de `go help test`)*

O sea que `go test` se va a negar a correr si tu `t.Errorf` tiene la cantidad
equivocada de argumentos — pero **no** va a agarrar `copylocks` ni `lostcancel`.
Corré los dos:

```bash
go vet ./... && go test ./...
```

Poné ese par en tu `Makefile` y en CI desde el primer día.

### vet no es un linter, y eso es a propósito

`go vet` solo reporta cosas que son *casi con certeza bugs*. No tiene opiniones
de estilo, porque `gofmt` ya las resolvió. Si querés más, son herramientas
aparte que instalás:

| Herramienta | Qué agrega |
|---|---|
| `staticcheck` | la buena. Código muerto, condiciones redundantes, mal uso de la stdlib |
| `golangci-lint` | un runner que junta staticcheck, vet y varias decenas más |
| `govulncheck` | CVEs conocidos en tus dependencias — **y solo si de verdad llamás a la función vulnerable** (Cápsula B9) |

Ninguna es obligatoria para este curso. `gofmt`, `vet` y `test` sí.

---

## Parte 4 — `go test`: los tests son del lenguaje

No hay JUnit, no hay pytest, no hay Jest. Testear está en la librería estándar y
en el comando `go`, y todos los proyectos de Go del planeta corren tests igual.

Las reglas son mecánicas, y romper cualquiera de ellas hace que tu test
**silenciosamente no exista**:

- El archivo termina en `_test.go`.
- La función es `func TestXxx(t *testing.T)` — `T` mayúscula, y el nombre
  después de `Test` también tiene que empezar con mayúscula.
- Vive en el mismo directorio que el código que testea.

Esa última sorprende a quien viene de Java o Python: no hay un árbol `test/`
paralelo. `store.go` y `store_test.go` están uno al lado del otro, y el archivo
de test puede estar en el mismo paquete, lo que significa que **tus tests pueden
tocar identificadores no exportados.** Acá eso es normal e idiomático.

### No hay assertions

```go
if got != want {
	t.Errorf("Shout(%q) = %q, want %q", in, got, want)
}
```

Eso es todo. No hay `assertEquals`, no hay `expect(x).toBe(y)`. La convención es
lo bastante rígida como para ser su propia librería de assertions:

- **`got` y `want`**, en ese orden, en el mensaje. Cualquier persona que escriba
  Go lo lee de un vistazo.
- **`t.Errorf` registra la falla y sigue.** `t.Fatalf` corta este test ahí mismo
  — usalo cuando seguir solo va a explotar contra un nil.
- Usá `%q` para strings así ves los espacios.

### Los table-driven tests son el idiom

No un patrón que a alguien le gusta. *El* idiom — lo vas a ver en la propia
librería estándar.

```go
func TestShout(t *testing.T) {
	cases := []struct {
		name string // the subtest's name, not an input
		in   string
		want string
	}{
		{"normal", "goku", "GOKU!!!"},
		{"already upper", "VEGETA", "VEGETA!!!"},
		{"empty", "", "WHO?"},
		{"spaces kept", "master roshi", "MASTER ROSHI!!!"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Shout(c.in)
			if got != c.want {
				t.Errorf("Shout(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
```

Agregar un caso es una línea. `t.Run` le da a cada caso su propio nombre en la
salida, así que una falla te dice *cuál* caso, y podés volver a correr solo ese
con `go test -run 'TestShout/empty'`.

### Los flags que importan

| Flag | Para |
|---|---|
| `-v` | mostrar cada test y subtest, pase o no |
| `-run 'TestShout/empty'` | correr un test, o un subtest — es una regex |
| `-race` | el race detector. No negociable para cualquier cosa concurrente (B5) |
| `-count=1` | desactivar el cache de tests cuando querés una corrida de verdad |
| `-cover` | imprimir un porcentaje de cobertura |
| `-failfast` | frenar en el primer test que falla |

`-count=1` merece una nota: Go **cachea** los resultados de tests exitosos. Si
corrés `go test` dos veces sin cambiar nada, la segunda imprime `(cached)`. Eso
es una ventaja hasta que estás testeando algo con un efecto fuera de tu código, y
ahí son cinco minutos de confusión.

---

## Parte 5 — Módulos, en los cuatro comandos que necesitás

Un módulo es un directorio con un `go.mod` adentro. Ese archivo es el proyecto.

```
module turtle

go 1.25.6
```

Dos datos: el import path del módulo y la versión del lenguaje — `1.25.6` es el
toolchain que lo escribió, así que el tuyo va a ser otro. No hay sección de
dependencias hasta que tengas una dependencia.

| Comando | Efecto |
|---|---|
| `go mod init github.com/vos/cosa` | crear `go.mod` — el nombre es el import path |
| `go get example.com/pkg@v1.2.3` | agregar o cambiar la versión de una dependencia |
| `go mod tidy` | reconciliar `go.mod` con lo que tu código realmente importa |
| `go mod why example.com/pkg` | explicar cuál de tus paquetes la trae |

Cuatro cosas genuinamente distintas de npm o Maven:

- **El import path es la URL.** `github.com/google/uuid` es a la vez dónde vive
  el código y cómo lo importás. No hay registry central ni un nombre de paquete
  separado de su ubicación.
- **`go.sum` es un archivo de checksums, no un lockfile.** Las versiones están
  fijadas en `go.mod`; `go.sum` guarda hashes para que una dependencia no cambie
  abajo tuyo. Commiteá los dos. Nunca edites ninguno a mano.
- **Minimal version selection.** Go elige la versión *más baja* que satisface a
  todos, no la más alta. Los builds son reproducibles sin un resolver peleándose
  consigo mismo.
- **`go mod tidy` es la verdad.** Lee tus imports y reescribe `go.mod` para que
  coincida — agregando lo que falta, borrando lo que ya no se usa. Correlo
  después de tocar imports, y commiteá el resultado.

El marcador `// indirect` confunde. Significa "nada en este módulo la importa
directamente (todavía)". En el lab lo vas a ver resolverse solo.

> **`internal/` lo hace cumplir el compilador.** Un paquete debajo de
> `internal/` no puede importarse desde afuera de su módulo. Es el único límite
> de visibilidad de Go que no es una convención de nombres, y la Cápsula 00
> arma tu repo con eso a propósito.

---

## Parte 6 — Las partes opinionadas que al principio se sienten mal

Esta es la parte que hace que la gente diga que Go es raro. Cada una de estas es
un trade deliberado: **el lenguaje optimiza para la persona que va a leer el
código dentro de dos años, no para la que lo tipea hoy.** Cuando te lo creés, la
mayoría dejan de molestar.

| Lo que te sorprende | La regla | Por qué |
|---|---|---|
| Una variable sin usar **rompe el build** | `declared and not used: count` | Una variable local sin usar es el residuo de una edición a medias. Un warning se ignora; un error se arregla |
| Un import sin usar, igual | `"os" imported and not used` | Lo mismo, más que los imports son costo de compilación y superficie de dependencias |
| Mayúscula inicial = público | `Record` se exporta, `record` no | La visibilidad se lee en el *lugar de la llamada*, sin abrir la definición |
| La visibilidad es por **paquete**, no por tipo | otro archivo del mismo paquete ve tus campos no exportados | El paquete es la unidad de encapsulamiento. No hay `private` ni `protected` |
| No hay ternario `?:` | escribí el `if` | Una sola forma de expresar un condicional. Los ternarios anidados eran el costo |
| No hay `while` ni `do…while` | `for cond { }`, `for { }` | Una sola palabra clave para loops |
| No hay overloading ni argumentos por defecto | `NewX` y `NewXWithTimeout` | El lugar de la llamada nombra exactamente una función |
| No hay excepciones | `if err != nil { return err }` | Cada falla es visible en el punto donde puede pasar (B10) |
| Los strings de error van en minúscula y sin punto | `errors.New("connection refused")` | Se envuelven: `record reading: query fighters: connection refused` |
| Los getters no se llaman `GetX` | `f.Name()`, y `f.SetName()` si hace falta | La palabra de relleno no compra nada |
| Las interfaces se nombran por el verbo | `Reader`, `Stringer` — nunca `IStore` | El sufijo `-er` dice qué hace |
| Los receivers son de una o dos letras | `func (s *Store) Record(…)` | Ni `this` ni `self`. Scope corto, nombre corto |
| El nombre del paquete es parte del identificador | `http.Server`, no `http.HTTPServer` | Ya dijiste `http` |
| Los tests van al lado del código | `store.go` / `store_test.go` | No hay un árbol espejo que mantener sincronizado |

Cuatro de esas valen más que una fila de tabla.

### "Variable sin usar" es un error de compilación, y vas a pelearte con eso

Comentás una línea mientras debuggeás y se rompe el build porque ahora una
variable quedó sin usar. Es enloquecedor por un día. Dos salidas:

```go
_ = count                               // "yes, unused, and I meant it"
var _ io.Writer = (*bytes.Buffer)(nil)  // compile-time proof of an interface
```

La segunda línea vale la pena robarla. Afirma en tiempo de compilación que una
interfaz está satisfecha y no cuesta nada en runtime — la vas a ver arriba de
todo en archivos de todo este curso.

Notá la asimetría: **los *imports* y las *variables locales* sin usar son
errores; los campos de struct sin usar, las funciones sin usar y las variables a
nivel de paquete sin usar, no.** La regla solo cubre cosas que son
demostrablemente un error en el scope que estás mirando.

### Los nombres cortos no son vagancia

```go
for i, r := range readings { … }
func (s *Store) Record(r Reading) error { … }
```

La convención de Go es que **el largo del nombre escala con el scope**. Una
variable que vive tres líneas es `r`. Un export a nivel de paquete que leen cien
archivos es `DefaultTimeout`. Viniendo de un codebase lleno de
`readingRepositoryInstance`, esto se lee como descuido por un rato, y después se
lee rápido.

### `:=` y la trampa del shadowing

`:=` declara e infiere; `var` declara explícitamente. Usá `:=` dentro de
funciones, `var` a nivel de paquete o cuando querés el zero value.

La trampa es que `:=` dentro de un scope nuevo crea una variable **nueva**:

```go
f, err := load("a")
if err != nil {
	return err
}
if g, err := load("b"); err == nil {   // this err is a DIFFERENT variable
	fmt.Println(f, g)
}
```

Eso compila limpio y `go vet` no dice nada al respecto. El `err` de afuera
queda intacto, y si hubieras escrito algo que dependiera de él, estarías
debuggeando un rato largo. Sé deliberado sobre en qué scope estás declarando.

### El zero value tiene que servir tal cual

```go
var mu sync.Mutex     // ready to Lock()
var buf bytes.Buffer  // ready to Write()
var s []string        // nil, but append works and len(s) == 0
var m map[string]int  // nil — reads work, WRITES PANIC
```

`var s []string` y `var m map[string]int` parecen simétricos y no lo son. A un
slice nil le podés hacer append sin problema. Un map nil explota apenas le
escribís. **Los maps hay que crearlos**: `make(map[string]int)` o un literal. Lo
vas a hacer mal una vez; el lab te lo hace hacer a propósito así es una y no dos.

---

## Parte 7 — Cómo leer lo que Go te dice

Tres tipos de mensaje, tres reflejos distintos.

### Un error de compilación

```
# turtle
./power.go:5:2: "os" imported and not used
```

`# turtle` es el paquete. Después `archivo:línea:columna`. Los errores de
compilación de Go son cortos y literales — muy rara vez significan otra cosa que
lo que dicen. **Arreglá el primero y recompilá**; los siguientes suelen ser
consecuencia.

### Un panic

```
panic: assignment to entry in nil map

goroutine 1 [running]:
main.(*Store).Record(0x1009b9688?, {0x10096808f?, 0x100968fdd?}, 0x2329)
	/Users/you/go-turtle/store.go:13 +0xc8
main.main()
	/Users/you/go-turtle/power.go:15 +0x9c
exit status 2
```

Leelo en este orden:

1. **La primera línea es la causa.** `assignment to entry in nil map`.
2. **El primer frame debajo de `goroutine 1 [running]:` es dónde pasó** —
   `store.go:13`.
3. **Los frames de abajo son los llamadores**, del más reciente al más viejo.
   `power.go:15` es quien llamó a `Record`.

Los números en hexa son argumentos y offsets — ignoralos. Los sufijos `?`
significan que el valor puede ser impreciso por optimizaciones. Ignoralos
también. De todo ese bloque querés dos líneas: qué, y dónde.

### Un valor de error

Los errores de Go los construyen los llamadores, así que uno bueno se lee como
un camino:

```
record reading: query fighters: dial tcp 10.0.0.5:5432: connection refused
```

Cada capa agregó *lo que estaba intentando hacer*, usando `%w`:

```go
return fmt.Errorf("query fighters: %w", err)
```

Lo leés de izquierda a derecha y tenés el call stack, en lenguaje de dominio, de
regalo. Cuando escribas uno: describí la operación, no el nombre de la función, y
no lo empieces con "error" o "falló al" — el que lee ya lo sabe.

---

## Lab — un módulo, cinco herramientas y cada error a propósito

Veinticinco minutos. Todo lo de abajo se corrió con Go 1.25; los mensajes están
copiados de una terminal real. El texto exacto puede moverse un poco entre
versiones de Go — la forma no.

### Paso 0 — un módulo

```bash
mkdir -p ~/go-turtle && cd ~/go-turtle
go mod init turtle
```

```
go: creating new go.mod: module turtle
```

### Paso 1 — conocé al compilador

**`power.go`**

```go
package main

import (
	"fmt"
	"os"
)

type Fighter struct {
	Name  string
	Power int
}

func main() {
	f := Fighter{Name: "goku", Power: 9001}
	fmt.Printf("%s is at %s\n", f.Name, f.Power)
}
```

```bash
go build ./...
```

```
# turtle
./power.go:5:2: "os" imported and not used
```

**Error 1, a propósito:** un import sin usar es una falla de build, no un
warning. Borrá la línea de `"os"` y colapsá el import a `import "fmt"`.

### Paso 2 — conocé a `go vet`

Ahora compila. Correlo:

```bash
go run .
```

```
goku is at %!s(int=9001)
```

**Error 2:** `%s` contra un `int`. El programa funcionó — código de salida 0, sin
error, basura en la salida. Ahora dejá que la herramienta lo encuentre:

```bash
go vet ./...
```

```
# turtle
# [turtle]
./power.go:12:23: fmt.Printf format %s has arg f.Power of wrong type int
```

Cambiá `%s` por `%d` y volvé a correr vet. El silencio significa limpio.

> Este es el momento del que se trata la cápsula. El compilador estaba contento.
> El programa corrió. `go vet` es lo único que hay entre vos y esa línea
> apareciendo en un log de producción.

### Paso 3 — conocé a `gofmt`

Escribí este archivo deliberadamente mal.

**`shout.go`**

```go
package main

import "strings"

func Shout( name string ) string {
    if name == "" {
      return "WHO?"
    }
    return strings.ToUpper( name )+"!!!"
}
```

```bash
gofmt -l .
```

```
shout.go
```

```bash
gofmt -d shout.go
```

```
diff shout.go.orig shout.go
--- shout.go.orig
+++ shout.go
@@ -2,9 +2,9 @@
 
 import "strings"
 
-func Shout( name string ) string {
-    if name == "" {
-      return "WHO?"
-    }
-    return strings.ToUpper( name )+"!!!"
+func Shout(name string) string {
+	if name == "" {
+		return "WHO?"
+	}
+	return strings.ToUpper(name) + "!!!"
 }
```

Mirá lo que decidió sin preguntar: los espacios dentro de los paréntesis se
fueron, tabs para indentar, un espacio alrededor del `+`. Ahora:

```bash
gofmt -w .
gofmt -l .
```

El segundo comando no imprime nada. **Ese es el chequeo de CI** — `gofmt -l .`
con salida vacía significa que el árbol está formateado.

### Paso 4 — un bug que el compilador y `gofmt` dejan pasar

**`store.go`**

```go
package main

import "sync"

type Store struct {
	mu   sync.Mutex
	data map[string]int
}

// Value receiver: every call copies the Store — including its mutex.
func (s Store) Record(name string, power int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[name] = power
}
```

```bash
go build ./... && echo "compiles fine"
go vet ./...
```

```
compiles fine
# turtle
# [turtle]
./store.go:11:9: Record passes lock by value: turtle.Store contains sync.Mutex
```

**Error 3:** un value receiver sobre un tipo que tiene un mutex. Cada llamador
bloquea su propia copia privada, así que el mutex no protege nada — y bajo carga
tenés una data race sin síntoma hasta que corrompe algo. Cambiá el receiver a
`func (s *Store) Record(...)`.

### Paso 5 — el panic del map nil

Agregá esto a `main`, después del `Printf`:

```go
	s := &Store{}
	s.Record(f.Name, f.Power)
```

```bash
go run .
```

```
goku is at 9001
panic: assignment to entry in nil map

goroutine 1 [running]:
main.(*Store).Record(0x1009b9688?, {0x10096808f?, 0x100968fdd?}, 0x2329)
	/Users/you/go-turtle/store.go:13 +0xc8
main.main()
	/Users/you/go-turtle/power.go:15 +0x9c
exit status 2
```

**Error 4:** `Store{}` te da un mutex en zero value perfectamente usable y un map
**nil**. Practicá leer el trace: la causa en la línea 1, `store.go:13` es dónde,
`power.go:15` es quién lo llamó.

El arreglo es la convención del constructor — una función `New*` que devuelve un
valor listo para usar:

```go
// NewStore returns a Store that is ready to use. The map must be made;
// the zero value of a map is nil, and writing to a nil map panics.
func NewStore() *Store {
	return &Store{data: make(map[string]int)}
}

func (s *Store) Power(name string) (int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.data[name]
	return p, ok
}
```

Ahora hacé que `main` lo use:

```go
func main() {
	f := Fighter{Name: "goku", Power: 9001}
	fmt.Printf("%s is at %d\n", f.Name, f.Power)

	s := NewStore()
	s.Record(f.Name, f.Power)
	if p, ok := s.Power("vegeta"); !ok {
		fmt.Println("no reading for vegeta; zero value is", p)
	}
	fmt.Println(Shout(f.Name))
}
```

```bash
go run .
```

```
goku is at 9001
no reading for vegeta; zero value is 0
GOKU!!!
```

Ese retorno `(int, bool)` es la forma estándar de Go para un lookup — el segundo
valor te dice si se encontró, porque el primero no puede: una clave ausente
devuelve el zero value, y `0` es un nivel de pelea perfectamente válido.

### Paso 6 — tests

**`shout_test.go`**

```go
package main

import "testing"

func TestShout(t *testing.T) {
	cases := []struct {
		name string // the subtest's name, not an input
		in   string
		want string
	}{
		{"normal", "goku", "GOKU!!!"},
		{"already upper", "VEGETA", "VEGETA!!!"},
		{"empty", "", "WHO?"},
		{"spaces kept", "master roshi", "MASTER ROSHI!!!"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Shout(c.in)
			if got != c.want {
				t.Errorf("Shout(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestStoreRecord(t *testing.T) {
	s := NewStore()
	s.Record("goku", 9001)

	got, ok := s.Power("goku")
	if !ok {
		t.Fatalf("Power(%q): not found after Record", "goku")
	}
	if got != 9001 {
		t.Errorf("Power(%q) = %d, want 9001", "goku", got)
	}
}
```

```bash
go test ./...
```

```
ok  	turtle	0.193s
```

La salida de tests de Go es callada cuando pasa. Mirá el detalle con `-v`:

```bash
go test -v -run TestShout ./...
```

```
=== RUN   TestShout
=== RUN   TestShout/normal
=== RUN   TestShout/already_upper
=== RUN   TestShout/empty
=== RUN   TestShout/spaces_kept
--- PASS: TestShout (0.00s)
    --- PASS: TestShout/normal (0.00s)
    --- PASS: TestShout/already_upper (0.00s)
    --- PASS: TestShout/empty (0.00s)
    --- PASS: TestShout/spaces_kept (0.00s)
PASS
ok  	turtle	0.197s
```

Fijate en `already_upper` — los espacios en el nombre de un subtest se vuelven
guiones bajos, que es lo que tipeás en `-run`.

### Paso 7 — mirá fallar un test como corresponde

En `shout.go`, cambiá `"!!!"` por `"!"`, y después:

```bash
go test ./...
```

```
--- FAIL: TestShout (0.00s)
    --- FAIL: TestShout/normal (0.00s)
        shout_test.go:21: Shout("goku") = "GOKU!", want "GOKU!!!"
    --- FAIL: TestShout/already_upper (0.00s)
        shout_test.go:21: Shout("VEGETA") = "VEGETA!", want "VEGETA!!!"
    --- FAIL: TestShout/spaces_kept (0.00s)
        shout_test.go:21: Shout("master roshi") = "MASTER ROSHI!", want "MASTER ROSHI!!!"
FAIL
FAIL	turtle	0.192s
FAIL
```

Fallaron tres de los cuatro casos y el cuarto no — `empty` retorna antes y nunca
llega a la línea que cambiaste. **Ese es el argumento a favor de los
table-driven tests en una pantalla:** la salida localiza el bug en los casos que
lo tocan. Devolvé los `!!!`.

### Paso 8 — `go test` corre vet por vos

En el test, borrá `want %q` del string de formato pero dejá `c.want` como
argumento, y después:

```bash
go test ./...
```

```
# turtle
# [turtle]
./shout_test.go:21:5: (*testing.common).Errorf call needs 2 args but has 3 args
FAIL	turtle [build failed]
FAIL
```

Los tests no corrieron para nada — vet corrió primero y se negó. Devolvelo.

Después mirá la cobertura:

```bash
go test -coverprofile=cover.out ./... && go tool cover -func=cover.out
```

```
turtle/power.go:10:	main		0.0%
turtle/shout.go:5:	Shout		100.0%
turtle/store.go:12:	NewStore	100.0%
turtle/store.go:16:	Record		100.0%
turtle/store.go:22:	Power		100.0%
total:			(statements)	61.1%
```

`go tool cover -html=cover.out` abre lo mismo con las líneas sin cubrir
resaltadas en un browser, que es la versión que vas a usar de verdad.

### Paso 9 — una dependencia, y para qué sirve `tidy`

Necesita red.

```bash
go get github.com/google/uuid@v1.6.0
cat go.mod
```

```
go: added github.com/google/uuid v1.6.0
```

```
module turtle

go 1.25.6

require github.com/google/uuid v1.6.0 // indirect
```

**`// indirect` porque todavía nadie la importa.** Ahora importala — agregá
`"github.com/google/uuid"` al bloque de imports de `power.go` y usá
`uuid.NewString()` en algún lado — y después:

```bash
go mod tidy && cat go.mod
```

El marcador `// indirect` desapareció. Ahora borrá el import y el uso otra vez:

```bash
go mod tidy && cat go.mod
```

```
module turtle

go 1.25.6
```

La dependencia se fue del todo. **`go mod tidy` hace que `go.mod` describa la
realidad**, en las dos direcciones — ese es todo su trabajo, y por eso lo corrés
después de cada cambio de imports en vez de editar `go.mod` a mano.

### Paso 10 — los dos comandos, juntos

```bash
go vet ./... && go test ./...
```

Ese es el par. Que te salga de memoria antes de escribir tu primer servicio de Go
en serio en la [Cápsula 01](../../01-scouter-first-service/README.md).

---

## Llevátelo al trabajo

- **Un formateador sin opciones termina una discusión recurrente.** Esto lo podés
  tener en casi cualquier lenguaje hoy — `prettier`, `black`, `rustfmt`. La
  lección es elegir uno y borrar el archivo de configuración, no tunearlo.
- **El análisis estático que solo reporta bugs casi seguros se corre.** La
  moderación de `go vet` es la razón por la que nadie lo silencia. Un linter con
  30% de falsos positivos le enseña al equipo a ignorar la salida del lint entera.
- **Los errores que se leen como un camino** (`record reading: query fighters:
  connection refused`) son un hábito, no una feature del lenguaje. Construí la
  misma cadena donde trabajes — te saca la mayor parte de la necesidad de
  reproducir un bug para ubicarlo.
- **Un build que falla con variables sin usar** agarra refactors a medio hacer.
  Vale la pena tenerlo donde se pueda prender.

---

## Simulacro de combate

<details>
<summary><b>1.</b> <code>go run main.go</code> dice <code>undefined: NewStore</code>, pero <code>NewStore</code> está ahí en <code>store.go</code>. ¿Qué pasa?</summary>

Nombraste un archivo, así que Go compiló *solo ese archivo* — `store.go` nunca
fue parte del build. Nombrar archivos los convierte en el paquete entero.

`go run .` compila el paquete del directorio actual, que es lo que querías decir.
Lo mismo aplica a `go build` y `go test`: el target es un paquete, no un archivo.
</details>

<details>
<summary><b>2.</b> Tu handler imprime <code>%!d(string=goku)</code> en los logs. ¿Qué herramienta lo hubiera agarrado, y por qué no lo agarró el compilador?</summary>

`go vet`, con el analizador `printf`. El compilador no puede: `fmt.Printf` recibe
`...any`, así que pasar un string donde el formato dice `%d` es una llamada
perfectamente válida. El desajuste es entre un *string literal* y los tipos de
los argumentos, que es exactamente para lo que existe un analizador.

`go test` también lo hubiera agarrado — `printf` está en el subconjunto de alta
confianza que vet corre durante `go test` — pero solo si ese código está en un
paquete con tests que se estén compilando.
</details>

<details>
<summary><b>3.</b> <code>var s []string</code> y <code>var m map[string]int</code> son las dos nil. ¿Por qué <code>append(s, "x")</code> funciona y <code>m["x"] = 1</code> explota?</summary>

`append` es un builtin que *devuelve un slice nuevo* — dado un slice nil reserva
un array de respaldo y te lo devuelve, que es por lo que tenés que reasignar
(`s = append(s, "x")`). No se mutó nada en el lugar.

Una asignación a un map muta el map en el lugar, y no hay map que mutar — un map
nil no tiene tabla de hash atrás. Las lecturas están definidas (devuelven el zero
value y `ok == false`), las escrituras explotan. Los maps hay que crearlos con
`make` o un literal; la convención del constructor `New*` existe en buena parte
por esto.
</details>

<details>
<summary><b>4.</b> Agregás un tag <code>json:"fighter"</code>, deployás, y el campo sigue apareciendo como <code>Fighter</code> en la respuesta. ¿Cuáles son las dos causas probables?</summary>

O el tag está mal escrito — `json: "fighter"` con un espacio es el clásico, y se
ignora silenciosamente porque ya no parsea como struct tag — o el campo no está
exportado, así que `encoding/json` directamente no lo ve.

El analizador `structtag` de `go vet` agarra la primera. La segunda no la agarra
nada más que leerla: `fighter string` no se serializa a nada, `Fighter string` se
serializa como `"Fighter"`.
</details>

<details>
<summary><b>5.</b> Cambiaste un archivo de config que tu test lee, volviste a correr <code>go test ./...</code> y obtuviste la misma salida verde al instante. ¿Qué pasó?</summary>

Cache de resultados de tests. Go cachea el resultado exitoso de un paquete usando
como clave el binario de test y los archivos que *observó a través del paquete
`os`* — un config leído de otra manera, o estado en una base o en un container,
no forma parte de la clave. La corrida se salteó y viste `(cached)`.

`go test -count=1 ./...` fuerza una corrida real. Es el conjuro estándar cada vez
que un test depende de algo fuera del módulo.
</details>

---

## El cheatsheet

Todo lo de abajo es referencia. Ojealo ahora, volvé después.

### Comandos

| Comando | Hace |
|---|---|
| `go version` | versión del toolchain |
| `go env` / `go env GOMODCACHE` | configuración del toolchain; agregá un nombre para un solo valor |
| `go mod init <import-path>` | arrancar un módulo |
| `go mod tidy` | sincronizar `go.mod` con tus imports — corrilo tras cada cambio de import |
| `go mod why <pkg>` | ¿por qué está esta dependencia? |
| `go get <pkg>@<versión>` | agregar o actualizar una dependencia (`@latest`, `@v1.2.3`) |
| `go run .` | buildear y correr el paquete de acá |
| `go build ./...` | compilar todo, sin dejar binario |
| `go build -o bin/app ./cmd/app` | compilar a un binario con nombre |
| `go install ./cmd/app` | compilar dentro de `$(go env GOBIN)` |
| `go test ./...` | correr todos los tests |
| `go vet ./...` | análisis estático |
| `gofmt -l .` / `gofmt -w .` | listar sin formatear / reescribir en el lugar |
| `go doc <pkg> [Símbolo]` | documentación en la terminal |
| `go tool cover -html=cover.out` | cobertura, resaltada, en un browser |
| `go clean -modcache` | la opción nuclear cuando el module cache está roto |

### Flags de test

| Flag | Hace |
|---|---|
| `-v` | verboso: cada test y subtest |
| `-run 'TestX/sub'` | filtrar por regex; `/` separa subtests |
| `-race` | race detector — usalo en todo lo concurrente |
| `-count=1` | saltear el cache de tests |
| `-cover` / `-coverprofile=f` | porcentaje de cobertura / archivo de perfil |
| `-failfast` | frenar tras la primera falla |
| `-timeout 30s` | hacer fallar un test colgado en vez de esperar 10 minutos |
| `-short` | tus tests pueden chequear `testing.Short()` y saltear los lentos |

### Declarar cosas

```go
x := 5                     // declare + infer. Only inside a function
var x int                  // declare, zero value (0)
var x int = 5              // explicit
const Limit = 100          // compile-time constant
var ErrNotFound = errors.New("not found")   // package-level sentinel

func f(a, b int) (int, error)    // two params of the same type, two returns
func f(vals ...int)              // variadic; inside, vals is []int
f(nums...)                       // spread a slice into a variadic call

type Reading struct {
	Fighter string `json:"fighter"`   // exported + tag
	power   int                       // unexported: invisible to encoding/json
}

type Recorder interface{ Record(Reading) error }   // implicit satisfaction

func (s *Store) Method()    // pointer receiver: can mutate, no copy
func (r Reading) Method()   // value receiver: works on a copy
```

### Zero values

| Tipo | Zero | ¿Usable? |
|---|---|---|
| `int`, `float64` | `0` | sí |
| `string` | `""` | sí — no existe el string nil |
| `bool` | `false` | sí |
| puntero, interfaz, func, chan | `nil` | dereferenciarlo explota |
| slice | `nil` | **sí** — `append`, `len`, `range` funcionan |
| map | `nil` | **lecturas sí, escrituras explotan.** Hacele `make` |
| `sync.Mutex`, `bytes.Buffer`, `strings.Builder` | usable | sí, por diseño |

### Slices, maps, strings

```go
s := []int{1, 2, 3}
s = append(s, 4)          // append RETURNS — you must reassign
s = append(s, other...)   // append another slice
view := s[1:3]            // a VIEW sharing the backing array, not a copy
c := make([]int, len(s))  // when you need independence:
copy(c, s)
make([]int, 0, 100)       // len 0, capacity 100 — preallocate when you know

m := map[string]int{"goku": 9001}
v, ok := m["vegeta"]      // v == 0, ok == false. Always use the two-value form
delete(m, "goku")
len(m)                    // maps are NOT safe for concurrent writes

strings.Contains(text, "x"); strings.HasPrefix(text, "x")
strings.Split(text, ","); strings.Join(parts, ","); strings.TrimSpace(text)
strconv.Itoa(9001); strconv.Atoi("9001")   // int <-> string. NOT string(9001)
fmt.Sprintf("%s is %d", name, power)       // build a string
```

`string(9001)` compila y te da el carácter U+2329, no `"9001"`. El chequeo
`stringintconv` de vet existe exactamente por esto.

### Verbos de formato que vas a usar

| Verbo | Para |
|---|---|
| `%s` | strings, y cualquier cosa con un método `String()` |
| `%d` | enteros |
| `%q` | un string entre comillas — usalo en fallas de test para ver los espacios |
| `%v` | cualquier cosa, formato por defecto |
| `%+v` | structs con nombres de campo — el de debuggear |
| `%T` | el tipo, cuando no estás seguro de qué tenés |
| `%w` | **solo** en `fmt.Errorf` — envuelve un error en la cadena |
| `%%` | un porcentaje literal |

### Errores

```go
if err != nil {
	return fmt.Errorf("query fighters: %w", err)   // %w wraps; adds context
}

var ErrNotFound = errors.New("not found")          // sentinel
if errors.Is(err, ErrNotFound) { … }               // is it THAT error?

var pathErr *fs.PathError
if errors.As(err, &pathErr) { … }                  // pull a typed error out

defer f.Close()                                    // runs on every return path
```

Reglas: minúscula, sin puntuación al final, describí la operación y no la
función. Nunca hagas `log` *y* `return` del mismo error — elegí uno, o lo vas a
leer tres veces en los logs.

### Tests

```go
func TestThing(t *testing.T) {
	t.Parallel()                      // opt in; safe only if the test shares nothing

	got := Thing()
	if got != want {
		t.Errorf("Thing() = %v, want %v", got, want)   // record, keep going
	}
	if err != nil {
		t.Fatalf("setup: %v", err)                     // stop this test now
	}

	t.Cleanup(func() { … })           // teardown, runs even on failure
	t.Helper()                        // inside a helper: report the CALLER's line
	t.Skip("needs docker")            // skip with a reason
}

func BenchmarkThing(b *testing.B) {
	for b.Loop() { Thing() }          // Go 1.24+; older: for i := 0; i < b.N; i++
}
```

### Nombres

| Cosa | Convención | No |
|---|---|---|
| Paquete | corto, minúscula, una palabra: `scouter`, `store` | `utils`, `common`, `helpers`, `my_pkg` |
| Exportado | `Record`, `DefaultTimeout` | `record` (eso es package-private) |
| Interfaz | `Reader`, `Recorder` — `-er` para un método | `IStore`, `StoreInterface` |
| Receiver | `s`, `srv` — la misma letra en todos los métodos del tipo | `this`, `self` |
| Getter | `f.Name()` | `f.GetName()` |
| Variable de error | `ErrNotFound` | `NotFoundError` (eso es para *tipos* de error) |
| Test | `TestRecord_EmptyName` | `test_record`, `TestRecordEmptyName2` |
| Archivos | `store.go`, `store_test.go` | `StoreImpl.go` |

### Stdlib que vas a tipear este mes

| Querés | Paquete |
|---|---|
| imprimir / formatear strings | `fmt` |
| cortar, separar, unir, limpiar texto | `strings` |
| números desde y hacia strings | `strconv` |
| errores, wrapping, `Is`/`As` | `errors` |
| servidor o cliente HTTP | `net/http` |
| JSON | `encoding/json` |
| deadlines, cancelación | `context` |
| mutexes, `WaitGroup`, `Once` | `sync` |
| logs estructurados | `log/slog` |
| duraciones, timers | `time` |
| SQL | `database/sql` (más un driver) |
| ordenar | `sort`, o `slices.Sort` |
| tests | `testing` |

### Trampas, una línea cada una

| Trampa | Acordate |
|---|---|
| `go run main.go` se saltea tus otros archivos | `go run .` |
| import / variable sin usar | error de compilación, no warning |
| un campo de struct en minúscula desaparece del JSON | exportado significa con mayúscula |
| escribir en un map nil explota | `make(map[K]V)`, o un constructor `New*` |
| parece que `append` no funciona | devuelve un slice nuevo — reasignalo |
| un slice de un slice comparte memoria | `make` + `copy` cuando necesitás independencia |
| `string(65)` da `"A"` | usá `strconv.Itoa` |
| un value receiver en un tipo con mutex | `go vet` lo agarra; usá pointer receiver |
| `err` shadeado silenciosamente dentro de un `if` | `:=` en un scope nuevo declara una variable nueva |
| el test pasa idéntico y al instante | estaba cacheado — `-count=1` |
| el test nunca corre | nombre de archivo, firma o nombre en minúscula |
| `%w` fuera de `fmt.Errorf` | solo ahí significa "envolver" |
| el argumento de `defer` parece viejo | los argumentos se evalúan al hacer `defer`, la llamada corre después |

---

## Senzu

| Síntoma | Arreglo |
|---|---|
| `"os" imported and not used` | Borrá el import. Configurá tu editor con `gopls` para que lo haga al guardar. |
| `declared and not used: count` | Borrá la variable, o `_ = count` si estás en medio de un debug. |
| `undefined: NewStore` cuando la función existe | Corriste `go run main.go`. Usá `go run .`. |
| `go: cannot find main module` | Estás fuera de un módulo. `go mod init <nombre>`, o `cd` al directorio correcto. |
| `missing go.sum entry` | `go mod tidy`. |
| `%!s(int=9001)` en tu salida | Verbo equivocado para el tipo. `go vet ./...` te dice la línea. |
| `panic: assignment to entry in nil map` | Al map nunca le hicieron `make`. Agregá un constructor `New*`. |
| `Record passes lock by value` | Value receiver en un tipo que contiene un `sync.Mutex`. Hacelo pointer receiver. |
| `cancel function … should be called, not discarded` | `defer cancel()` justo después de `context.WithTimeout`. |
| `call needs 2 args but has 3 args` desde `go test` | `go test` corre vet primero. Tu `t.Errorf` no coincide con sus argumentos. |
| Los tests dicen `(cached)` y necesitabas una corrida real | `go test -count=1 ./...`. |
| `go test` dice `no test files` | El archivo tiene que terminar en `_test.go` y la función ser `TestXxx(t *testing.T)`. |
| Tu Go es 1.19 y algo no compila | El curso asume 1.22+. `./bin/doctor` lo marca; la Cápsula 00 lo arregla. |

---

## Registralo

```bash
cd ~/repos/pato/gravity-augmented
./bin/scouter done B11
```

**Siguiente:** [B10 · Kamehameha Instantáneo](../B10-instant-kamehameha-go-for-java/README.md)
por el lenguaje en sí — interfaces, errores como valores, embedding — y después
[Cápsula 01 · Scouter — Tu primer servicio](../../01-scouter-first-service/README.md),
donde escribís la cosa de verdad.
