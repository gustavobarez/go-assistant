# Change Log

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

## [0.2.8] - 2026-03-20

### Adicionado

#### 📦 External Dependencies

- **Seções na árvore**: `Go Modules` e `Go <version> SDK` dentro da view `External Dependencies`
- **Navegação recursiva**: expansão de pastas/arquivos das dependências e do SDK com ícones respeitando o tema de arquivos do usuário
- **Módulos diretos e indiretos**: classificação baseada no `go.mod` para exibição no nó da dependência

### Alterado

#### 📦 External Dependencies

- **Resolução do `go.mod`**: prioriza `go.mod` do workspace para evitar carregar contexto de módulos externos (cache/SDK)
- **Expansão de dependências mais rápida**: usa diretório local da dependência como caminho principal e usa `go list` apenas como fallback

### Removido

#### 📦 External Dependencies

- **Logs de debug no output**: removidos os logs técnicos do canal de saída da árvore de dependências

## [0.2.4] - 2026-03-19

### Alterado

#### 🧪 Testing — Views

- **Unificação de Tests + Log no mesmo container**: a arquitetura saiu de um painel WebView separado para uma experiência nativa com duas views (`Tests` e `Log`) no mesmo container de testes
- **Foco do log por seleção de teste**: ao abrir log de teste/histórico, a seleção é sincronizada por payload e a view de log é focada automaticamente

#### 🧪 Testing — Navegação

- **Novo comando `Go to Test`**: adicionado para nós de teste na árvore (`test`, `subtest`, `testWithSubs` e histórico), permitindo navegação direta ao código

### Adicionado

- **`goTestResultsNativeViews.ts`**: novo provider nativo para exibição de logs de teste na sidebar (sem depender de WebView)

### Removido

- **`goTestResultsPanel.ts`**: removido o painel WebView legado de resultados
- **Container `go-assistant-test-results`**: removida a área separada de “Test Results (Go Assistant)” do `package.json`

---

## [0.2.3] - 2026-03-19

### Adicionado

#### 🧪 Testing — Resultados e Logs

- **Painel de resultados dedicado**: introduzido `goTestResultsPanel.ts` (WebView) para listar resultados e logs de testes
- **Ação `View Test Log` na árvore de testes**: disponível em testes, subtestes, testes com subtestes e itens do histórico
- **Busca na view de testes**: novos comandos `Search Tests` e `Clear Search` no cabeçalho da view

#### 🧪 Testing — Runner

- **Execução com `go test -json`**: pipeline de processamento de eventos em tempo real para atualizar status, duração e saída dos testes
- **Canal de saída dedicado do runner**: logs técnicos centralizados em `Go Assistant Test Runner`
- **Configuração de log detalhado**: novo setting `goAssistant.logging.verbose`

### Alterado

- **Estrutura interna da view de testes**: ampliação do modelo de resultados/histórico para suportar seleção de logs e renderização no painel dedicado

## [0.2.0] - 2026-03-03

### Adicionado

#### 🧪 Testing — Profiling

- **Modo de profiling global**: Novo botão `$(pulse)` no cabeçalho da view de testes. Permite selecionar um modo de profiling ativo (CPU, Memory, Blocking, Mutex) que é persistido entre sessões via `workspaceState`
- **Profiling apply a qualquer execução individual**: Quando um modo está ativo, qualquer comando de execução que rode um único pacote, arquivo ou teste aplica automaticamente o flag correspondente (`-cpuprofile`, `-memprofile`, `-blockprofile`, `-mutexprofile`)
- **pprof web UI**: Após a execução profiled, uma notificação oferece "Open pprof (web)" (abre `go tool pprof -http=:8080` e o browser automaticamente) ou "Open in terminal" (abre pprof interativo no terminal)
- **Indicador visual no painel**: O título da view exibe `Profile: CPU` (ou o modo ativo) enquanto um perfil está selecionado — limpa automaticamente ao selecionar "None"
- **Ícone diferenciado no cabeçalho**: Usa `$(pulse)` quando nenhum profile está ativo e `$(record)` quando há um profile ativo, via context key `goAssistant.profileActive`

#### 🧪 Testing — Code Lens

- **Botão `▶ Run` por função de teste**: Cada função `TestXxx`, `BenchmarkXxx` e `ExampleXxx` recebe um botão `▶ Run` no código que abre um picker com as opções: Run Test, Debug Test e os 4 modos de profiling
- **Botão `▶ Run` por sub-teste (table-driven)**: Casos individuais de testes orientados a tabela recebem botões `▶ Run` diretamente no código, posicionados na linha de abertura `{` de cada caso
- **Detecção de campo dinâmica**: O campo de nome do sub-teste é detectado diretamente da chamada `t.Run(tt.fieldName, ...)` — funciona com qualquer nome de campo (`name`, `title`, `desc`, etc.), não apenas `name`
- **Suporte a map e struct**: Detecta tanto o padrão `[]struct{ ... }{{ name: "case" }}` quanto `map[string]struct{ ... }{ "case": { ... } }`

