import * as vscode from "vscode";

interface PostfixTemplate {
  suffix: string;
  description: string;
  template: (expr: string) => string;
  detail?: string;
}

export class GoPostfixCompletionProvider
  implements vscode.CompletionItemProvider
{
  private templates: PostfixTemplate[] = [
    // Control flow
    {
      suffix: "if",
      description: "if expr { }",
      detail: "Create if statement",
      template: (expr) => `if ${expr} {\n\t\n}`,
    },
    {
      suffix: "ifn",
      description: "if !expr { }",
      detail: "Create negated if statement",
      template: (expr) => `if !${expr} {\n\t\n}`,
    },
    {
      suffix: "ifnil",
      description: "if expr == nil { }",
      detail: "Check if nil",
      template: (expr) => `if ${expr} == nil {\n\t\n}`,
    },
    {
      suffix: "ifnnil",
      description: "if expr != nil { }",
      detail: "Check if not nil",
      template: (expr) => `if ${expr} != nil {\n\t\n}`,
    },
    {
      suffix: "ifempty",
      description: "if len(expr) == 0 { }",
      detail: "Check if empty",
      template: (expr) => `if len(${expr}) == 0 {\n\t\n}`,
    },
    {
      suffix: "ifnempty",
      description: "if len(expr) != 0 { }",
      detail: "Check if not empty",
      template: (expr) => `if len(${expr}) != 0 {\n\t\n}`,
    },

    // Loops
    {
      suffix: "for",
      description: "for expr { }",
      detail: "Create for loop",
      template: (expr) => `for ${expr} {\n\t\n}`,
    },
    {
      suffix: "for_range",
      description: "for i, v := range expr { }",
      detail: "Create range loop",
      template: (expr) => `for i, v := range ${expr} {\n\t\n}`,
    },

    // Statements
    {
      suffix: "switch",
      description: "switch expr { }",
      detail: "Create switch statement",
      template: (expr) => `switch ${expr} {\ncase :\n\t\n}`,
    },
    {
      suffix: "return",
      description: "return expr",
      detail: "Return expression",
      template: (expr) => `return ${expr}`,
    },
    {
      suffix: "defer",
      description: "defer expr",
      detail: "Defer expression",
      template: (expr) => `defer ${expr}`,
    },

    // Built-in functions
    {
      suffix: "print",
      description: "fmt.Println(expr)",
      detail: "Print expression",
      template: (expr) => `fmt.Println(${expr})`,
    },
    {
      suffix: "println",
      description: "fmt.Println(expr)",
      detail: "Print expression with newline",
      template: (expr) => `fmt.Println(${expr})`,
    },
    {
      suffix: "printf",
      description: 'fmt.Printf("%v", expr)',
      detail: "Print formatted",
      template: (expr) => `fmt.Printf("%v\\n", ${expr})`,
    },
    {
      suffix: "panic",
      description: "panic(expr)",
      detail: "Panic with expression",
      template: (expr) => `panic(${expr})`,
    },
    {
      suffix: "len",
      description: "len(expr)",
      detail: "Get length",
      template: (expr) => `len(${expr})`,
    },
    {
      suffix: "cap",
      description: "cap(expr)",
      detail: "Get capacity",
      template: (expr) => `cap(${expr})`,
    },
    {
      suffix: "close",
      description: "close(expr)",
      detail: "Close channel",
      template: (expr) => `close(${expr})`,
    },
    {
      suffix: "new",
      description: "new(expr)",
      detail: "Allocate new",
      template: (expr) => `new(${expr})`,
    },
    {
      suffix: "make",
      description: "make(expr)",
      detail: "Make slice/map/channel",
      template: (expr) => `make(${expr}, 0)`,
    },
    {
      suffix: "append",
      description: "append(expr, ...)",
      detail: "Append to slice",
      template: (expr) => `append(${expr}, value)`,
    },
    {
      suffix: "delete",
      description: "delete(expr, key)",
      detail: "Delete from map",
      template: (expr) => `delete(${expr}, key)`,
    },

    // Operators
    {
      suffix: "parens",
      description: "(expr)",
      detail: "Wrap in parentheses",
      template: (expr) => `(${expr})`,
    },
    {
      suffix: "&",
      description: "&expr",
      detail: "Get address",
      template: (expr) => `&${expr}`,
    },
    {
      suffix: "!",
      description: "!expr",
      detail: "Negate boolean",
      template: (expr) => `!${expr}`,
    },
    {
      suffix: "*",
      description: "*expr",
      detail: "Dereference pointer",
      template: (expr) => `*${expr}`,
    },
    {
      suffix: "<-",
      description: "<-expr",
      detail: "Receive from channel",
      template: (expr) => `<-${expr}`,
    },

    // Variable declarations
    {
      suffix: "var",
      description: "var id = expr",
      detail: "Declare variable",
      template: (expr) => `var name = ${expr}`,
    },
    {
      suffix: "const",
      description: "const id = expr",
      detail: "Declare constant",
      template: (expr) => `const name = ${expr}`,
    },
    {
      suffix: ":=",
      description: "id := expr",
      detail: "Short variable declaration",
      template: (expr) => `name := ${expr}`,
    },
    {
      suffix: "=",
      description: "id = expr",
      detail: "Assignment",
      template: (expr) => `name = ${expr}`,
    },

    // String operations
    {
      suffix: "ToLower",
      description: "strings.ToLower(expr)",
      detail: "Convert to lowercase",
      template: (expr) => `strings.ToLower(${expr})`,
    },
    {
      suffix: "ToUpper",
      description: "strings.ToUpper(expr)",
      detail: "Convert to uppercase",
      template: (expr) => `strings.ToUpper(${expr})`,
    },
    {
      suffix: "Split",
      description: "strings.Split(expr, sep)",
      detail: "Split string",
      template: (expr) => `strings.Split(${expr}, ",")`,
    },
    {
      suffix: "Join",
      description: "strings.Join(expr, sep)",
      detail: "Join strings",
      template: (expr) => `strings.Join(${expr}, ",")`,
    },
    {
      suffix: "Contains",
      description: "strings.Contains(expr, substr)",
      detail: "Check if contains",
      template: (expr) => `strings.Contains(${expr}, "substr")`,
    },
    {
      suffix: "HasPrefix",
      description: "strings.HasPrefix(expr, prefix)",
      detail: "Check if has prefix",
      template: (expr) => `strings.HasPrefix(${expr}, "prefix")`,
    },
    {
      suffix: "HasSuffix",
      description: "strings.HasSuffix(expr, suffix)",
      detail: "Check if has suffix",
      template: (expr) => `strings.HasSuffix(${expr}, "suffix")`,
    },
    {
      suffix: "Trim",
      description: "strings.Trim(expr, cutset)",
      detail: "Trim characters",
      template: (expr) => `strings.Trim(${expr}, " ")`,
    },
    {
      suffix: "Replace",
      description: "strings.Replace(expr, old, new, n)",
      detail: "Replace substring",
      template: (expr) => `strings.Replace(${expr}, "old", "new", -1)`,
    },
  ];

  private getConfig() {
    const config = vscode.workspace.getConfiguration(
      "goAssistant.postfixCompletion",
    );
    return {
      enable: config.get<boolean>("enable", true),
    };
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const config = this.getConfig();
    if (!config.enable || document.languageId !== "go") {
      return undefined;
    }

    // Get the line up to the cursor
    const linePrefix = document
      .lineAt(position)
      .text.substring(0, position.character);

    // Check if we're after a dot
    const dotMatch = linePrefix.match(/(\w+|\))\.(\w*)$/);
    if (!dotMatch) {
      return undefined;
    }

    const [, expr, suffix] = dotMatch;

    // Get the full expression before the dot
    const fullExpr = this.getFullExpression(document, position, expr);

    // Filter templates that match the suffix
    const matchingTemplates = this.templates.filter((t) =>
      t.suffix.startsWith(suffix),
    );

    if (matchingTemplates.length === 0) {
      return undefined;
    }

    // Create completion items
    return matchingTemplates.map((template) => {
      const item = new vscode.CompletionItem(
        template.suffix,
        vscode.CompletionItemKind.Snippet,
      );

      item.detail = template.detail || template.description;
      item.documentation = new vscode.MarkdownString(
        `**Postfix Completion**\n\n` +
          `Transforms: \`${fullExpr}.${template.suffix}\`\n\n` +
          `Into: \`\`\`go\n${template.description}\n\`\`\``,
      );

      // Create the snippet
      const snippetText = template.template(fullExpr);
      item.insertText = new vscode.SnippetString(snippetText);

      // Replace from the beginning of the expression to the cursor
      const exprStart = position.character - expr.length - 1 - suffix.length;
      item.range = new vscode.Range(
        position.line,
        exprStart,
        position.line,
        position.character,
      );

      item.sortText = `0_${template.suffix}`;
      item.filterText = `${expr}.${template.suffix}`;

      return item;
    });
  }

  private getFullExpression(
    document: vscode.TextDocument,
    position: vscode.Position,
    lastPart: string,
  ): string {
    // For now, just return the last part
    // TODO: Could be enhanced to get the full expression including chains
    return lastPart;
  }
}
