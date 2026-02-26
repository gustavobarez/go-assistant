import * as vscode from "vscode";

export class GoInlineValuesProvider implements vscode.InlineValuesProvider {
  provideInlineValues(
    document: vscode.TextDocument,
    viewPort: vscode.Range,
    context: vscode.InlineValueContext,
  ): vscode.ProviderResult<vscode.InlineValue[]> {
    const config = vscode.workspace.getConfiguration("goAssistant.debugging");
    if (!config.get<boolean>("inlineValues", true)) {
      return [];
    }

    const inlineValues: vscode.InlineValue[] = [];

    // Only provide inline values when stopped at a breakpoint
    if (!context.stoppedLocation) {
      return inlineValues;
    }

    const stoppedLine = context.stoppedLocation.start.line;

    for (let line = viewPort.start.line; line <= viewPort.end.line; line++) {
      if (line === stoppedLine) continue;

      const lineText = document.lineAt(line).text;
      const trimmed = lineText.trim();

      // Skip for-range loops — the iteration variable is usually a struct and
      // delve would render its full type path, making the display very noisy.
      if (/\bfor\b.*\brange\b/.test(trimmed)) continue;

      // Collect variable names from short declarations and var statements.
      const declRegex = /(?:^|\bis\s*)(?:var\s+(\w+)|([\w,\s]+)\s*:=)/g;
      const shortDecls = [
        ...lineText.matchAll(/(?:^|[^:])\b(\w+)(?:\s*,\s*(\w+))*\s*:=/g),
      ];
      const varDecls = [...lineText.matchAll(/\bvar\s+(\w+)\b/g)];

      // Determine the right-hand side of the declaration to skip struct/composite
      // literals and pointer-to-struct constructions like &Foo{ or []T{.
      // These produce very long strings in the debugger output.
      const rhsOfDecl = ((): string => {
        const assignIdx = lineText.indexOf(":=");
        if (assignIdx !== -1) return lineText.slice(assignIdx + 2).trimStart();
        const varAssignIdx = lineText.indexOf("=");
        if (varAssignIdx !== -1)
          return lineText.slice(varAssignIdx + 1).trimStart();
        return "";
      })();

      // Skip if RHS looks like a composite/struct literal or for-range.
      const isVerboseRhs =
        /^&?[A-Za-z_]\w*\s*\{/.test(rhsOfDecl) || // &Struct{ or Struct{
        /^\[\]/.test(rhsOfDecl) || // slice literal
        /^map\[/.test(rhsOfDecl); // map literal
      if (isVerboseRhs) continue;

      for (const match of [...shortDecls, ...varDecls]) {
        // In short decls group 1 is the name; in var decls group 1 also.
        const candidates = [match[1], match[2]].filter(
          (n): n is string => !!n && /^[a-zA-Z_]\w*$/.test(n),
        );
        for (const varName of candidates) {
          if (varName === "_") continue;
          const nameStart = lineText.indexOf(varName, match.index ?? 0);
          if (nameStart === -1) continue;
          inlineValues.push(
            new vscode.InlineValueVariableLookup(
              new vscode.Range(
                line,
                nameStart,
                line,
                nameStart + varName.length,
              ),
              varName,
              false,
            ),
          );
        }
      }
    }

    return inlineValues;
  }
}
