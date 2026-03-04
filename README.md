# Go Assistant

Productivity tools for Go developers: smart code actions, a fully-featured test runner, inline coverage, code lenses, and refactoring helpers — all accessible from **Ctrl+.** or the dedicated sidebar.

---

## Code Actions (Ctrl+.)

### ⚡ Handle Error — Auto-wrap bare calls

The most frequently used action. Place the cursor on any bare function call that returns an error and press **Ctrl+.** → **Handle error (Go Assistant)**.

```go
// Before — cursor on this line
stream.Recv()

// After — one keystroke
msg, err := stream.Recv()
if err != nil {
    return
}
```

Variable names are derived automatically from the return types via gopls hover. The action is marked as **preferred**, so it always appears first in the list.

---

### 🏷️ Struct Tags

#### Add JSON tags to all fields at once

Place the cursor anywhere on a `type … struct` declaration or inside any of its fields and press **Ctrl+.**.

```go
// Before
type User struct {
    Name      string
    Email     string
    CreatedAt time.Time
}

// After — "Add json tags to all fields (Go Assistant)"
type User struct {
    Name      string    `json:"name"`
    Email     string    `json:"email"`
    CreatedAt time.Time `json:"createdAt"`
}
```

Tag casing is configurable (`camelCase` or `snake_case`) via `goAssistant.codeActions.tagNamingCase`.

#### Add a custom tag to all fields

**Ctrl+.** → **Add custom tag to all fields (Go Assistant)** — prompts for the tag key (e.g. `db`, `yaml`, `validate`) and applies it to every field in the struct.

#### Per-field tag actions

Cursor on a specific field: **Add json tag to 'fieldName'** or **Remove all tags**.

---

### 🔧 Signature & Declarations

| Action | Trigger |
|---|---|
| **Move parameter up / down** | Cursor on a parameter in a `func` signature |
| **Rename parameter** | Cursor on a parameter name |
| **Convert to short var declaration** (`var x = y` → `x := y`) | Cursor on a `var` declaration |
| **Convert to var declaration** (`x := y` → `var x = y`) | Cursor on a `:=` line |
| **Convert assignment to short var** (`x = y` → `x := y`) | Cursor on a bare `=` assignment |
| **Convert defer to multiline** | Cursor on a `defer fn(args)` line |
| **Add channel receive result** | Cursor on a bare `<-ch` statement |
| **Remove redundant parentheses** | Text `(expr)` selected |
| **Add explicit type** | Cursor on a `var`/`const` without type |
| **Split field declarations** | Cursor on `x, y Type` inside a struct |

---

### 🏗️ Struct & Interface Generation

| Action | Trigger |
|---|---|
| **Fill all fields of 'TypeName'** | Cursor inside a struct literal `TypeName{}` — fills every field via gopls |
| **Generate InterfaceStub** | Cursor on an interface declaration — generates a concrete struct that implements it |
| **Add method to interface and all implementations** | Cursor on an interface — propagates a new method to every implementing type |
| **Generate getter / setter** | Cursor on a struct field — appends `GetField()` / `SetField()` methods at EOF |

---

### 🗂️ Move Symbols

Reorder top-level declarations without cut-and-paste:

- **Move `Name` up / down** — available on any struct, interface, method, function, `var`, or `const`
- **Rename `Name`** — triggers the VS Code rename refactor on the symbol

Move to another file or package via the Code Lens above each declaration (see [Code Lens](#-code-lens) section).

---

### 🔎 Navigation shortcuts

- **Show references** — opens the Go Assistant references panel
- **Show implementers** — interface → all implementing types
- **Show implemented interfaces** — struct → interfaces it satisfies
- **Show method references** — method → all call sites
- **Show N method(s) of 'TypeName'** — struct/interface → all its methods
- **Show files importing this package** — cursor on `package` declaration

---

## 🧪 Tests View

A dedicated sidebar panel (**Go Assistant** activity bar icon) with a full test runner.

### What it shows
- Full module → package → file → test → sub-test tree, auto-discovered on workspace open
- Pass ✅ / Fail ❌ / Running 🔄 status with execution time per test
- Run history with per-test results from previous runs
- Coverage highlighting directly in the editor (green = covered, red = uncovered)

### Running tests

Every node in the tree has its own run and debug buttons:

| Scope | Actions available |
|---|---|
| **All tests** in workspace | Run · Debug · Re-run last |
| **Module** | Run module tests |
| **Package** | Run · Debug |
| **File** | Run · Debug |
| **Test function** | Run · Debug |
| **Sub-test** (`t.Run(...)`) | Run · Debug individual sub-test |

### Customizable test flags

Press the **Configure flags** button (⚙️) to toggle per session:

| Flag | Default | Description |
|---|---|---|
| `-v` | ✅ on | Verbose output |
| `-fullpath` | ✅ on | Full file paths in output |
| `-timeout 30s` | ✅ on | Configurable duration |
| `-coverprofile` | ✅ on | Covered lines highlighted |
| `-count=1` | off | Disable result caching |
| `-race` | off | Race detector |
| `-parallel N` | off | Max parallel tests |
| `-bench=.` | off | Also run benchmarks |
| `-run <regex>` | off | Filter tests by name |
| `-coverpkg ./...` | off | Coverage scope |

### Coverage

- **Open HTML report** — generates and opens `cover.html` in the browser
- **Clear coverage** — removes all editor highlights

### Profiling

Toggle CPU, Memory, Blocking, or Mutex profiling per test run directly from the panel toolbar.

---

## 🔭 Code Lens

Inline lenses above each declaration (all individually toggleable):

| Lens | Shown on |
|---|---|
| `N references` | Structs, interfaces, functions, methods |
| `N implementers` | Interfaces |
| `N implementations` | Methods (which interface methods they satisfy) |
| `Implement interface` | Structs |
| `N methods` | Structs (receiver methods count) |
| `N imports` | `package` declaration |
| `▶ Run` / `⬛ Debug` | `func main()` and `func TestXxx()` |
| `Move to file…` | Structs and interfaces |

---

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `goAssistant.codeActions.enable` | `true` | Enable / disable all code actions |
| `goAssistant.codeActions.tagNamingCase` | `"camelCase"` | Tag name casing: `camelCase` or `snakeCase` |
| `goAssistant.codelens.enable` | `true` | Enable / disable all code lenses |
| `goAssistant.codelens.references` | `true` | Show reference counts |
| `goAssistant.codelens.methods` | `true` | Show receiver method counts |
| `goAssistant.codelens.implementers` | `true` | Show implementers for interfaces |
| `goAssistant.codelens.implementations` | `true` | Show interface implementations for methods |
| `goAssistant.codelens.runDebug` | `true` | Show Run/Debug lenses on `main` and tests |
| `goAssistant.codelens.largeProject` | `false` | Cache references (recommended for large codebases) |
| `goAssistant.coverageDecorator` | `true` | Highlight covered/uncovered lines after test runs |

---

## Requirements

- VS Code 1.80.0+
- Go toolchain in `PATH`
- [`gopls`](https://pkg.go.dev/golang.org/x/tools/gopls) (installed automatically with the official Go extension)

## Installation

1. Open VS Code
2. Go to **Extensions** (`Ctrl+Shift+X`)
3. Search for **Go Assistant**
4. Click **Install**

Or [install directly from the marketplace](https://marketplace.visualstudio.com/items?itemName=GustavoBarez.go-assistant).
