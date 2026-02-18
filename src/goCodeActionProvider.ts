import * as vscode from "vscode";

export class GoCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Refactor,
    vscode.CodeActionKind.RefactorExtract,
    vscode.CodeActionKind.RefactorInline,
    vscode.CodeActionKind.Source,
    vscode.CodeActionKind.SourceOrganizeImports,
  ];

  private getConfig() {
    const config = vscode.workspace.getConfiguration("goHelper.codeActions");
    return {
      enable: config.get<boolean>("enable", true),
      handleError: config.get<boolean>("handleError", true),
      extractVariable: config.get<boolean>("extractVariable", true),
      showReferences: config.get<boolean>("showReferences", true),
      showImplementations: config.get<boolean>("showImplementations", true),
    };
  }

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeAction[] | undefined> {
    const config = this.getConfig();
    if (!config.enable || document.languageId !== "go") {
      return undefined;
    }

    const actions: vscode.CodeAction[] = [];

    // Get selected text or word at cursor
    const selectedText = document.getText(range);
    const wordRange = document.getWordRangeAtPosition(range.start);

    // Handle error actions - check line text if no selection
    const lineText = document.lineAt(range.start.line).text;
    if (
      config.handleError &&
      (selectedText.includes("err") || lineText.includes("err"))
    ) {
      actions.push(
        ...this.createHandleErrorActions(document, range, selectedText),
      );
    }

    // Extract variable
    if (config.extractVariable && selectedText && !range.isEmpty) {
      actions.push(
        ...this.createExtractVariableActions(document, range, selectedText),
      );
    }

    // Show references
    if (config.showReferences && wordRange) {
      actions.push(this.createShowReferencesAction(document, wordRange));
    }

    // Show implementations/implementers
    if (config.showImplementations && wordRange) {
      const implActions = await this.createImplementationActions(
        document,
        wordRange,
      );
      actions.push(...implActions);
    }

    // Variable declaration conversions
    actions.push(
      ...this.createVarDeclarationActions(document, range, selectedText),
    );

    // Anonymous function conversions
    actions.push(...this.createAnonymousFuncActions(document, range));

    // Unwrap else
    actions.push(...this.createUnwrapElseActions(document, range));

    // Generate getter/setter actions
    const getterSetterActions = await this.createGetterSetterActions(
      document,
      wordRange || range,
    );
    actions.push(...getterSetterActions);

    // Add missing return statement
    actions.push(...this.createAddReturnActions(document, range));

    // Inline variable actions
    actions.push(
      ...this.createInlineVariableActions(document, range, selectedText),
    );

    // Change signature actions (parameter manipulation)
    const signatureActions = await this.createChangeSignatureActions(
      document,
      range,
    );
    actions.push(...signatureActions);

    // Field split actions
    actions.push(...this.createSplitFieldActions(document, range));

    // Interface/Struct/Method movement and generation actions
    const symbolActions = await this.createSymbolManipulationActions(
      document,
      range,
    );
    actions.push(...symbolActions);

    // Tag management actions
    const tagActions = await this.createTagManagementActions(document, range);
    actions.push(...tagActions);

    // Show type methods
    const typeMethodsActions = await this.createShowTypeMethodsActions(
      document,
      wordRange || range,
    );
    actions.push(...typeMethodsActions);

    // Show package imports
    actions.push(...this.createShowPackageImportsActions(document, range));

    // Remove redundant parentheses
    actions.push(
      ...this.createRemoveParenthesesActions(document, range, selectedText),
    );

    // Add channel receive result
    actions.push(
      ...this.createChannelReceiveActions(document, range, selectedText),
    );

    // Convert defer to multiline
    actions.push(
      ...this.createDeferToMultilineActions(document, range, selectedText),
    );

    // Convert assignment to short var decl
    actions.push(
      ...this.createAssignmentToShortVarActions(document, range, selectedText),
    );

    // Extract embedded type
    const extractEmbeddedActions = await this.createExtractEmbeddedTypeActions(
      document,
      wordRange || range,
    );
    actions.push(...extractEmbeddedActions);

    // Inline embedded struct/interface
    const inlineEmbeddedActions = await this.createInlineEmbeddedActions(
      document,
      wordRange || range,
    );
    actions.push(...inlineEmbeddedActions);

    // Synchronize receiver names
    const syncReceiverActions =
      await this.createSyncReceiverNamesActions(document);
    actions.push(...syncReceiverActions);

    // Run/debug main method
    actions.push(...this.createRunDebugMainActions(document, range));

    // Run/debug test method
    actions.push(...this.createRunDebugTestActions(document, range));

    return actions.length > 0 ? actions : undefined;
  }

  private isBinaryOperation(text: string): boolean {
    // Check if text contains binary operators
    return (
      /[+\-*/%&|^<>=!]+/.test(text) &&
      text.split(/[+\-*/%&|^<>=!]+/).length === 2
    );
  }

  private createFlipBinaryOperationActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Match binary operations like: a + b, x == y, etc.
    const binaryOpMatch = text.match(
      /^(.+?)\s*([+\-*/%&|^]|[<>=!]=?|&&|\|\|)\s*(.+)$/,
    );

    if (binaryOpMatch) {
      const leftOperand = binaryOpMatch[1].trim();
      const operator = binaryOpMatch[2].trim();
      const rightOperand = binaryOpMatch[3].trim();

      // For comparison operators, flip the operator too
      const flippedOp = this.flipOperator(operator);

      const flipAction = new vscode.CodeAction(
        `Flip to: ${rightOperand} ${flippedOp} ${leftOperand}`,
        vscode.CodeActionKind.Refactor,
      );
      flipAction.edit = new vscode.WorkspaceEdit();
      flipAction.edit.replace(
        document.uri,
        range,
        `${rightOperand} ${flippedOp} ${leftOperand}`,
      );
      actions.push(flipAction);
    }

    return actions;
  }

  private flipOperator(op: string): string {
    const flipMap: { [key: string]: string } = {
      "<": ">",
      ">": "<",
      "<=": ">=",
      ">=": "<=",
      "==": "==",
      "!=": "!=",
    };
    return flipMap[op] || op;
  }

  private createMergeStringActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    try {
      const line = document.lineAt(range.start.line);
      const text = line.text;

      // Match adjacent string literals: "abc" + "def"
      const mergeMatch = text.match(/"([^"]*)"\s*\+\s*"([^"]*)"/);

      if (mergeMatch) {
        const mergeAction = new vscode.CodeAction(
          "Merge string literals",
          vscode.CodeActionKind.Refactor,
        );

        const merged = `"${mergeMatch[1]}${mergeMatch[2]}"`;
        const startPos = text.indexOf(mergeMatch[0]);
        const replaceRange = new vscode.Range(
          range.start.line,
          startPos,
          range.start.line,
          startPos + mergeMatch[0].length,
        );

        mergeAction.edit = new vscode.WorkspaceEdit();
        mergeAction.edit.replace(document.uri, replaceRange, merged);
        actions.push(mergeAction);
      }
    } catch (error) {
      // Ignore errors
    }

    return actions;
  }

  private createHandleErrorActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Check if we're on an error assignment (works even if cursor is just on the line)
    const line = document.lineAt(range.start.line).text;
    const isErrorAssignment = /\berr\s*:?=/.test(line);

    if (isErrorAssignment) {
      // Check if error is already handled in the next few lines
      let alreadyHandled = false;
      const maxLinesToCheck = 3;
      for (
        let i = 1;
        i <= maxLinesToCheck && range.end.line + i < document.lineCount;
        i++
      ) {
        const nextLine = document.lineAt(range.end.line + i).text;
        if (/if\s+err\s*!=\s*nil/.test(nextLine)) {
          alreadyHandled = true;
          break;
        }
      }

      if (alreadyHandled) {
        return actions;
      }

      // Check function return type to see if it returns error
      const functionInfo = this.findEnclosingFunction(
        document,
        range.start.line,
      );
      const returnsError = functionInfo
        ? this.functionReturnsError(document, functionInfo)
        : true;
      const nextLine = range.end.line + 1;

      // Offer return error if function actually returns error
      if (returnsError) {
        // Handle error with return
        const returnAction = new vscode.CodeAction(
          "Handle error: return err",
          vscode.CodeActionKind.QuickFix,
        );
        returnAction.edit = new vscode.WorkspaceEdit();
        returnAction.edit.insert(
          document.uri,
          new vscode.Position(nextLine, 0),
          `\tif err != nil {\n\t\treturn err\n\t}\n`,
        );
        actions.push(returnAction);

        // Handle error with wrapped error
        const wrapAction = new vscode.CodeAction(
          "Handle error: return wrapped",
          vscode.CodeActionKind.QuickFix,
        );
        wrapAction.edit = new vscode.WorkspaceEdit();
        wrapAction.edit.insert(
          document.uri,
          new vscode.Position(nextLine, 0),
          `\tif err != nil {\n\t\treturn fmt.Errorf("failed: %w", err)\n\t}\n`,
        );
        actions.push(wrapAction);

        // Handle error with log
        const logAction = new vscode.CodeAction(
          "Handle error: log and return",
          vscode.CodeActionKind.QuickFix,
        );
        logAction.edit = new vscode.WorkspaceEdit();
        logAction.edit.insert(
          document.uri,
          new vscode.Position(nextLine, 0),
          `\tif err != nil {\n\t\tlog.Printf("error: %v", err)\n\t\treturn err\n\t}\n`,
        );
        actions.push(logAction);
      } else {
        // For functions without error return, offer simple return
        const simpleReturnAction = new vscode.CodeAction(
          "Handle error: return",
          vscode.CodeActionKind.QuickFix,
        );
        simpleReturnAction.edit = new vscode.WorkspaceEdit();
        simpleReturnAction.edit.insert(
          document.uri,
          new vscode.Position(nextLine, 0),
          `\tif err != nil {\n\t\treturn\n\t}\n`,
        );
        actions.push(simpleReturnAction);
      }

      // Handle error with panic (always available)
      const panicAction = new vscode.CodeAction(
        "Handle error: panic",
        vscode.CodeActionKind.QuickFix,
      );
      panicAction.edit = new vscode.WorkspaceEdit();
      panicAction.edit.insert(
        document.uri,
        new vscode.Position(nextLine, 0),
        `\tif err != nil {\n\t\tpanic(err)\n\t}\n`,
      );
      actions.push(panicAction);
    }

    return actions;
  }

  private findEnclosingFunction(
    document: vscode.TextDocument,
    lineNumber: number,
  ): { startLine: number; endLine: number; signature: string } | null {
    // Look backwards for function declaration
    for (let i = lineNumber; i >= Math.max(0, lineNumber - 100); i--) {
      const line = document.lineAt(i).text;
      if (/^func\s+/.test(line)) {
        // Find the end of this function
        let braceCount = 0;
        let foundStart = false;
        for (let j = i; j < document.lineCount; j++) {
          const funcLine = document.lineAt(j).text;
          for (const char of funcLine) {
            if (char === "{") {
              braceCount++;
              foundStart = true;
            } else if (char === "}") {
              braceCount--;
              if (foundStart && braceCount === 0) {
                return { startLine: i, endLine: j, signature: line };
              }
            }
          }
        }
      }
    }
    return null;
  }

  private functionReturnsError(
    document: vscode.TextDocument,
    functionInfo: { startLine: number; endLine: number; signature: string },
  ): boolean {
    const signature = functionInfo.signature;
    // Check if function signature contains 'error' in return types
    // Examples: func foo() error, func bar() (int, error), func baz() (result Result, err error)
    const returnMatch = signature.match(/\)\s*(.+?)\s*\{/);
    if (returnMatch) {
      const returnPart = returnMatch[1];
      return /\berror\b/.test(returnPart);
    }
    return false;
  }

  private createExtractVariableActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Extract to variable with :=
    const extractAction = new vscode.CodeAction(
      "Extract to variable",
      vscode.CodeActionKind.RefactorExtract,
    );
    extractAction.edit = new vscode.WorkspaceEdit();

    // Insert variable declaration before the line
    const lineStart = new vscode.Position(range.start.line, 0);
    const indent =
      document.lineAt(range.start.line).text.match(/^\s*/)?.[0] || "";
    extractAction.edit.insert(
      document.uri,
      lineStart,
      `${indent}name := ${text}\n`,
    );

    // Replace selected text with variable name
    extractAction.edit.replace(document.uri, range, "name");

    actions.push(extractAction);

    return actions;
  }

  private createShowReferencesAction(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      "Show references",
      vscode.CodeActionKind.Source,
    );

    action.command = {
      command: "editor.action.goToReferences",
      title: "Show References",
      arguments: [document.uri, range.start],
    };

    return action;
  }

  private async createImplementationActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    try {
      // Get symbol info at cursor position
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return actions;
      }

      // Find the symbol at the cursor position
      const symbol = this.findSymbolAtPosition(symbols, range.start);

      if (!symbol) {
        return actions;
      }

      // Show implementations for interfaces
      if (symbol.kind === vscode.SymbolKind.Interface) {
        const implementationAction = new vscode.CodeAction(
          "Show implementers",
          vscode.CodeActionKind.Source,
        );

        implementationAction.command = {
          command: "editor.action.goToImplementation",
          title: "Show Implementers",
          arguments: [document.uri, range.start],
        };

        actions.push(implementationAction);
      }

      // Show implemented interfaces for structs/types
      if (
        symbol.kind === vscode.SymbolKind.Struct ||
        symbol.kind === vscode.SymbolKind.Class
      ) {
        const typeDefAction = new vscode.CodeAction(
          "Show implemented interfaces",
          vscode.CodeActionKind.Source,
        );

        typeDefAction.command = {
          command: "editor.action.goToTypeDefinition",
          title: "Show Implemented Interfaces",
          arguments: [document.uri, range.start],
        };

        actions.push(typeDefAction);
      }

      // Show references for methods
      if (symbol.kind === vscode.SymbolKind.Method) {
        const methodRefsAction = new vscode.CodeAction(
          "Show method references",
          vscode.CodeActionKind.Source,
        );

        methodRefsAction.command = {
          command: "editor.action.goToReferences",
          title: "Show Method References",
          arguments: [document.uri, range.start],
        };

        actions.push(methodRefsAction);
      }
    } catch (error) {
      console.error("Error creating implementation actions:", error);
    }

    return actions;
  }

  private findSymbolAtPosition(
    symbols: vscode.DocumentSymbol[],
    position: vscode.Position,
  ): vscode.DocumentSymbol | undefined {
    for (const symbol of symbols) {
      if (symbol.range.contains(position)) {
        // Check children first
        if (symbol.children && symbol.children.length > 0) {
          const childSymbol = this.findSymbolAtPosition(
            symbol.children,
            position,
          );
          if (childSymbol) {
            return childSymbol;
          }
        }

        // Return this symbol if selection range contains position
        if (symbol.selectionRange.contains(position)) {
          return symbol;
        }
      }
    }
    return undefined;
  }

  private createVarDeclarationActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Convert var x = y to x := y
    const varMatch = line.match(/var\s+(\w+)\s*=\s*(.+)/);
    if (varMatch) {
      const varName = varMatch[1];
      const value = varMatch[2];

      const convertAction = new vscode.CodeAction(
        "Convert to short var declaration",
        vscode.CodeActionKind.Refactor,
      );
      convertAction.edit = new vscode.WorkspaceEdit();
      const newLine = line.replace(/var\s+(\w+)\s*=\s*/, `${varName} := `);
      convertAction.edit.replace(
        document.uri,
        new vscode.Range(range.start.line, 0, range.start.line, line.length),
        newLine,
      );
      actions.push(convertAction);
    }

    // Convert x := y to var x = y
    const shortVarMatch = line.match(/(\w+)\s*:=\s*(.+)/);
    if (shortVarMatch && !line.includes("for") && !line.includes("if")) {
      const varName = shortVarMatch[1];

      const convertAction = new vscode.CodeAction(
        "Convert to var declaration",
        vscode.CodeActionKind.Refactor,
      );
      convertAction.edit = new vscode.WorkspaceEdit();
      const newLine = line.replace(/(\w+)\s*:=\s*/, `var ${varName} = `);
      convertAction.edit.replace(
        document.uri,
        new vscode.Range(range.start.line, 0, range.start.line, line.length),
        newLine,
      );
      actions.push(convertAction);
    }

    return actions;
  }

  private createImportManagementActions(
    document: vscode.TextDocument,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const text = document.getText();

    // Sort imports
    const sortImportsAction = new vscode.CodeAction(
      "Sort imports",
      vscode.CodeActionKind.SourceOrganizeImports,
    );
    sortImportsAction.command = {
      command: "go.tools.sortImports",
      title: "Sort Imports",
    };
    actions.push(sortImportsAction);

    // Cleanup imports (gopls organize)
    const cleanupAction = new vscode.CodeAction(
      "Cleanup imports (remove unused + sort)",
      vscode.CodeActionKind.SourceOrganizeImports,
    );
    cleanupAction.command = {
      command: "go.import.add",
      title: "Organize Imports",
    };
    actions.push(cleanupAction);

    // Detect and handle import blocks
    const importBlockRegex = /import\s+\([\s\S]*?\)/g;
    const importBlocks = text.match(importBlockRegex);

    // Merge multiple import blocks
    if (importBlocks && importBlocks.length > 1) {
      const mergeAction = new vscode.CodeAction(
        "Merge import blocks",
        vscode.CodeActionKind.SourceOrganizeImports,
      );
      mergeAction.edit = new vscode.WorkspaceEdit();

      // Collect all imports
      const allImports = new Set<string>();
      importBlocks.forEach((block) => {
        const imports = block.match(/"[^"]+"/g) || [];
        imports.forEach((imp) => allImports.add(imp));
      });

      // Create merged block
      const mergedImports = Array.from(allImports).sort().join("\n\t");
      const newBlock = `import (\n\t${mergedImports}\n)`;

      // Replace first block, remove others
      const firstBlockIndex = text.indexOf(importBlocks[0]);
      const firstBlockEnd = firstBlockIndex + importBlocks[0].length;
      mergeAction.edit.replace(
        document.uri,
        new vscode.Range(
          document.positionAt(firstBlockIndex),
          document.positionAt(firstBlockEnd),
        ),
        newBlock,
      );

      // Remove other blocks
      for (let i = 1; i < importBlocks.length; i++) {
        const blockIndex = text.indexOf(importBlocks[i]);
        const blockEnd = blockIndex + importBlocks[i].length;
        mergeAction.edit.delete(
          document.uri,
          new vscode.Range(
            document.positionAt(blockIndex),
            document.positionAt(blockEnd + 1), // +1 for newline
          ),
        );
      }

      actions.push(mergeAction);
    }

    // Detect dot imports and offer to rewrite
    const dotImportRegex = /import\s+\.\s+"([^"]+)"/g;
    let dotImportMatch;
    while ((dotImportMatch = dotImportRegex.exec(text)) !== null) {
      const pkgPath = dotImportMatch[1];
      const pkgName = pkgPath.split("/").pop() || pkgPath;

      const rewriteAction = new vscode.CodeAction(
        `Rewrite dot import "${pkgPath}"`,
        vscode.CodeActionKind.QuickFix,
      );

      const startPos = document.positionAt(dotImportMatch.index);
      const endPos = document.positionAt(
        dotImportMatch.index + dotImportMatch[0].length,
      );

      rewriteAction.edit = new vscode.WorkspaceEdit();
      rewriteAction.edit.replace(
        document.uri,
        new vscode.Range(startPos, endPos),
        `import "${pkgPath}"`,
      );

      actions.push(rewriteAction);
    }

    // Detect broken imports (imports with syntax errors or missing closing quote)
    const brokenImportRegex = /import\s+.*?"([^"]*?)$/gm;
    let brokenMatch;
    const brokenImports: Array<{ start: number; end: number; line: string }> =
      [];

    while ((brokenMatch = brokenImportRegex.exec(text)) !== null) {
      const lineStart = text.lastIndexOf("\n", brokenMatch.index) + 1;
      const lineEnd = text.indexOf("\n", brokenMatch.index);
      if (lineEnd !== -1) {
        brokenImports.push({
          start: lineStart,
          end: lineEnd,
          line: text.substring(lineStart, lineEnd),
        });
      }
    }

    if (brokenImports.length > 0) {
      // Remove all broken imports
      const removeAllBrokenAction = new vscode.CodeAction(
        `Remove ${brokenImports.length} broken import(s)`,
        vscode.CodeActionKind.QuickFix,
      );
      removeAllBrokenAction.edit = new vscode.WorkspaceEdit();

      for (const brokenImport of brokenImports) {
        removeAllBrokenAction.edit.delete(
          document.uri,
          new vscode.Range(
            document.positionAt(brokenImport.start),
            document.positionAt(brokenImport.end + 1),
          ),
        );
      }

      actions.push(removeAllBrokenAction);

      // Individual broken import removal
      for (const brokenImport of brokenImports) {
        const removeAction = new vscode.CodeAction(
          `Remove broken import: ${brokenImport.line.trim()}`,
          vscode.CodeActionKind.QuickFix,
        );
        removeAction.edit = new vscode.WorkspaceEdit();
        removeAction.edit.delete(
          document.uri,
          new vscode.Range(
            document.positionAt(brokenImport.start),
            document.positionAt(brokenImport.end + 1),
          ),
        );
        actions.push(removeAction);
      }
    }

    // Check for unused imports using diagnostics
    const unusedImports = this.detectUnusedImports(document);
    if (unusedImports.length > 0) {
      // Remove all unused imports
      const removeAllAction = new vscode.CodeAction(
        `Remove ${unusedImports.length} unused import(s)`,
        vscode.CodeActionKind.QuickFix,
      );
      removeAllAction.edit = new vscode.WorkspaceEdit();

      for (const unusedImport of unusedImports) {
        removeAllAction.edit.delete(document.uri, unusedImport.range);
      }

      actions.push(removeAllAction);

      // Individual unused import removal
      for (const unusedImport of unusedImports) {
        const removeAction = new vscode.CodeAction(
          `Remove unused import "${unusedImport.path}"`,
          vscode.CodeActionKind.QuickFix,
        );
        removeAction.edit = new vscode.WorkspaceEdit();
        removeAction.edit.delete(document.uri, unusedImport.range);
        actions.push(removeAction);
      }
    }

    return actions;
  }

  private detectUnusedImports(
    document: vscode.TextDocument,
  ): Array<{ path: string; range: vscode.Range }> {
    const text = document.getText();
    const unusedImports: Array<{ path: string; range: vscode.Range }> = [];

    // Find all imports
    const importBlockMatch = text.match(/import\s+\(([\s\S]*?)\)/);
    if (!importBlockMatch) {
      return unusedImports;
    }

    const importsText = importBlockMatch[1];
    const importLines = importsText.split("\n");
    const importBlockStart = text.indexOf(importBlockMatch[0]);
    let currentPos = importBlockStart + "import (".length;

    for (const line of importLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) {
        currentPos += line.length + 1;
        continue;
      }

      // Match: alias "path" or just "path"
      const importMatch = trimmed.match(/(?:(\w+)\s+)?"([^"]+)"/);
      if (importMatch) {
        const alias = importMatch[1];
        const pkgPath = importMatch[2];
        const pkgName = alias || pkgPath.split("/").pop() || pkgPath;

        // Check if package is used in code (outside import block)
        const codeAfterImports = text.substring(
          text.indexOf(")", importBlockStart) + 1,
        );
        const isUsed = new RegExp(`\\b${pkgName}\\.`).test(codeAfterImports);

        if (!isUsed) {
          const lineStart = currentPos;
          const lineEnd = currentPos + line.length;
          unusedImports.push({
            path: pkgPath,
            range: new vscode.Range(
              document.positionAt(lineStart),
              document.positionAt(lineEnd + 1),
            ),
          });
        }
      }

      currentPos += line.length + 1;
    }

    return unusedImports;
  }

  private createInterfaceToAnyActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Convert interface{} to any
    if (text.includes("interface{}")) {
      const convertAction = new vscode.CodeAction(
        "Convert interface{} to any",
        vscode.CodeActionKind.Refactor,
      );
      convertAction.edit = new vscode.WorkspaceEdit();
      const newText = text.replace(/interface\{\}/g, "any");
      convertAction.edit.replace(document.uri, range, newText);
      actions.push(convertAction);
    }

    // Convert any to interface{} (reverse)
    if (text.includes("any") && !text.includes("any(")) {
      const convertAction = new vscode.CodeAction(
        "Convert any to interface{}",
        vscode.CodeActionKind.Refactor,
      );
      convertAction.edit = new vscode.WorkspaceEdit();
      const newText = text.replace(/\bany\b/g, "interface{}");
      convertAction.edit.replace(document.uri, range, newText);
      actions.push(convertAction);
    }

    return actions;
  }

  private createIterateActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // If we have a variable name, generate for loop
    const wordMatch = text.match(/^\w+$/);
    if (wordMatch) {
      const varName = wordMatch[0];

      // For range loop
      const forRangeAction = new vscode.CodeAction(
        `Iterate over ${varName} with range`,
        vscode.CodeActionKind.Refactor,
      );
      forRangeAction.edit = new vscode.WorkspaceEdit();
      const indent =
        document.lineAt(range.start.line).text.match(/^\s*/)?.[0] || "";
      const forLoop = `for i, v := range ${varName} {\n${indent}\t\n${indent}}`;
      forRangeAction.edit.replace(document.uri, range, forLoop);
      actions.push(forRangeAction);

      // For loop with index
      const forIndexAction = new vscode.CodeAction(
        `Iterate over ${varName} with index`,
        vscode.CodeActionKind.Refactor,
      );
      forIndexAction.edit = new vscode.WorkspaceEdit();
      const forIndexLoop = `for i := 0; i < len(${varName}); i++ {\n${indent}\t\n${indent}}`;
      forIndexAction.edit.replace(document.uri, range, forIndexLoop);
      actions.push(forIndexAction);
    }

    return actions;
  }

  private createAnonymousFuncActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    try {
      const line = document.lineAt(range.start.line).text;

      // Convert single-line anonymous func to multiline
      if (line.match(/func\([^)]*\)\s*\{[^}]+\}\s*\(/)) {
        const convertAction = new vscode.CodeAction(
          "Convert to multiline anonymous function",
          vscode.CodeActionKind.Refactor,
        );
        // This would need more complex parsing
        convertAction.disabled = {
          reason: "Complex parsing required - use gofmt instead",
        };
        actions.push(convertAction);
      }
    } catch (error) {
      // Ignore
    }

    return actions;
  }

  private createUnwrapElseActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    try {
      const line = document.lineAt(range.start.line).text;

      // Detect if else pattern and offer to unwrap
      if (line.includes("if") && line.includes("{")) {
        // Look ahead for else block
        let hasElse = false;
        for (
          let i = range.start.line + 1;
          i < Math.min(range.start.line + 50, document.lineCount);
          i++
        ) {
          const nextLine = document.lineAt(i).text;
          if (nextLine.includes("} else")) {
            hasElse = true;
            break;
          }
          if (nextLine.includes("func ")) {
            break;
          }
        }

        if (hasElse) {
          const unwrapAction = new vscode.CodeAction(
            "Unwrap else (add return in if block)",
            vscode.CodeActionKind.Refactor,
          );
          unwrapAction.disabled = {
            reason: "Requires full AST parsing - use manual refactoring",
          };
          actions.push(unwrapAction);
        }
      }
    } catch (error) {
      // Ignore
    }

    return actions;
  }

  private async createGetterSetterActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    try {
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return actions;
      }

      // Find struct at current position
      const structSymbol = this.findSymbolAtPosition(symbols, range.start);

      if (
        !structSymbol ||
        (structSymbol.kind !== vscode.SymbolKind.Struct &&
          structSymbol.kind !== vscode.SymbolKind.Class)
      ) {
        return actions;
      }

      // Get struct fields
      const fields = (structSymbol.children || []).filter(
        (c) =>
          c.kind === vscode.SymbolKind.Field ||
          c.kind === vscode.SymbolKind.Property,
      );

      if (fields.length === 0) {
        return actions;
      }

      // Generate getter/setter for each field
      for (const field of fields) {
        const fieldText = document.getText(field.range);
        const fieldMatch = fieldText.match(/(\w+)\s+(\w+)/);

        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          const fieldType = fieldMatch[2];
          const capitalizedName =
            fieldName.charAt(0).toUpperCase() + fieldName.slice(1);

          // Getter - use Source category for "more actions"
          const getterAction = new vscode.CodeAction(
            `Generate getter for ${fieldName}`,
            vscode.CodeActionKind.Source.append("generateGetter"),
          );
          getterAction.edit = new vscode.WorkspaceEdit();
          const getter = `\nfunc (s *${structSymbol.name}) Get${capitalizedName}() ${fieldType} {\n\treturn s.${fieldName}\n}\n`;
          getterAction.edit.insert(
            document.uri,
            new vscode.Position(document.lineCount, 0),
            getter,
          );
          actions.push(getterAction);

          // Setter - use Source category for "more actions"
          const setterAction = new vscode.CodeAction(
            `Generate setter for ${fieldName}`,
            vscode.CodeActionKind.Source.append("generateSetter"),
          );
          setterAction.edit = new vscode.WorkspaceEdit();
          const setter = `\nfunc (s *${structSymbol.name}) Set${capitalizedName}(${fieldName} ${fieldType}) {\n\ts.${fieldName} = ${fieldName}\n}\n`;
          setterAction.edit.insert(
            document.uri,
            new vscode.Position(document.lineCount, 0),
            setter,
          );
          actions.push(setterAction);
        }
      }
    } catch (error) {
      console.error("Error creating getter/setter actions:", error);
    }

    return actions;
  }

  private createAddReturnActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    try {
      const line = document.lineAt(range.start.line).text;

      // Check if we're at the end of a function without return
      // Simple heuristic: if line is "}" and previous lines don't have return
      if (line.trim() === "}") {
        const functionStartLine = this.findFunctionStart(
          document,
          range.start.line,
        );

        if (functionStartLine >= 0) {
          const functionText = document.getText(
            new vscode.Range(functionStartLine, 0, range.start.line, 0),
          );

          // Check if function has return type and no return statement
          if (
            /func\s+\w+\([^)]*\)\s+\w+/.test(functionText) &&
            !functionText.includes("return")
          ) {
            const addReturnAction = new vscode.CodeAction(
              "Add return statement",
              vscode.CodeActionKind.QuickFix,
            );
            addReturnAction.edit = new vscode.WorkspaceEdit();
            const indent =
              document.lineAt(range.start.line - 1).text.match(/^\s*/)?.[0] ||
              "\t";
            addReturnAction.edit.insert(
              document.uri,
              new vscode.Position(range.start.line, 0),
              `${indent}return /* zero value */\n`,
            );
            actions.push(addReturnAction);
          }
        }
      }
    } catch (error) {
      console.error("Error creating add return actions:", error);
    }

    return actions;
  }

  private findFunctionStart(
    document: vscode.TextDocument,
    fromLine: number,
  ): number {
    for (let i = fromLine; i >= 0; i--) {
      const line = document.lineAt(i).text;
      if (line.match(/^\s*func\s+/)) {
        return i;
      }
    }
    return -1;
  }

  private createInlineVariableActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Detect variable declaration: varName := value or var varName = value
    const varDeclMatch =
      line.match(/\b(\w+)\s*:=\s*(.+)/) || line.match(/var\s+(\w+)\s*=\s*(.+)/);

    if (varDeclMatch) {
      const varName = varDeclMatch[1];
      const value = varDeclMatch[2].replace(/;$/, "").trim();

      const inlineAction = new vscode.CodeAction(
        `Inline variable '${varName}'`,
        vscode.CodeActionKind.RefactorInline,
      );

      // Find all usages of the variable and replace with value
      const fullText = document.getText();
      const lines = fullText.split("\n");
      const currentLineNum = range.start.line;

      // Simple heuristic: replace in same function/block
      let replacementCount = 0;
      const regex = new RegExp(`\\b${varName}\\b`, "g");

      for (
        let i = currentLineNum + 1;
        i < lines.length && i < currentLineNum + 50;
        i++
      ) {
        if (regex.test(lines[i])) {
          replacementCount++;
        }
      }

      if (replacementCount > 0) {
        inlineAction.edit = new vscode.WorkspaceEdit();
        // Note: This is a simplified implementation
        // A complete implementation would track all variable usages
        inlineAction.disabled = {
          reason: "Use gopls inline refactoring for better accuracy",
        };
        actions.push(inlineAction);
      }
    }

    return actions;
  }

  private createSplitFieldActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Only work inside structs - check for indentation and context
    const isInsideStruct = this.isLineInsideStruct(document, range.start.line);
    if (!isInsideStruct) {
      return actions;
    }

    // Split field declaration: x, y int -> separate lines
    const multiFieldMatch = line.match(/(\w+)\s*,\s*(\w+)\s+(\w+)/);
    if (multiFieldMatch) {
      const field1 = multiFieldMatch[1];
      const field2 = multiFieldMatch[2];
      const fieldType = multiFieldMatch[3];

      const splitAction = new vscode.CodeAction(
        "Split field declarations",
        vscode.CodeActionKind.Refactor,
      );

      splitAction.edit = new vscode.WorkspaceEdit();
      const indent = line.match(/^\s*/)?.[0] || "";
      const split = `${indent}${field1} ${fieldType}\n${indent}${field2} ${fieldType}`;

      const lineRange = document.lineAt(range.start.line).range;
      splitAction.edit.replace(document.uri, lineRange, split);
      actions.push(splitAction);
    }

    return actions;
  }

  private isLineInsideStruct(
    document: vscode.TextDocument,
    lineNumber: number,
  ): boolean {
    // Look backwards for 'type ... struct {' and check if we're before the closing '}'
    let foundStructStart = false;
    let braceCount = 0;

    for (let i = lineNumber; i >= 0; i--) {
      const line = document.lineAt(i).text;

      // Count braces
      for (const char of line) {
        if (char === "{") {
          braceCount++;
        } else if (char === "}") {
          braceCount--;
        }
      }

      // Check if this line has a struct declaration
      if (/type\s+\w+\s+struct\s*\{/.test(line)) {
        foundStructStart = true;
        break;
      }

      // If we hit a closing brace before finding struct, we're not inside
      if (braceCount < 0) {
        return false;
      }
    }

    // If we found struct start and brace count is positive, we're inside
    return foundStructStart && braceCount > 0;
  }

  private async createTagManagementActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Add json tag to struct field
    const fieldMatch = line.match(/^\s*(\w+)\s+(\w+)\s*$/);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const jsonName = fieldName.toLowerCase();

      const addJsonAction = new vscode.CodeAction(
        `Add json tag to '${fieldName}'`,
        vscode.CodeActionKind.Refactor,
      );

      addJsonAction.edit = new vscode.WorkspaceEdit();
      const lineRange = document.lineAt(range.start.line).range;
      const withTag = line.trimEnd() + ` \`json:"${jsonName}"\``;
      addJsonAction.edit.replace(document.uri, lineRange, withTag);
      actions.push(addJsonAction);
    }

    // Remove all tags from field
    const taggedFieldMatch = line.match(/^\s*\w+\s+\w+\s+`[^`]+`/);
    if (taggedFieldMatch) {
      const removeTagsAction = new vscode.CodeAction(
        "Remove all tags",
        vscode.CodeActionKind.Refactor,
      );

      removeTagsAction.edit = new vscode.WorkspaceEdit();
      const lineRange = document.lineAt(range.start.line).range;
      const withoutTags = line.replace(/`[^`]+`/, "");
      removeTagsAction.edit.replace(
        document.uri,
        lineRange,
        withoutTags.trimEnd(),
      );
      actions.push(removeTagsAction);
    }

    return actions;
  }

  private async createShowTypeMethodsActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    try {
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return actions;
      }

      const symbol = this.findSymbolAtPosition(symbols, range.start);

      if (
        symbol &&
        (symbol.kind === vscode.SymbolKind.Struct ||
          symbol.kind === vscode.SymbolKind.Class ||
          symbol.kind === vscode.SymbolKind.Interface)
      ) {
        // Find all methods for this type
        const methods: vscode.DocumentSymbol[] = [];
        for (const s of symbols) {
          if (s.kind === vscode.SymbolKind.Method) {
            const methodText = document.getText(s.range);
            if (
              methodText.includes(`(${symbol.name})`) ||
              methodText.includes(`(*${symbol.name})`)
            ) {
              methods.push(s);
            }
          }
        }

        if (methods.length > 0) {
          const showMethodsAction = new vscode.CodeAction(
            `Show ${methods.length} method(s) of '${symbol.name}'`,
            vscode.CodeActionKind.Refactor,
          );

          // Collect method locations
          const locations = methods.map(
            (m) => new vscode.Location(document.uri, m.range),
          );

          showMethodsAction.command = {
            command: "go-helper.showReferences",
            title: "Show Methods",
            arguments: [document.uri, range.start, locations],
          };

          actions.push(showMethodsAction);
        }
      }
    } catch (error) {
      console.error("Error creating show type methods actions:", error);
    }

    return actions;
  }

  private createShowPackageImportsActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Check if cursor is on package declaration
    if (line.match(/^package\s+\w+/)) {
      const showImportsAction = new vscode.CodeAction(
        "Show files importing this package",
        vscode.CodeActionKind.Refactor,
      );

      showImportsAction.command = {
        command: "vscode.executeReferenceProvider",
        title: "Show Package Imports",
        arguments: [document.uri, range.start],
      };

      actions.push(showImportsAction);
    }

    return actions;
  }

  private createRemoveParenthesesActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Check for redundant parentheses: (x) where x is a simple identifier
    if (text.match(/^\((\w+)\)$/)) {
      const removeAction = new vscode.CodeAction(
        "Remove redundant parentheses",
        vscode.CodeActionKind.Refactor,
      );

      removeAction.edit = new vscode.WorkspaceEdit();
      const inner = text.slice(1, -1);
      removeAction.edit.replace(document.uri, range, inner);
      actions.push(removeAction);
    }

    // Check for redundant parentheses in expressions
    const redundantMatch = text.match(/^\(([^()]+)\)$/);
    if (redundantMatch && !text.includes("(") && !text.includes(")")) {
      const removeAction = new vscode.CodeAction(
        "Remove redundant parentheses",
        vscode.CodeActionKind.Refactor,
      );

      removeAction.edit = new vscode.WorkspaceEdit();
      removeAction.edit.replace(document.uri, range, redundantMatch[1]);
      actions.push(removeAction);
    }

    return actions;
  }

  private createChannelReceiveActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Check for <-channel pattern
    if (line.match(/<-\s*\w+/) && !line.includes("=")) {
      const addAssignmentAction = new vscode.CodeAction(
        "Add channel receive result to assignment",
        vscode.CodeActionKind.Refactor,
      );

      addAssignmentAction.edit = new vscode.WorkspaceEdit();
      const lineRange = document.lineAt(range.start.line).range;
      const newLine = line.replace(/(<-\s*\w+)/, "value := $1");
      addAssignmentAction.edit.replace(document.uri, lineRange, newLine);
      actions.push(addAssignmentAction);
    }

    return actions;
  }

  private createDeferToMultilineActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Check for defer with function call
    const deferMatch = line.match(/defer\s+(\w+)\(([^)]*)\)/);
    if (deferMatch) {
      const convertAction = new vscode.CodeAction(
        "Convert defer to multiline (via closure)",
        vscode.CodeActionKind.Refactor,
      );

      const funcName = deferMatch[1];
      const args = deferMatch[2];

      convertAction.edit = new vscode.WorkspaceEdit();
      const lineRange = document.lineAt(range.start.line).range;
      const indent = line.match(/^\s*/)?.[0] || "";
      const multiline = `${indent}defer func() {\n${indent}\t${funcName}(${args})\n${indent}}()`;

      convertAction.edit.replace(document.uri, lineRange, multiline);
      actions.push(convertAction);
    }

    return actions;
  }

  private createAssignmentToShortVarActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Check for assignment to unresolved variable: varName = value
    // This should be converted to: varName := value
    const assignMatch = line.match(/^\s*(\w+)\s*=\s*(.+)$/);
    if (assignMatch && !line.includes(":=")) {
      const varName = assignMatch[1];

      const convertAction = new vscode.CodeAction(
        `Convert assignment to short var declaration`,
        vscode.CodeActionKind.Refactor,
      );

      convertAction.edit = new vscode.WorkspaceEdit();
      const lineRange = document.lineAt(range.start.line).range;
      const newLine = line.replace(/(\w+)\s*=/, "$1 :=");
      convertAction.edit.replace(document.uri, lineRange, newLine);
      actions.push(convertAction);
    }

    return actions;
  }

  private async createExtractEmbeddedTypeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    try {
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return actions;
      }

      const symbol = this.findSymbolAtPosition(symbols, range.start);

      if (symbol && symbol.kind === vscode.SymbolKind.Struct) {
        // Look for embedded fields (fields without explicit names)
        const text = document.getText(symbol.range);
        const embeddedMatch = text.match(/^\s*(\w+)\s*$/m);

        if (embeddedMatch) {
          const extractAction = new vscode.CodeAction(
            `Extract embedded type`,
            vscode.CodeActionKind.RefactorExtract,
          );

          extractAction.disabled = {
            reason: "Complex refactoring - requires type analysis",
          };

          actions.push(extractAction);
        }
      }
    } catch (error) {
      console.error("Error creating extract embedded type actions:", error);
    }

    return actions;
  }

  private async createInlineEmbeddedActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    try {
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return actions;
      }

      const symbol = this.findSymbolAtPosition(symbols, range.start);

      if (symbol && symbol.kind === vscode.SymbolKind.Struct) {
        const text = document.getText(symbol.range);
        const embeddedMatch = text.match(/^\s*(\w+)\s*$/m);

        if (embeddedMatch) {
          const inlineAction = new vscode.CodeAction(
            `Inline embedded struct/interface`,
            vscode.CodeActionKind.RefactorInline,
          );

          inlineAction.disabled = {
            reason: "Complex refactoring - requires type analysis",
          };

          actions.push(inlineAction);
        }
      }
    } catch (error) {
      console.error("Error creating inline embedded actions:", error);
    }

    return actions;
  }

  private async createSyncReceiverNamesActions(
    document: vscode.TextDocument,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    try {
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return actions;
      }

      // Find all methods with receivers
      const receivers = new Map<
        string,
        Array<{ name: string; line: number }>
      >();

      for (const symbol of symbols) {
        if (symbol.kind === vscode.SymbolKind.Method) {
          const methodText = document.getText(symbol.range);
          const receiverMatch = methodText.match(/func\s+\((\w+)\s+\*?(\w+)\)/);

          if (receiverMatch) {
            const receiverName = receiverMatch[1];
            const typeName = receiverMatch[2];

            if (!receivers.has(typeName)) {
              receivers.set(typeName, []);
            }

            receivers.get(typeName)!.push({
              name: receiverName,
              line: symbol.range.start.line,
            });
          }
        }
      }

      // Check for inconsistent receiver names
      for (const [typeName, recvList] of receivers.entries()) {
        const names = new Set(recvList.map((r) => r.name));

        if (names.size > 1) {
          // Multiple different receiver names for same type
          const mostCommon = Array.from(names).reduce((a, b) =>
            recvList.filter((r) => r.name === a).length >
            recvList.filter((r) => r.name === b).length
              ? a
              : b,
          );

          const syncAction = new vscode.CodeAction(
            `Synchronize receiver names for '${typeName}' to '${mostCommon}'`,
            vscode.CodeActionKind.Refactor,
          );

          syncAction.edit = new vscode.WorkspaceEdit();

          for (const recv of recvList) {
            if (recv.name !== mostCommon) {
              const line = document.lineAt(recv.line);
              const newText = line.text.replace(
                new RegExp(`\\(${recv.name}\\s+`),
                `(${mostCommon} `,
              );
              syncAction.edit.replace(document.uri, line.range, newText);
            }
          }

          actions.push(syncAction);
        }
      }
    } catch (error) {
      console.error("Error creating sync receiver names actions:", error);
    }

    return actions;
  }

  private async createChangeSignatureActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    try {
      // Check if cursor is in a function/method signature
      const line = document.lineAt(range.start.line);
      const funcMatch = line.text.match(
        /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)/,
      );

      if (!funcMatch) {
        return actions;
      }

      const params = funcMatch[2];
      if (!params.trim()) {
        return actions;
      }

      // Parse parameters
      const paramList = this.parseParameters(params);

      if (paramList.length < 2) {
        return actions; // Need at least 2 parameters to move
      }

      // Find which parameter the cursor is on
      const lineStart = line.range.start;
      const paramsStart =
        line.text.indexOf("(", line.text.indexOf(funcMatch[1])) + 1;
      const cursorPosInLine = range.start.character;

      if (cursorPosInLine < paramsStart) {
        return actions;
      }

      // Determine current parameter index
      let currentParamIdx = -1;
      let currentPos = paramsStart;

      for (let i = 0; i < paramList.length; i++) {
        const paramEnd = currentPos + paramList[i].length;
        if (cursorPosInLine >= currentPos && cursorPosInLine <= paramEnd) {
          currentParamIdx = i;
          break;
        }
        currentPos = paramEnd + 2; // +2 for ", "
      }

      if (currentParamIdx === -1) {
        return actions;
      }

      // Move parameter up
      if (currentParamIdx > 0) {
        const moveUpAction = new vscode.CodeAction(
          `Move parameter up (Go Helper)`,
          vscode.CodeActionKind.Refactor,
        );

        const newParams = [...paramList];
        [newParams[currentParamIdx - 1], newParams[currentParamIdx]] = [
          newParams[currentParamIdx],
          newParams[currentParamIdx - 1],
        ];

        const edit = new vscode.WorkspaceEdit();
        const paramRange = new vscode.Range(
          line.range.start.line,
          paramsStart,
          line.range.start.line,
          paramsStart + params.length,
        );
        edit.replace(document.uri, paramRange, newParams.join(", "));
        moveUpAction.edit = edit;

        actions.push(moveUpAction);
      }

      // Move parameter down
      if (currentParamIdx < paramList.length - 1) {
        const moveDownAction = new vscode.CodeAction(
          `Move parameter down (Go Helper)`,
          vscode.CodeActionKind.Refactor,
        );

        const newParams = [...paramList];
        [newParams[currentParamIdx], newParams[currentParamIdx + 1]] = [
          newParams[currentParamIdx + 1],
          newParams[currentParamIdx],
        ];

        const edit = new vscode.WorkspaceEdit();
        const paramRange = new vscode.Range(
          line.range.start.line,
          paramsStart,
          line.range.start.line,
          paramsStart + params.length,
        );
        edit.replace(document.uri, paramRange, newParams.join(", "));
        moveDownAction.edit = edit;

        actions.push(moveDownAction);
      }

      // Rename parameter
      const currentParam = paramList[currentParamIdx];
      const paramNameMatch = currentParam.match(/^(\w+)/);

      if (paramNameMatch) {
        const renameAction = new vscode.CodeAction(
          `Rename parameter "${paramNameMatch[1]}" (Go Helper)`,
          vscode.CodeActionKind.Refactor,
        );

        renameAction.command = {
          command: "go-helper.renameParameter",
          title: "Rename Parameter",
          arguments: [document.uri, range.start.line, paramNameMatch[1]],
        };

        actions.push(renameAction);
      }
    } catch (error) {
      console.error("Error creating change signature actions:", error);
    }

    return actions;
  }

  private parseParameters(params: string): string[] {
    const result: string[] = [];
    let current = "";
    let depth = 0;

    for (let i = 0; i < params.length; i++) {
      const char = params[i];

      if (char === "(" || char === "[" || char === "{") {
        depth++;
      } else if (char === ")" || char === "]" || char === "}") {
        depth--;
      }

      if (char === "," && depth === 0) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      result.push(current.trim());
    }

    return result;
  }

  private createRunDebugMainActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Check if we're in a main function
    if (line.match(/func\s+main\s*\(/)) {
      const runAction = new vscode.CodeAction(
        "▶️ Run main",
        vscode.CodeActionKind.Empty,
      );

      runAction.command = {
        command: "go.run.cursor",
        title: "Run Main",
      };

      const debugAction = new vscode.CodeAction(
        "🐛 Debug main",
        vscode.CodeActionKind.Empty,
      );

      debugAction.command = {
        command: "go.debug.cursor",
        title: "Debug Main",
      };

      actions.push(runAction, debugAction);
    }

    return actions;
  }

  private async createSymbolManipulationActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    try {
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return actions;
      }

      const symbol = this.findSymbolAtPosition(symbols, range.start);

      if (!symbol) {
        return actions;
      }

      // Check if we're at the top level (after imports)
      const isFirstAfterImports = await this.isFirstSymbolAfterImports(
        document,
        symbol,
        symbols,
      );

      // Interface actions
      if (symbol.kind === vscode.SymbolKind.Interface) {
        actions.push(
          ...(await this.createInterfaceActions(
            document,
            symbol,
            symbols,
            isFirstAfterImports,
          )),
        );
      }
      // Struct actions
      else if (
        symbol.kind === vscode.SymbolKind.Struct ||
        symbol.kind === vscode.SymbolKind.Class
      ) {
        actions.push(
          ...(await this.createStructActions(
            document,
            symbol,
            symbols,
            isFirstAfterImports,
          )),
        );
      }
      // Method actions
      else if (symbol.kind === vscode.SymbolKind.Method) {
        actions.push(
          ...(await this.createMethodActions(
            document,
            symbol,
            symbols,
            isFirstAfterImports,
          )),
        );
      }
      // Function actions
      else if (symbol.kind === vscode.SymbolKind.Function) {
        actions.push(
          ...(await this.createFunctionActions(
            document,
            symbol,
            symbols,
            isFirstAfterImports,
          )),
        );
      }
      // Variable and Constant actions
      else if (
        symbol.kind === vscode.SymbolKind.Variable ||
        symbol.kind === vscode.SymbolKind.Constant
      ) {
        actions.push(
          ...(await this.createVariableConstantActions(
            document,
            symbol,
            symbols,
            isFirstAfterImports,
          )),
        );
      }
    } catch (error) {
      console.error("Error creating symbol manipulation actions:", error);
    }

    return actions;
  }

  private async isFirstSymbolAfterImports(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    allSymbols: vscode.DocumentSymbol[],
  ): Promise<boolean> {
    const text = document.getText();

    // Find the last import statement
    const importMatches = Array.from(
      text.matchAll(/^import\s+(?:\([^)]*\)|"[^"]*")$/gm),
    );
    const lastImportLine =
      importMatches.length > 0
        ? document.positionAt(importMatches[importMatches.length - 1].index!)
            .line
        : -1;

    // Find all top-level symbols after imports
    const topLevelSymbols = allSymbols
      .filter(
        (s) =>
          s.kind === vscode.SymbolKind.Interface ||
          s.kind === vscode.SymbolKind.Struct ||
          s.kind === vscode.SymbolKind.Class ||
          s.kind === vscode.SymbolKind.Method ||
          s.kind === vscode.SymbolKind.Function ||
          s.kind === vscode.SymbolKind.Variable ||
          s.kind === vscode.SymbolKind.Constant,
      )
      .filter((s) => s.range.start.line > lastImportLine)
      .sort((a, b) => a.range.start.line - b.range.start.line);

    return (
      topLevelSymbols.length > 0 && topLevelSymbols[0].name === symbol.name
    );
  }

  private async isLastTopLevelSymbol(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    allSymbols: vscode.DocumentSymbol[],
  ): Promise<boolean> {
    const text = document.getText();

    // Find the last import statement
    const importMatches = Array.from(
      text.matchAll(/^import\s+(?:\([^)]*\)|"[^"]*")$/gm),
    );
    const lastImportLine =
      importMatches.length > 0
        ? document.positionAt(importMatches[importMatches.length - 1].index!)
            .line
        : -1;

    // Find all top-level symbols after imports
    const topLevelSymbols = allSymbols
      .filter(
        (s) =>
          s.kind === vscode.SymbolKind.Interface ||
          s.kind === vscode.SymbolKind.Struct ||
          s.kind === vscode.SymbolKind.Class ||
          s.kind === vscode.SymbolKind.Method ||
          s.kind === vscode.SymbolKind.Function ||
          s.kind === vscode.SymbolKind.Variable ||
          s.kind === vscode.SymbolKind.Constant,
      )
      .filter((s) => s.range.start.line > lastImportLine)
      .sort((a, b) => a.range.start.line - b.range.start.line);

    return (
      topLevelSymbols.length > 0 &&
      topLevelSymbols[topLevelSymbols.length - 1].name === symbol.name
    );
  }

  private async createInterfaceActions(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    allSymbols: vscode.DocumentSymbol[],
    isFirst: boolean,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    // Generate stub
    const generateAction = new vscode.CodeAction(
      `Generate ${symbol.name}Stub (Go Helper)`,
      vscode.CodeActionKind.Refactor,
    );
    generateAction.command = {
      command: "go-helper.generateInterfaceStub",
      title: "Generate Interface Stub",
      arguments: [document.uri, symbol],
    };
    actions.push(generateAction);

    // Check if this is the last symbol
    const isLast = await this.isLastTopLevelSymbol(
      document,
      symbol,
      allSymbols,
    );

    // Move up (only if not first)
    if (!isFirst) {
      const moveUpAction = new vscode.CodeAction(
        `Move ${symbol.name} up (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-helper.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbol.name} down (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-helper.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbol.name} (Go Helper)`,
      vscode.CodeActionKind.Refactor,
    );
    renameAction.command = {
      command: "editor.action.rename",
      title: "Rename",
      arguments: [document.uri, symbol.selectionRange.start],
    };
    actions.push(renameAction);

    return actions;
  }

  private async createStructActions(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    allSymbols: vscode.DocumentSymbol[],
    isFirst: boolean,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    // Check if this is the last symbol
    const isLast = await this.isLastTopLevelSymbol(
      document,
      symbol,
      allSymbols,
    );

    // Move up (only if not first)
    if (!isFirst) {
      const moveUpAction = new vscode.CodeAction(
        `Move ${symbol.name} up (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-helper.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbol.name} down (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-helper.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbol.name} (Go Helper)`,
      vscode.CodeActionKind.Refactor,
    );
    renameAction.command = {
      command: "editor.action.rename",
      title: "Rename",
      arguments: [document.uri, symbol.selectionRange.start],
    };
    actions.push(renameAction);

    return actions;
  }

  private async createMethodActions(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    allSymbols: vscode.DocumentSymbol[],
    isFirst: boolean,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    // Check if this is the last symbol
    const isLast = await this.isLastTopLevelSymbol(
      document,
      symbol,
      allSymbols,
    );

    // Move up (only if not first)
    if (!isFirst) {
      const moveUpAction = new vscode.CodeAction(
        `Move ${symbol.name} up (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-helper.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbol.name} down (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-helper.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbol.name} (Go Helper)`,
      vscode.CodeActionKind.Refactor,
    );
    renameAction.command = {
      command: "editor.action.rename",
      title: "Rename",
      arguments: [document.uri, symbol.selectionRange.start],
    };
    actions.push(renameAction);

    return actions;
  }

  private async createFunctionActions(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    allSymbols: vscode.DocumentSymbol[],
    isFirst: boolean,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    // Check if this is the last symbol
    const isLast = await this.isLastTopLevelSymbol(
      document,
      symbol,
      allSymbols,
    );

    // Move up (only if not first)
    if (!isFirst) {
      const moveUpAction = new vscode.CodeAction(
        `Move ${symbol.name} up (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-helper.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbol.name} down (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-helper.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbol.name} (Go Helper)`,
      vscode.CodeActionKind.Refactor,
    );
    renameAction.command = {
      command: "editor.action.rename",
      title: "Rename",
      arguments: [document.uri, symbol.selectionRange.start],
    };
    actions.push(renameAction);

    return actions;
  }

  private async createVariableConstantActions(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    allSymbols: vscode.DocumentSymbol[],
    isFirst: boolean,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    const symbolType =
      symbol.kind === vscode.SymbolKind.Variable ? "variable" : "constant";
    const symbolKeyword =
      symbol.kind === vscode.SymbolKind.Variable ? "var" : "const";

    // Check if this is the last symbol
    const isLast = await this.isLastTopLevelSymbol(
      document,
      symbol,
      allSymbols,
    );

    // Move up (only if not first)
    if (!isFirst) {
      const moveUpAction = new vscode.CodeAction(
        `Move ${symbolKeyword} ${symbol.name} up (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-helper.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbolKeyword} ${symbol.name} down (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-helper.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbolKeyword} ${symbol.name} (Go Helper)`,
      vscode.CodeActionKind.Refactor,
    );
    renameAction.command = {
      command: "editor.action.rename",
      title: "Rename",
      arguments: [document.uri, symbol.selectionRange.start],
    };
    actions.push(renameAction);

    // Add explicit type (if not already present)
    const symbolText = document.getText(symbol.range);
    const hasExplicitType = this.hasExplicitType(symbolText, symbolKeyword);

    if (!hasExplicitType) {
      const addTypeAction = new vscode.CodeAction(
        `Add ${symbolKeyword} type (Go Helper)`,
        vscode.CodeActionKind.Refactor,
      );
      addTypeAction.command = {
        command: "go-helper.addVarType",
        title: "Add Variable Type",
        arguments: [document.uri, symbol],
      };
      actions.push(addTypeAction);
    }

    return actions;
  }

  private hasExplicitType(text: string, keyword: string): boolean {
    // Check if var/const has explicit type
    // var x int = 5 (has type)
    // var x = 5 (no type)
    // const x = 5 (no type)
    // const x int = 5 (has type, though rare)

    const pattern = new RegExp(`${keyword}\\s+(\\w+)\\s+([^=]+)=`);
    const match = text.match(pattern);

    if (!match) {
      return false;
    }

    const possibleType = match[2].trim();
    // Check if there's something between name and =
    return possibleType.length > 0;
  }

  private createRunDebugTestActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const line = document.lineAt(range.start.line).text;

    // Check if we're in a test function
    if (line.match(/func\s+Test\w+\s*\(/)) {
      const runAction = new vscode.CodeAction(
        "▶️ Run test",
        vscode.CodeActionKind.Empty,
      );

      runAction.command = {
        command: "go.test.cursor",
        title: "Run Test",
      };

      const debugAction = new vscode.CodeAction(
        "🐛 Debug test",
        vscode.CodeActionKind.Empty,
      );

      debugAction.command = {
        command: "go.debug.cursor",
        title: "Debug Test",
      };

      actions.push(runAction, debugAction);
    }

    return actions;
  }
}
