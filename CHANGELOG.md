# Change Log

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

## [0.1.5] - 2026-02-24

### Adicionado

#### 🆕 Code Actions

- **Add json tags to all fields**: Nova ação em bulk — adiciona tags `json` a todos os fields de um struct de uma vez, ativável de qualquer linha dentro do struct (não só na linha de declaração)
- **Add custom tag to all fields**: Pergunta o nome da tag uma vez e aplica em todos os fields do struct simultaneamente
- **Fill All Fields**: Preenche todos os fields exportados de um struct literal (`&User{}`) com zero values automaticamente

#### 🏷️ Tag Naming (camelCase / snakeCase)

- Tags geradas agora respeitam convenção de nomenclatura configurável via `goAssistant.codeActions.tagNamingCase`
  - `"camelCase"` (padrão): `UserID` → `userId`, `CreatedAt` → `createdAt`
  - `"snakeCase"`: `UserID` → `user_id`, `CreatedAt` → `created_at`
- Tratamento correto de acrônimos: `ID` → `id` (não `iD`), `HTTPSServer` → `httpsServer` / `https_server`

#### 🔌 Protobuf CodeLens

- Busca de arquivos gerados agora funciona mesmo quando `.proto` e `.pb.go` estão em pastas diferentes (busca em todo o workspace)
- Suporte a ambos os arquivos gerados (`.pb.go` e `_grpc.pb.go`) — interfaces de client/server gRPC agora são encontradas corretamente

### Removido

- **Handle error**: Ação removida completamente (`createHandleErrorActions`)
- **Proto reference counts**: Contagens de referências/implementações nos CodeLens do `.proto` removidas — gopls não tem consciência de arquivos `.proto`, e a alternativa baseada em busca de texto não era confiável

---

## [0.1.3] - 2026-02-21

### Adicionado

#### 🆕 CodeLens

- **Debug table-driven tests**: Detecta padrões de testes tabulares (`tests := []struct` e `for _, tt := range tests`) e adiciona botões Run/Debug
- **Package imports count**: Mostra quantos arquivos importam um pacote específico
- **Move declaration**: Move funções, métodos, structs e interfaces para outro arquivo ou pacote
- **Protobuf support**: CodeLens completo para arquivos `.proto` — navegação para código Go gerado, contagem de referências para messages/enums, chamadas de cliente para RPCs e implementações de servidores gRPC

#### 🆕 Inlay Hints

- **Build tag diagnostics**: Avalia build tags (`//go:build` e `// +build`) e indica se o arquivo será compilado no OS/Arch atual, com suporte a expressões booleanas completas (AND, OR, NOT)

#### 🆕 Code Actions

**Imports:**

- Sort imports
- Merge import blocks
- Cleanup imports (remove não usados + organiza)
- Remove unused imports (individual ou em lote)
- Remove broken imports (individual ou em lote)
- Rewrite dot imports (`import .` → import normal)

**Variáveis:**

- Converter `var x = y` ↔ `x := y`
- Inline variable
- Create variable (cria var quando não existe)
- Assignment to short var decl (`x = y` → `x := y`)

**Strings:**

- Merge string literals

**Operadores:**

- Flip binary operations (`a + b` → `b + a`)
- Remove redundant parentheses

**Control flow:**

- Iterate over collection (gera loops for)
- Unwrap else
- Anonymous function conversions
- Defer to multiline

**Structs & Interfaces:**

- Generate getter/setter
- Generate stub interface
- Extract embedded type
- Inline embedded struct/interface

**Fields & Parâmetros:**

- Split field declarations (`x, y int` → linhas separadas)
- Move parameter up/down
- Add json tag
- Remove all tags

**Organização:**

- Move declaration up/down
- Add missing return statement

**Navegação:**

- Show type methods
- Show package imports
- Rename

**Channels:**

- Add channel receive to assignment (`<-ch` → `value := <-ch`)

**Receivers:**

- Synchronize receiver names

**Run & Test:**

- Run/debug func main
- Run/debug tests

#### 🔍 Inspections

- **Unused assignments**: Detecta variáveis atribuídas mas não usadas
- **Unreachable code**: Detecta código após `return`/`panic`/`break`/`continue`
- **Unhandled errors**: Detecta erros não verificados
- **Variable shadowing**: Detecta variáveis sombreadas em escopos internos

#### 🐛 Debugging

- **Inline values**: Mostra valores de variáveis inline durante uma sessão de debug

#### 🛠️ Helpers

- **Auto-update imports**: Atualiza automaticamente imports quando arquivos `.go` são movidos
- **Auto-update references**: Atualiza referências em todos os arquivos ao mover
- **Package declaration sync**: Atualiza a declaração `package` quando um arquivo muda de pasta
- **Folder move support**: Suporte para movimento de pastas inteiras

#### 🎨 Coverage

