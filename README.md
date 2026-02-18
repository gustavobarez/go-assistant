# Go Helper

Uma extensão VS Code poderosa para Golang que fornece informações detalhadas sobre referências, implementações e estrutura de código diretamente no editor.

## ✨ Funcionalidades

### 🆕 Novidades Recentes

**CodeLens**:

- ✅ Debug table-driven tests (detecta e adiciona botões de debug para testes tabulares)
- ✅ Implement interface (ação rápida para gerar stubs de implementação)
- ✅ Package imports count (mostra quantos arquivos importam um pacote)
- ✅ Move declaration (move funções/métodos para outro arquivo ou pacote)
- ✅ Change signature (altera assinatura de funções e métodos)
- ✅ Protobuf support (CodeLens em arquivos .proto com navegação e contagens)

**Inlay Hints**:

- ✅ Build tag diagnostics (avalia tags `//go:build` e indica se o arquivo será compilado no OS/Arch atual)

**Code Actions** (60+ ações implementadas):

- ✅ Import management (sort, merge, cleanup, remove unused/broken)
- ✅ Var declarations (conversão entre `var x = y` e `x := y`)
- ✅ Rune/string literals (conversão entre `'a'` e `"a"`)
- ✅ Generate getter/setter (geração de métodos para struct fields)
- ✅ Add missing return (adiciona return statement faltando)
- ✅ Interface{}/any conversion (atualização para sintaxe moderna)
- ✅ Iterate over collection (geração de loops for)
- ✅ Handle errors (múltiplas estratégias: return, wrap, panic, log)
- ✅ String conversions (raw strings, merge literals)
- ✅ Condition manipulation (invert if, add else, flip binary ops, De Morgan)
- ✅ Compound assignments (x += a ↔ x = x + a)
- ✅ Field operations (split fields, add/remove tags)
- ✅ Parameter operations (rename unused to \_)
- ✅ Inline variable (simplificado)
- ✅ Generate stub interface
- ✅ Move declaration up/down
- ✅ Show type methods (lista todos os métodos de um tipo)
- ✅ Show package imports (mostra onde um pacote é importado)
- ✅ Remove parentheses (remove parênteses redundantes)
- ✅ Channel receive to assignment (<-ch → value := <-ch)
- ✅ Defer to multiline (converte para closure)
- ✅ Assignment to short var (= → :=)
- ✅ Rename (refatoração via editor.action.rename)
- ✅ Sync receiver names (sincroniza nomes de receivers em métodos)
- ✅ Run/debug main (adiciona botões para executar/debugar main)
- ✅ Run/debug tests (adiciona botões para executar/debugar testes)
- ✅ E muito mais...

**Inspections** (Diagnósticos de Código):

- ✅ Unused assignments (detecta variáveis atribuídas mas não usadas)
- ✅ Unreachable code (código após return/panic)
- ✅ Unhandled errors (erros não verificados)
- ✅ Variable shadowing (variáveis sombreadas)

**Debugging**:

- ✅ Inline values (mostra valores de variáveis durante debug)

**Helpers**:

- ✅ Auto-update imports (atualiza imports ao mover arquivos/pastas)
- ✅ Auto-update package declarations (mantém código sincronizado)

### 🔍 Busca Inteligente de go.mod

- Encontra automaticamente o arquivo `go.mod` mesmo quando o VS Code está aberto em um diretório pai
- Busca recursivamente em todo o workspace quando necessário
- Funciona perfeitamente em projetos com múltiplos módulos Go
- Suporta arquivos Go em qualquer nível de profundidade do projeto

### 📊 CodeLens Avançado

#### Para Structs:

- **Número de referências**: Quantos lugares no código referenciam esta struct
- **Número de métodos**: Quantos métodos usam esta struct como receiver (ex: `(h *Handler)`)
- **Interfaces implementadas**: Mostra quais interfaces esta struct implementa
- **Clicável**: Clique nas informações para ver a lista completa na UI do VS Code

#### Para Interfaces:

- **Número de referências**: Quantos lugares no código referenciam esta interface
- **Implementadores**: Mostra quantos tipos implementam esta interface
- **Clicável**: Clique para ver todas as implementações

#### Para Métodos e Funções:

- **Número de referências**: Quantas vezes este método/função é chamado
- **Clicável**: Clique para ver todas as chamadas

#### Para Fields (Opcional):

- **Número de referências**: Quantas vezes o campo é acessado
- Desabilitado por padrão (pode deixar lento em projetos grandes)
- Habilite com `goHelper.codelens.fields`

#### Para Protocol Buffers (.proto):

- **Navegação**: Links diretos de definições .proto para código Go gerado
- **Messages**: Navega para `type MessageName struct` e mostra contagem de referências Go
- **Enums**: Navega para constantes Go (`EnumName_VALUE`) e mostra contagem de uso
- **Services**: Links para interfaces gRPC Client/Server geradas
- **RPC Methods**: Contagem de chamadas de cliente e implementações de servidor
- **Contadores especiais**:
  - ⭐ Contagem de chamadas RPC em clientes
  - ⭐ Contagem de implementações de servidores gRPC
- **Detecção automática**: Encontra arquivos `.pb.go` e `_grpc.pb.go` gerados

### 💡 Inlay Hints (Opcional)

#### Contagem de Referências

- Mostra contagem de referências inline no código
- Desabilitado por padrão para não poluir o editor
- Habilite com `goHelper.inlayHints.enable`
- Formato: `⟨N refs⟩` após o nome do símbolo

#### Build Tag Diagnostics

- Avalia build tags (`//go:build linux`, `// +build darwin`, etc.)
- Mostra se o arquivo será compilado no OS/Arch atual
- Formato: `✓ (will build)` ou `✗ (won't build: requires linux)`
- Habilite com `goHelper.inlayHints.buildTags`

