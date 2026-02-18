# Change Log

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

## [Unreleased]

### Adicionado

#### 🆕 CodeLens Avançado

- **Debug table-driven tests**: Detecta padrões de testes tabulares (`tests := []struct` e `for _, tt := range tests`) e adiciona botões Run/Debug
- **Implement interface**: Action para gerar stubs de implementação de interfaces
- **Package imports count**: Mostra quantos arquivos importam um pacote específico
- **Move declaration**: CodeLens para mover funções/métodos para outro arquivo ou pacote
- **Change signature**: CodeLens para alterar assinatura de funções e métodos não-interface
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
- Add var type (adiciona tipo explícito)
- Assignment to short var decl (`x = y` → `x := y`)

**String & Literals:**

- Rune/string literals (conversão `'a'` ↔ `"a"`)
- Raw string conversions
- Merge string literals

**Operators & Expressions:**

- Flip binary operations (`a + b` → `b + a`)
- Flip comma (`a, b` → `b, a`)
- Apply De Morgan's Laws (`!(a && b)` ↔ `!a || !b`)
- Compound assignments (`x += a` ↔ `x = x + a`)
- Remove redundant parentheses (`(x)` → `x`)

**Control Flow:**

- Iterate over collection (gera loops for)
- Unwrap else (remove else desnecessário)
- Add else to if (adiciona bloco else)
- Anonymous function conversions
- Defer to multiline (converte `defer f()` para closure)

**Struct & Interface:**

- Generate getter/setter (métodos para struct fields)
- Generate stub interface (cria interface de tipo)
- Implement interface (gera stubs de métodos)
- Extract embedded type (interface disponível)
- Inline embedded struct/interface (interface disponível)

**Fields & Parameters:**

- Split field declarations (`x, y int` → linhas separadas)
- Rename unused parameters (substitui por `_`)
- Remove parameter names (substitui por `_`)
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

#### 📊 Estatísticas

- CodeLens: 17/17 implementados (100%)
- Inlay Hints: 2/2 implementados (100%)
- Code Actions: 60+ implementados (~80% das funcionalidades da tooltitude)
- Postfix Completions: 23 implementados (100%)
- Inspections: 4/7 implementados (57%) - outros delegados ao gopls
- Debugging: 1/1 implementados (100%)
- Helpers: 2/2 implementados (100%)
- Postfix Completions: 23 implementados (100%)
- Inspections: 4/7 implementados (57%)
- Debugging: 1/1 implementados (100%)
- Helpers: 2/2 implementados (100%)

## [0.0.1] - 2026-02-16

### Adicionado

#### 🔍 Busca Avançada de go.mod

- Busca automática de `go.mod` subindo diretórios pai
- Busca recursiva em todo workspace quando necessário
- Suporte para projetos com múltiplos módulos Go
- Detecção do módulo Go mais próximo para cada arquivo
- Funciona quando VS Code está aberto em qualquer nível acima do go.mod

#### 📊 CodeLens Completo

- **Para Structs:**
  - Contagem de referências
  - Contagem de métodos com receiver
  - Lista de interfaces implementadas
  - Interface clicável para navegação
- **Para Interfaces:**
  - Contagem de referências
  - Contagem de implementadores (tipos que implementam)
  - Interface clicável para navegação

- **Para Métodos e Funções:**
  - Contagem de referências (chamadas)
  - Interface clicável para navegação

- **Para Fields (opcional):**
  - Contagem de acessos a campos de structs
  - Desabilitado por padrão para performance

#### 💡 Inlay Hints

- Mostra contagem de referências inline no código
- Formato: `⟨N refs⟩` após símbolos
- Desabilitado por padrão
- Configurável via `goHelper.inlayHints.enable`

#### ⚙️ Configurações Granulares

- `goHelper.codelens.enable` - Habilita/desabilita todos os CodeLens
- `goHelper.codelens.references` - Toggle referências
- `goHelper.codelens.methods` - Toggle contagem de métodos
- `goHelper.codelens.implementers` - Toggle implementadores de interface
- `goHelper.codelens.implementations` - Toggle interfaces implementadas
- `goHelper.codelens.fields` - Toggle referências de campos (pode ser lento)
- `goHelper.inlayHints.enable` - Toggle inlay hints

#### 🔧 Integrações Avançadas

- Usa `Reference Provider` da extensão Go oficial
- Usa `Implementation Provider` para encontrar implementadores
- Usa `Type Definition Provider` para interfaces implementadas
- Atualização automática ao editar código
- Refresh automático ao mudar configurações

### Técnico

- Implementação completa do CodeLensProvider
- Implementação do InlayHintsProvider
- Sistema robusto de busca de go.mod recursivo
- Suporte para workspaces com estruturas complexas
- Logging para debugging em console

### Performance

- Fields CodeLens desabilitado por padrão (pode impactar em projetos grandes)
- Busca de go.mod com limite de profundidade (10 níveis)
- Cache de símbolos para melhor performance
- Ignoração de diretórios comuns (node_modules, vendor, .\*)

### Documentação

- README.md completo com todos os recursos
- EXEMPLO.md com código de demonstração real
- Exemplos de configuração para diferentes cenários
- Guia de troubleshooting
- Documentação de casos de uso comuns