- **Customizable colors**: Cores do coverage decorator configuráveis via `goAssistant.coverageDecorator.*`

---

## [0.0.1] - 2026-02-16

### Adicionado

#### 🆕 CodeLens Avançado

- **Debug table-driven tests**: Detecta padrões de testes tabulares (`tests := []struct` e `for _, tt := range tests`) e adiciona botões Run/Debug
- **Package imports count**: Mostra quantos arquivos importam um pacote específico
- **Move declaration**: CodeLens para mover funções/métodos para outro arquivo ou pacote
- **Protobuf support**: CodeLens completo para arquivos .proto
  - Navegação de definições .proto para código Go gerado (.pb.go)
  - Contagem de referências Go para messages e enums
  - Contagem de chamadas de cliente para métodos RPC
  - Contagem de implementações de servidores gRPC para services

#### 🆕 Inlay Hints Expandidos

- **Build tag diagnostics**: Avalia build tags (`//go:build` e `// +build`) e indica se o arquivo será compilado no OS/Arch atual
  - Mostra `✓ (will build)` ou `✗ (won't build: reason)`
  - Suporta expressões booleanas completas (AND, OR, NOT)
  - Detecção automática de OS/Arch do sistema

#### 🆕 Code Actions (60+ ações implementadas)

**Import Management:**

- Sort imports (organização alfabética)
- Merge import blocks (unifica múltiplos blocos)
- Cleanup imports (organiza e remove não usados)
- Remove unused imports (individual e em lote)
- Remove broken imports (individual e em lote)
- Rewrite dot imports (import . → import normal)

**Variables & Declarations:**

- Var declarations (conversão `var x = y` ↔ `x := y`)
- Inline variable (substitui variável pelo valor)
- Create unresolved variable (cria var quando não existe)
- Assignment to short var decl (`x = y` → `x := y`)

**String & Literals:**

- Merge string literals

**Operators & Expressions:**

- Flip binary operations (`a + b` → `b + a`)
- Remove redundant parentheses (`(x)` → `x`)

**Control Flow:**

- Iterate over collection (gera loops for)
- Unwrap else (remove else desnecessário)
- Anonymous function conversions
- Defer to multiline (converte `defer f()` para closure)

**Struct & Interface:**

- Generate getter/setter (métodos para struct fields)
- Generate stub interface (cria interface de tipo)
- Extract embedded type (interface disponível)
- Inline embedded struct/interface (interface disponível)

**Fields & Parameters:**

- Split field declarations (`x, y int` → linhas separadas)
- Add json tag (adiciona tag json a fields)
- Remove all tags (remove tags de fields)

**Code Organization:**

- Move declaration up/down (reorganiza código)
- Add missing return statement

**Navigation & Inspection:**

- Show type methods (lista todos os métodos de um tipo)
- Show package imports (mostra onde um pacote é importado)
- Rename (atalho para refatoração de rename)

**Channels & Concurrency:**

- Add channel receive to assignment (`<-ch` → `value := <-ch`)

**Methods & Receivers:**

- Synchronize receiver names (padroniza nomes de receivers)

**Running & Testing:**

- Run/debug main (botões para executar/debugar func main)
- Run/debug tests (botões para executar/debugar testes)

#### 🔍 Inspections (Diagnósticos de Código)

- **Unused assignments**: Detecta variáveis atribuídas mas não usadas
- **Unreachable code**: Detecta código após return/panic/break/continue
- **Unhandled errors**: Detecta erros não verificados
- **Variable shadowing**: Detecta variáveis sombreadas em escopos internos
- Diagnósticos configuráveis por categoria
- Integração com VS Code Problems panel

#### 🐛 Debugging Features

- **Inline values**: Mostra valores de variáveis durante debugging
- Detecção automática de declarações de variáveis
- Lookup de valores em escopo
- Suporte para expressões avaliáveis

#### 🛠️ Helpers (Automação)

- **Auto-update imports**: Atualiza automaticamente imports quando arquivos são movidos
- **Auto-update references**: Atualiza referências em todos os arquivos
- **Package declaration sync**: Atualiza package quando arquivo muda de pasta
- **Folder move support**: Suporte para movimento de pastas completas
- Notificações de progresso durante operações

## [0.0.1] - 2026-02-16

### Adicionado

#### 🔍 go.mod

- Busca automática de `go.mod` subindo diretórios pai
- Busca recursiva em todo workspace quando necessário
- Suporte para projetos com múltiplos módulos Go

#### 📊 CodeLens

- **Structs**: contagem de referências, métodos com receiver e interfaces implementadas
- **Interfaces**: contagem de referências e implementadores
- **Métodos e funções**: contagem de referências
- **Fields** (opcional, desabilitado por padrão): contagem de acessos a campos de structs

#### 💡 Inlay Hints

- Contagem de referências inline no código (`⟨N refs⟩`), desabilitado por padrão