### 🛠️ Code Actions (28+ Ações Rápidas)

Ações disponíveis quando você pressiona `Ctrl+.` (ou `Cmd+.` no Mac):

#### Manipulação de Erros

- Handle error (return err)
- Handle error (panic)
- Handle error (wrapped error com fmt.Errorf)
- Handle error (log and return)

#### Variáveis e Declarações

- Converter entre `var x = y` e `x := y`
- Extract to variable
- Generate getter/setter para campos de struct
- Add missing return statement

#### Strings e Literais

- Converter entre raw strings e regular strings
- Merge string literals
- Converter entre rune literal (`'a'`) e string literal (`"a"`)

#### Condições e Controle de Fluxo

- Invert if condition
- Add else block
- Expand else if
- Unwrap else (remove else desnecessário)
- Iterate over collection (gerar loops for)
- Anonymous function conversions

#### Imports e Organização

- Sort imports
- Add common imports (fmt, strings, errors, context, time, log)
- Detect and remove unused imports

#### Tipos e Interfaces

- Implement interface (gerar stubs de métodos)
- Convert interface{} to any
- Show references
- Show implementers
- Show implemented interfaces

#### Operações e Números

- Flip binary operations (`a + b` → `b + a`)
- Remove redundant parentheses
- Add/remove number separators (`1000000` ↔ `1_000_000`)
- Add/remove octal prefix (`0100` ↔ `0o100`)

## ⚙️ Configurações

Todas as funcionalidades podem ser habilitadas/desabilitadas individualmente:

```json
{
  "goHelper.codelens.enable": true, // Habilita/desabilita todos os CodeLens
  "goHelper.codelens.references": true, // Mostra contagem de referências
  "goHelper.codelens.methods": true, // Mostra contagem de métodos
  "goHelper.codelens.implementers": true, // Mostra implementadores de interfaces
  "goHelper.codelens.implementations": true, // Mostra interfaces implementadas
  "goHelper.codelens.fields": false, // Mostra referências de campos (lento em projetos grandes)
  "goHelper.codelens.packageImports": true, // Mostra contagem de imports do pacote
  "goHelper.codelens.runTests": true, // Mostra botões Run/Debug para testes
  "goHelper.codelens.debugTests": true, // Mostra botões Debug para table-driven tests
  "goHelper.inlayHints.enable": false, // Mostra hints inline
  "goHelper.inlayHints.buildTags": true // Mostra diagnósticos de build tags
}
```

## 🚀 Uso

1. Abra qualquer arquivo `.go` no VS Code
2. A extensão será ativada automaticamente
3. Você verá as informações de referência acima de structs, interfaces e métodos
4. Clique nas informações para ver a lista completa de referências

## 📋 Requisitos

- VS Code 1.109.0 ou superior
- **Extensão oficial de Go para VS Code** (obrigatório)
- gopls (Go Language Server) instalado e configurado

## 🔧 Como Funciona

A extensão utiliza:

- **CodeLens API** do VS Code para mostrar informações inline
- **Document Symbol Provider** para detectar structs, interfaces e métodos
- **Reference Provider** para encontrar todas as referências
- **Implementation Provider** para encontrar implementadores de interfaces
- **Type Definition Provider** para encontrar interfaces implementadas
- **Busca recursiva** para encontrar go.mod em qualquer lugar do workspace

## 🎯 Casos de Uso

### Projeto na Raiz

```
/workspace
  go.mod
  main.go
  pkg/
    handler.go
```

✅ Funciona perfeitamente

### VS Code Aberto Acima do Módulo

```
/workspace              <- VS Code aberto aqui
  docs/
  scripts/
  go-project/           <- go.mod aqui
    main.go
```

✅ Encontra o go.mod automaticamente

### Múltiplos Módulos Go

```
/workspace
  service1/
    go.mod
    main.go
  service2/
    go.mod
    main.go
```

✅ Detecta o go.mod correto para cada arquivo

## 💻 Desenvolvimento

```bash
# Instalar dependências
pnpm install

# Compilar e assistir mudanças
pnpm run watch

# Executar testes
pnpm test

# Testar a extensão
# Pressione F5 no VS Code
```

## 🐛 Troubleshooting

### CodeLens não aparece?

1. Verifique se a extensão Go está instalada
2. Verifique se o gopls está funcionando (`Go: Restart Language Server`)
3. Verifique as configurações em `goHelper.codelens.*`

### go.mod não encontrado?

1. Verifique se o arquivo go.mod existe no projeto
2. Veja o console de saída da extensão: `Output > Go Helper`
3. A busca pode levar alguns segundos em projetos grandes

### Lentidão?

1. Desabilite `goHelper.codelens.fields` (pode ser lento em projetos grandes)
2. Desabilite `goHelper.inlayHints.enable` se não estiver usando

## 📝 Release Notes

### 0.0.1

Versão inicial com suporte completo para:

- ✅ Busca automática de go.mod em qualquer nível do workspace
- ✅ CodeLens para structs (referências + métodos + interfaces implementadas)
- ✅ CodeLens para interfaces (referências + implementadores)
- ✅ CodeLens para métodos e funções (referências)
- ✅ CodeLens para fields (opcional, desabilitado por padrão)
- ✅ Inlay hints para contagem de referências (opcional)
- ✅ Configurações granulares para cada funcionalidade
- ✅ Interface clicável para visualizar todas as referências
- ✅ Suporte para projetos com múltiplos módulos Go
- ✅ Funciona com VS Code aberto em qualquer diretório pai

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

- Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
- Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
- Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

- [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
- [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
