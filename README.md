# Go Assistant

Powerful Go development helpers with code actions, refactoring tools, and smart features to boost your productivity.

## Features

- **Code Actions**: Extract variables, handle errors, convert declarations, and more
- **Struct Tools**: Add/remove JSON tags to all fields at once
- **Move Declarations**: Move structs, interfaces, functions between files and packages
- **Smart Refactoring**: Flip binary operations, merge strings, split fields
- **Error Handling**: Quick actions to handle errors (return, wrap, log, panic)
- **Show References**: View references, implementations, and type methods
- **Symbol Navigation**: Jump to implementers, interfaces, and method references

## Usage

Open any `.go` file and press **Ctrl+.** (or **Cmd+.** on Mac) to see available actions!

## Examples

### Handle errors quickly

```go
err := doSomething()
// Press Ctrl+. and choose from:
// - Handle error: return err
// - Handle error: return wrapped
// - Handle error: log and return
```

### Add JSON tags to all struct fields

```go
type User struct {  // <- Press Ctrl+. here
    Name    string
    Email   string
    Age     int
}
// Transforms to:
// Name    string `json:"name"`
// Email   string `json:"email"`
// Age     int    `json:"age"`
```

### Extract to variable

```go
result := calculateSomething(a + b * c)  // Select "a + b * c" and press Ctrl+.
// Transforms to:
// name := a + b * c
// result := calculateSomething(name)
```

## Requirements

- VS Code 1.80.0 or higher
- Go installed and available in PATH (for gopls integration)

## Installation

1. Open VS Code or [click here](https://marketplace.visualstudio.com/items?itemName=GustavoBarez.go-assistant)
2. Go to **Extensions**
3. Search for: `Go Assistant`
4. Click **Install**

## More Actions

All features appear under **"More Actions..."** when you press Ctrl+. (or Cmd+.) in your Go code!