#### 🧪 Testing — Geral

- **Run / Debug / Profile por sub-teste**: Comando `go-assistant.runSubTestFromCode` para executar um sub-teste individual a partir do code lens, com picker Run/Debug/Profile idêntico ao de funções de teste

### Corrigido

#### 🧪 Testing — Profiling

- **Profiling desativado para `./...`**: Comandos "Run All Tests" e "Run All Packages" não aplicam profiling (o `go test` não suporta flags de profile com múltiplos pacotes). Profiling é aplicado apenas em execuções de pacote único, arquivo ou teste

#### 🧪 Testing — Geral

- **"Run All Tests" usado module root correto**: O botão de rodar todos os testes no topo da view agora itera pelos module roots descobertos (igual ao "Run All Packages"), garantindo funcionamento correto em monorepos com múltiplos `go.mod`
- **Cobertura HTML sem erro "not in std"**: `go tool cover` agora é executado a partir do `moduleRoot` (onde fica o `go.mod`) em vez do workspace root, evitando o erro `package X is not in std`
- **Picker de interface não ignorava seleção**: `picker.dispose()` disparava `onDidHide` de forma síncrona antes de `resolve(selected)`, fazendo a seleção ser ignorada — corrigido invertendo a ordem
- **Detecção de campo `name` em tests view**: A view de testes também usa o campo descoberto dinamicamente de `t.Run(tt.field)` em vez de assumir `name`

### Removido

- **Código morto de ~20KB**: Removidas as funções `findAvailableInterfaces`, `extractInterfaceMethods`, `getPackageNameFromDocument`, `implementInterfaceMethods` e as interfaces `InterfaceInfo`/`InterfaceMethod` de `extension.ts` — nunca eram chamadas
- **Comando `runAllTestsWithCoverage`**: Removido (nunca foi registrado)

---

## [0.1.9] - 2026-02-26

### Adicionado

#### 🆕 Code Actions — Interface

- **Add method to interface and all implementations**: Nova ação disponível via `Ctrl+.` em qualquer parte de uma interface (`type`, nome, palavra-chave `interface` ou dentro do corpo). Insere imediatamente um snippet com tab stops (`name`, `params`, `return`) na última linha da interface. Ao mover o cursor para fora da linha, adiciona automaticamente o método stub (`// TODO: implement me` + `panic("implement me")`) em todos os structs que implementam a interface e redireciona o editor para a primeira implementação

### Corrigido

#### 🆕 Code Actions — Interface

- **Detecção de interface ampliada**: As code actions de interface agora aparecem ao posicionar o cursor em qualquer ponto do bloco — `type`, nome, `interface {`, campos internos ou `}` — e não apenas sobre o nome exato

#### 🆕 Code Actions — Fill All Fields

- **Zero values corretos por tipo**: Cada field preenchido agora recebe o zero value adequado ao seu tipo:
  - `string` → `""`
  - `int`, `float64`, demais numéricos → `0`
  - `bool` → `false`
  - Ponteiros, slices, maps, channels, funções → `nil`
  - `error` → `nil`
  - Interfaces nomeadas (`io.Reader`, `context.Context`, etc.) → `nil` (detectado via hover do gopls)
  - Structs nomeados → `T{}`

## [0.1.8] - 2026-02-24

### Adicionado

#### 🚀 CodeLens — main.go

- **Run / Debug main.go**: Botões `▶ Run` e `▶ Debug` aparecem acima de `func main()` em arquivos com `package main`. Run executa `go run .` no diretório do arquivo; Debug inicia uma sessão de debug via `go.debug`

### Corrigido

#### 🧪 Testing — Histórico

- **Run All Tests agora gera histórico**: O botão de rodar todos os testes (topo da view) não registrava o resultado no histórico — corrigido para se comportar igual aos demais comandos de run

## [0.1.7] - 2026-02-24

### Removido

- **Postfix Completion Provider**: Removido o provider de postfix completions (`.if`, `.for`, `.print`, etc.) que causava sugestões indevidas ao digitar em expressões como `fmt.P`. Essa responsabilidade fica a cargo de outras extensões
- **Setting `goAssistant.postfixCompletion.enable`**: Removido junto com o provider

## [0.1.6] - 2026-02-25

### Adicionado

#### 🧪 Testing — Flags

- **Flag `-parallel`**: Nova opção para controlar o número máximo de testes rodando em paralelo. Ao ativar, um input é exibido com placeholder `2-4`
- **Flag `-coverpkg` customizável**: Renomeada para "Coverage Path (-coverpkg)" — agora permite inserir qualquer padrão de pacote (placeholder `./...`) em vez de ser fixada em `./...`

### Corrigido

#### 🧪 Testing — Flags

- Flags com `promptForValue` (como `-coverpkg`, `-parallel`, `-run`) agora são automaticamente desmarcadas quando o usuário pressiona Enter sem digitar nenhum valor, prevenindo flags ativas sem valor definido

## [0.1.5] - 2026-02-24

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
