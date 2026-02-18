import * as vscode from "vscode";

export class GoInlineValuesProvider implements vscode.InlineValuesProvider {
  provideInlineValues(
    document: vscode.TextDocument,
    viewPort: vscode.Range,
    context: vscode.InlineValueContext,
  ): vscode.ProviderResult<vscode.InlineValue[]> {
    const config = vscode.workspace.getConfiguration("goHelper.debugging");
    if (!config.get<boolean>("inlineValues", true)) {
      return [];
    }

    const inlineValues: vscode.InlineValue[] = [];

    // Only provide inline values when stopped at a breakpoint
    if (!context.stoppedLocation) {
      return inlineValues;
    }

    const stoppedLine = context.stoppedLocation.start.line;

    // Provide inline values for variables in the current viewport
    for (let line = viewPort.start.line; line <= viewPort.end.line; line++) {
      const lineText = document.lineAt(line).text;

      // Skip if this is the line where execution is stopped
      if (line === stoppedLine) {
        continue;
      }

      // Find variable declarations and usages
      // Pattern: varName := value or var varName = value
      const varDeclMatches = [
        ...lineText.matchAll(/\b(\w+)\s*:=\s*([^\/\n]+)/g),
        ...lineText.matchAll(/var\s+(\w+)\s*=\s*([^\/\n]+)/g),
      ];

      for (const match of varDeclMatches) {
        const varName = match[1];
        const range = new vscode.Range(
          line,
          match.index!,
          line,
          match.index! + varName.length,
        );

        // Use evaluatable expression to show the variable value
        inlineValues.push(
          new vscode.InlineValueEvaluatableExpression(range, varName),
        );
      }

      // Find variable usages (simple identifier)
      const usageMatches = lineText.matchAll(/\b([a-z]\w*)\b/g);
      for (const match of usageMatches) {
        const varName = match[1];

        // Skip keywords and common function names
        const skipWords = [
          "if",
          "else",
          "for",
          "range",
          "func",
          "return",
          "var",
          "const",
          "type",
          "struct",
          "interface",
          "package",
          "import",
          "defer",
          "go",
          "chan",
          "select",
          "case",
          "default",
          "break",
          "continue",
          "true",
          "false",
          "nil",
          "make",
          "new",
          "len",
          "cap",
          "append",
          "copy",
          "delete",
          "panic",
          "recover",
          "print",
          "println",
        ];

        if (!skipWords.includes(varName)) {
          const startPos = match.index || 0;
          const range = new vscode.Range(
            line,
            startPos,
            line,
            startPos + varName.length,
          );

          // Show variable value during debugging
          inlineValues.push(
            new vscode.InlineValueVariableLookup(range, varName, false),
          );
        }
      }
    }

    return inlineValues;
  }
}
