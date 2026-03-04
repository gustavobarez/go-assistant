import * as vscode from "vscode";

export class GoCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Refactor,
    vscode.CodeActionKind.Source,
  ];

  private getConfig() {
    const config = vscode.workspace.getConfiguration("goAssistant.codeActions");
    return {
      enable: config.get<boolean>("enable", true),
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

    // Generate getter/setter actions
    const getterSetterActions = await this.createGetterSetterActions(
      document,
      wordRange || range,
    );
    actions.push(...getterSetterActions);

    // Add missing return statement
    actions.push(...this.createAddReturnActions(document, range));

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

    // Fill all struct fields
    const fillAllFieldsActions = await this.createFillAllFieldsActions(
      document,
      range,
    );
    actions.push(...fillAllFieldsActions);

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

    // Synchronize receiver names
    const syncReceiverActions =
      await this.createSyncReceiverNamesActions(document);
    actions.push(...syncReceiverActions);

    // Handle error on bare function call
    const handleErrorActions = await this.createHandleErrorActions(
      document,
      range,
    );
    actions.push(...handleErrorActions);

    // Run/debug main method
    actions.push(...this.createRunDebugMainActions(document, range));

    // Run/debug test method
    actions.push(...this.createRunDebugTestActions(document, range));

    return actions.length > 0 ? actions : undefined;
  }

  private createExtractVariableActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Extract to variable with :=
    const extractAction = new vscode.CodeAction(
      "Extract to variable (Go Assistant)",
      vscode.CodeActionKind.Refactor,
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

  /** Returns the first top-level symbol of the given kind whose full range
   *  (not just selectionRange) contains the position. */
  private findEnclosingSymbolByRange(
    symbols: vscode.DocumentSymbol[],
    position: vscode.Position,
    kind: vscode.SymbolKind,
  ): vscode.DocumentSymbol | undefined {
    for (const symbol of symbols) {
      if (symbol.kind === kind && symbol.range.contains(position)) {
        return symbol;
      }
    }
    return undefined;
  }

  private findSymbolByName(
    symbols: vscode.DocumentSymbol[],
    name: string,
    kind?: vscode.SymbolKind,
  ): vscode.DocumentSymbol | undefined {
    for (const symbol of symbols) {
      if (symbol.name === name && (!kind || symbol.kind === kind)) {
        return symbol;
      }

      // Check children recursively
      if (symbol.children && symbol.children.length > 0) {
        const childSymbol = this.findSymbolByName(symbol.children, name, kind);
        if (childSymbol) {
          return childSymbol;
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
        "Split field declarations (Go Assistant)",
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

  private findEnclosingStructName(
    document: vscode.TextDocument,
    lineNumber: number,
  ): string | undefined {
    let braceCount = 0;
    for (let i = lineNumber; i >= 0; i--) {
      const l = document.lineAt(i).text;
      // Count braces going backwards (reverse direction)
      for (let c = l.length - 1; c >= 0; c--) {
        if (l[c] === "}") {
          braceCount++;
        } else if (l[c] === "{") {
          if (braceCount > 0) {
            braceCount--;
          } else {
            // This opening brace is the one we're inside
            const m = l.match(/type\s+(\w+)\s+struct\s*\{/);
            if (m) {
              return m[1];
            }
            return undefined;
          }
        }
      }
    }
    return undefined;
  }

  private toTagName(fieldName: string, casing: string): string {
    // Split PascalCase into words, handling consecutive-uppercase acronyms:
    //   UserID  -> ["User", "ID"]
    //   ID      -> ["ID"]
    //   HTTPSServer -> ["HTTPS", "Server"]
    const words = fieldName.match(
      /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g,
    ) ?? [fieldName];
    if (casing === "snakeCase") {
      return words.map((w) => w.toLowerCase()).join("_");
    }
    // camelCase: first word fully lowercase, rest keep first letter capitalised
    return words
      .map((w, i) =>
        i === 0
          ? w.toLowerCase()
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join("");
  }

  private async createTagManagementActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];
    const tagCasing = vscode.workspace
      .getConfiguration("goAssistant.codeActions")
      .get<string>("tagNamingCase", "camelCase")!;
    const line = document.lineAt(range.start.line).text;

    // Determine the struct name whether cursor is on the declaration line or inside a field
    const structDeclMatch = line.match(/^\s*type\s+(\w+)\s+struct\s*\{?\s*$/);
    const structName: string | undefined = structDeclMatch
      ? structDeclMatch[1]
      : this.findEnclosingStructName(document, range.start.line);

    if (structName) {
      try {
        const symbols = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[]
        >("vscode.executeDocumentSymbolProvider", document.uri);

        if (symbols) {
          const structSymbol = this.findSymbolByName(
            symbols,
            structName,
            vscode.SymbolKind.Struct,
          );

          if (structSymbol && structSymbol.children) {
            const fields = structSymbol.children.filter(
              (c) =>
                c.kind === vscode.SymbolKind.Field ||
                c.kind === vscode.SymbolKind.Property,
            );

            if (fields.length > 0) {
              let hasJsonTags = false;
              let allHaveJsonTags = true;

              for (const field of fields) {
                const fieldText = document.getText(field.range);
                if (fieldText.includes('`json:"')) {
                  hasJsonTags = true;
                } else {
                  allHaveJsonTags = false;
                }
              }

              // Add json tags to all fields
              if (!allHaveJsonTags) {
                const addAllJsonAction = new vscode.CodeAction(
                  `Add json tags to all fields (Go Assistant)`,
                  vscode.CodeActionKind.Refactor,
                );

                addAllJsonAction.edit = new vscode.WorkspaceEdit();

                for (const field of fields) {
                  const fieldText = document.getText(field.range);
                  const fieldLine = document.lineAt(
                    field.range.start.line,
                  ).text;

                  if (fieldText.includes('`json:"')) {
                    continue;
                  }

                  const fieldMatch = fieldText.match(/^\s*(\w+)\s+/);
                  if (fieldMatch) {
                    const fieldName = fieldMatch[1];
                    const jsonName = this.toTagName(fieldName, tagCasing);
                    const lineRange = document.lineAt(
                      field.range.start.line,
                    ).range;
                    const withTag =
                      fieldLine.trimEnd() + ` \`json:"${jsonName}"\``;
                    addAllJsonAction.edit.replace(
                      document.uri,
                      lineRange,
                      withTag,
                    );
                  }
                }

                actions.push(addAllJsonAction);
              }

              // Add custom tag to all fields — asks for tag name once, applies everywhere
              const addCustomTagAllAction = new vscode.CodeAction(
                `Add custom tag to all fields (Go Assistant)`,
                vscode.CodeActionKind.Refactor,
              );
              addCustomTagAllAction.command = {
                command: "go-assistant.addCustomTagToAllFields",
                title: "Add Custom Tag to All Fields",
                arguments: [document.uri, range.start.line, structName],
              };
              actions.push(addCustomTagAllAction);

              // Remove json tags from all fields
              if (hasJsonTags) {
                const removeAllJsonAction = new vscode.CodeAction(
                  `Remove json tags from all fields (Go Assistant)`,
                  vscode.CodeActionKind.Refactor,
                );

                removeAllJsonAction.edit = new vscode.WorkspaceEdit();

                for (const field of fields) {
                  const fieldText = document.getText(field.range);
                  const fieldLine = document.lineAt(
                    field.range.start.line,
                  ).text;

                  if (!fieldText.includes('`json:"')) {
                    continue;
                  }

                  const lineRange = document.lineAt(
                    field.range.start.line,
                  ).range;
                  const withoutTags = fieldLine.replace(
                    /\s*`json:"[^"]*"`/,
                    "",
                  );
                  removeAllJsonAction.edit.replace(
                    document.uri,
                    lineRange,
                    withoutTags.trimEnd(),
                  );
                }

                actions.push(removeAllJsonAction);
              }
            }
          }
        }
      } catch (error) {
        console.error("Error creating bulk tag actions:", error);
      }
    }

    // Per-field: add json tag (only when on an untagged field line inside a struct)
    const fieldMatch = line.match(/^\s*(\w+)\s+(\w+)\s*$/);
    if (fieldMatch && this.isLineInsideStruct(document, range.start.line)) {
      const fieldName = fieldMatch[1];
      const jsonName = this.toTagName(fieldName, tagCasing);

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

    // Per-field: remove all tags
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
            command: "go-assistant.showReferences",
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
          `Move parameter up (Go Assistant)`,
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
          `Move parameter down (Go Assistant)`,
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
          `Rename parameter "${paramNameMatch[1]}" (Go Assistant)`,
          vscode.CodeActionKind.Refactor,
        );

        renameAction.command = {
          command: "go-assistant.renameParameter",
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

      // Check if cursor is anywhere inside an interface's full range
      // (handles cursor on `type`, `interface` keyword, name, or inside the body)
      const enclosingInterface = this.findEnclosingSymbolByRange(
        symbols,
        range.start,
        vscode.SymbolKind.Interface,
      );

      if (enclosingInterface) {
        const isFirstAfterImports = await this.isFirstSymbolAfterImports(
          document,
          enclosingInterface,
          symbols,
        );
        actions.push(
          ...(await this.createInterfaceActions(
            document,
            enclosingInterface,
            symbols,
            isFirstAfterImports,
          )),
        );
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

      // Struct actions
      if (
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
      `Generate ${symbol.name}Stub (Go Assistant)`,
      vscode.CodeActionKind.Refactor,
    );
    generateAction.command = {
      command: "go-assistant.generateInterfaceStub",
      title: "Generate Interface Stub",
      arguments: [document.uri, symbol],
    };
    actions.push(generateAction);

    // Add method to interface and all implementations
    const addMethodAction = new vscode.CodeAction(
      `Add method to interface ${symbol.name} and all implementations (Go Assistant)`,
      vscode.CodeActionKind.Refactor,
    );
    addMethodAction.command = {
      command: "go-assistant.addMethodToInterface",
      title: "Add Method to Interface and All Implementations", // keep English
      arguments: [
        document.uri,
        symbol.selectionRange.start,
        symbol.name,
        symbol.range,
      ],
    };
    actions.push(addMethodAction);

    // Check if this is the last symbol
    const isLast = await this.isLastTopLevelSymbol(
      document,
      symbol,
      allSymbols,
    );

    // Move up (only if not first)
    if (!isFirst) {
      const moveUpAction = new vscode.CodeAction(
        `Move ${symbol.name} up (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-assistant.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbol.name} down (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-assistant.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbol.name} (Go Assistant)`,
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
        `Move ${symbol.name} up (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-assistant.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbol.name} down (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-assistant.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbol.name} (Go Assistant)`,
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
        `Move ${symbol.name} up (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-assistant.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbol.name} down (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-assistant.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbol.name} (Go Assistant)`,
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
        `Move ${symbol.name} up (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-assistant.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbol.name} down (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-assistant.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbol.name} (Go Assistant)`,
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
        `Move ${symbolKeyword} ${symbol.name} up (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveUpAction.command = {
        command: "go-assistant.moveSymbolUp",
        title: "Move Symbol Up",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveUpAction);
    }

    // Move down (only if not last)
    if (!isLast) {
      const moveDownAction = new vscode.CodeAction(
        `Move ${symbolKeyword} ${symbol.name} down (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      moveDownAction.command = {
        command: "go-assistant.moveSymbolDown",
        title: "Move Symbol Down",
        arguments: [document.uri, symbol, allSymbols],
      };
      actions.push(moveDownAction);
    }

    // Rename
    const renameAction = new vscode.CodeAction(
      `Rename ${symbolKeyword} ${symbol.name} (Go Assistant)`,
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
        `Add ${symbolKeyword} type (Go Assistant)`,
        vscode.CodeActionKind.Refactor,
      );
      addTypeAction.command = {
        command: "go-assistant.addVarType",
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

  private async createFillAllFieldsActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    const goKeywords = new Set([
      "if",
      "for",
      "func",
      "switch",
      "select",
      "case",
      "go",
      "defer",
      "return",
      "var",
      "const",
      "type",
      "import",
      "package",
      "struct",
      "interface",
      "map",
      "chan",
      "range",
      "break",
      "continue",
      "goto",
      "fallthrough",
      "else",
      "default",
    ]);

    // Helper to check a single line for a struct literal and validate the cursor
    // is within the literal span. Returns { typeName, typeNameCol } or null.
    const tryLine = (
      lineText: string,
      cursorCol: number | null,
    ): { typeName: string; typeNameCol: number } | null => {
      const structLiteralMatch = lineText.match(/(&?)([A-Za-z_]\w*)\s*\{/);
      if (!structLiteralMatch) {
        return null;
      }

      const typeName = structLiteralMatch[2];
      if (goKeywords.has(typeName)) {
        return null;
      }
      if (!/^[A-Z]/.test(typeName)) {
        return null;
      }

      if (cursorCol !== null) {
        const literalStart = structLiteralMatch.index ?? 0;
        const closingBrace = lineText.indexOf("}", literalStart);
        const literalEnd =
          closingBrace >= 0 ? closingBrace + 1 : lineText.length;
        if (cursorCol < literalStart || cursorCol > literalEnd) {
          return null;
        }
      }

      const typeNameCol = lineText.indexOf(
        typeName,
        structLiteralMatch.index ?? 0,
      );
      return { typeName, typeNameCol };
    };

    // 1. Try the current line first (original behaviour)
    const currentLine = document.lineAt(range.start.line).text;
    let result = tryLine(currentLine, range.start.character);
    let targetLine = range.start.line;

    // 2. If not found on current line, scan up to 20 previous lines for an
    //    unclosed struct literal (e.g. cursor is inside a multi-line literal).
    if (!result) {
      for (
        let i = range.start.line - 1;
        i >= Math.max(0, range.start.line - 20);
        i--
      ) {
        const lineText = document.lineAt(i).text;
        // We found a line that opens a struct — check it is really unclosed:
        // the `{` must appear after the type name with no matching `}` on that same line
        const candidate = tryLine(lineText, /* no cursor restriction */ null);
        if (candidate) {
          const openIdx = lineText.lastIndexOf("{");
          const closeIdx = lineText.indexOf("}", openIdx);
          if (closeIdx === -1) {
            // The `{` has no closing `}` on this line → cursor is inside
            result = candidate;
            targetLine = i;
            break;
          }
        }
      }
    }

    if (!result) {
      return actions;
    }

    const { typeName, typeNameCol } = result;

    const fillAction = new vscode.CodeAction(
      `Fill all fields of '${typeName}' (Go Assistant)`,
      vscode.CodeActionKind.Refactor,
    );
    fillAction.command = {
      command: "go-assistant.fillAllFields",
      title: "Fill All Fields",
      // Pass the position on the line that contains the type name so gopls can resolve it
      arguments: [
        document.uri,
        new vscode.Position(targetLine, typeNameCol),
        typeName,
        typeNameCol,
      ],
    };
    actions.push(fillAction);

    return actions;
  }

  // ─── Handle error on bare function call ────────────────────────────────────

  /**
   * When the cursor is on a line that contains a bare function/method call with no
   * left-hand assignment and no error handling, offer to:
   *   - Declare variables for every return value (names derived from types or named returns)
   *   - Add `if err != nil { return }` when the last return type is `error`
   *
   * Example:
   *   stream.Recv()          →  msg, err := stream.Recv()
   *                              if err != nil {
   *                                  return
   *                              }
   */
  private async createHandleErrorActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    try {
      const line = document.lineAt(range.start.line).text;
      const trimmed = line.trim();
      const indent = line.match(/^(\s*)/)?.[1] ?? "";

      const dbg = (msg: string) =>
        console.log(
          `[go-assistant] handleError L${range.start.line + 1}: ${msg}`,
        );

      // Must not already have a flow keyword or assignment
      if (
        /^\s*(var\s|return\b|if\b|for\b|switch\b|select\b|defer\b|go\b)/.test(
          line,
        )
      ) {
        dbg("skip: control flow keyword");
        return actions;
      }

      // Must contain a call
      if (!line.includes("(")) {
        dbg("skip: no '('");
        return actions;
      }

      // Check for existing assignment (:= or lone =), ignoring comparison operators
      // We strip two-character operator sequences first so ==, !=, <=, >= etc. don't
      // false-positive.  After stripping them :=  and lone = are what remain.
      const lineNoStrings = line.replace(/"[^"]*"|`[^`]*`/g, "''");
      const lineNoCompound = lineNoStrings.replace(
        /[!<>=+\-*\/%&|^]=|<<=|>>=|>>>=|={2}/g,
        "  ",
      );
      if (lineNoCompound.includes("=")) {
        dbg(`skip: assignment found in: "${lineNoCompound}"`);
        return actions;
      }

      // The trimmed line must look like a bare function/method call.
      // We use a permissive regex — the key constraint is that there is no
      // top-level operator or keyword before the call expression.
      // Allows: pkg.Func(...)  s.m(...)  fn(nested())  fn(Struct{f:v})
      if (!/^[\w.]+\s*\(/.test(trimmed) || !/\)\s*$/.test(trimmed)) {
        dbg(`skip: not a bare call: "${trimmed}"`);
        return actions;
      }

      // Reject interface method declarations: e.g. `CreateUser(ctx Ctx) (*Ret, error)`
      // These end with `)` but have non-empty text after the outermost closing paren,
      // indicating a return-type list that is part of a signature, not a call.
      {
        let depth = 0;
        let firstGroupClosed = -1;
        for (let ci = 0; ci < trimmed.length; ci++) {
          if (trimmed[ci] === "(") {
            depth++;
          } else if (trimmed[ci] === ")") {
            depth--;
            if (depth === 0) {
              firstGroupClosed = ci;
              break;
            }
          }
        }
        if (
          firstGroupClosed >= 0 &&
          trimmed.slice(firstGroupClosed + 1).trim().length > 0
        ) {
          dbg(`skip: text after outermost ')' — looks like a method signature`);
          return actions;
        }
      }

      // ── Find the function-name column to hover on ────────────────────────────
      // The function name is the last word-identifier immediately before the
      // OUTERMOST opening '(' of the call.  We find the outermost paren by
      // scanning left-to-right (the line starts with the call expression).
      const firstOpenIdx = trimmed.indexOf("(");
      const beforeParen = trimmed.slice(0, firstOpenIdx);
      const funcNameInTrimmed = beforeParen.match(/\.?(\w+)\s*$/);
      if (!funcNameInTrimmed) {
        dbg(`skip: cannot extract function name from "${beforeParen}"`);
        return actions;
      }
      const funcName = funcNameInTrimmed[1];
      // Map back to the original (indented) line
      const firstOpenIdxInLine = line.indexOf("(", indent.length);
      const funcNameCol = line.lastIndexOf(funcName, firstOpenIdxInLine);

      dbg(
        `hovering on "${funcName}" at col ${funcNameCol} (line: "${trimmed}")`,
      );

      const hoverPos = new vscode.Position(range.start.line, funcNameCol);

      // ── Request hover from gopls ─────────────────────────────────────────────
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        document.uri,
        hoverPos,
      );

      if (!hovers || hovers.length === 0) {
        dbg("skip: no hover returned");
        return actions;
      }

      const hoverText = hovers
        .flatMap((h) =>
          h.contents.map((c) =>
            typeof c === "string" ? c : (c as vscode.MarkdownString).value,
          ),
        )
        .join("\n");

      dbg(`hover text (first 400 chars): ${hoverText.substring(0, 400)}`);

      // ── Parse function signature from hover ──────────────────────────────────
      const returnTypes = this.extractReturnTypesFromHover(hoverText);
      dbg(
        `returnTypes: ${returnTypes === undefined ? "undefined" : JSON.stringify(returnTypes)}`,
      );

      if (!returnTypes || returnTypes.length === 0) {
        dbg("skip: no return types found or void function");
        return actions;
      }

      // Only show action when the last return type is `error`
      const lastType = returnTypes[returnTypes.length - 1].type;
      if (lastType !== "error") {
        dbg(`skip: last return type is "${lastType}", not "error"`);
        return actions;
      }

      // ── Build variable names ─────────────────────────────────────────────────
      // For unnamed returns, fall back to a name derived from the calling method:
      //   pkg.Method()   → method,  MethodBase() → base
      // bool without a name always becomes "ok".
      const methodVarName = this.methodNameToVarName(funcName);
      const varNames = returnTypes.map((r, idx) => {
        if (r.name && r.name !== "_") {
          return r.name;
        }
        if (r.type === "bool") {
          return "ok";
        }
        if (r.type === "error") {
          return "err";
        }
        // For the first non-error unnamed return, prefer the method-name-derived
        // variable name (e.g. GetUser → user, Recv → recv) when there are
        // multiple returns (otherwise we'd be shadowing a lone error return).
        if (idx === 0 && returnTypes.length > 1 && methodVarName) {
          return methodVarName;
        }
        return this.typeToVarName(r.type);
      });
      const errVar = varNames[varNames.length - 1];
      const callExpr = trimmed;
      const lineRange = document.lineAt(range.start.line).range;

      const newContent = [
        `${indent}${varNames.join(", ")} := ${callExpr}`,
        `${indent}if ${errVar} != nil {`,
        `${indent}\treturn`,
        `${indent}}`,
      ].join("\n");

      dbg(`action ready: varNames=${varNames.join(", ")}`);

      const action = new vscode.CodeAction(
        "Handle error (Go Assistant)",
        vscode.CodeActionKind.QuickFix,
      );
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      action.edit.replace(document.uri, lineRange, newContent);
      actions.push(action);
    } catch (error) {
      console.error("[go-assistant] createHandleErrorActions error:", error);
    }

    return actions;
  }

  /**
   * Extracts return type information from a gopls hover text.
   * Handles:
   *   func Name(...) error
   *   func Name(...) (Type, error)
   *   func (r Recv) Name(...) (val Type, err error)
   *   func (*pkg.Generic[T]) Name(...) (Type, error)
   */
  private extractReturnTypesFromHover(
    hoverText: string,
  ): { name?: string; type: string }[] | undefined {
    // Pull the first Go code block.  gopls uses ```go fences.
    // Normalise \r\n → \n just in case.
    const normalised = hoverText.replace(/\r\n/g, "\n");
    const goBlock = normalised.match(/```(?:go)?\n([\s\S]*?)```/)?.[1];
    if (!goBlock) {
      console.log(
        "[go-assistant] extractReturnTypes: no go code block found in hover",
      );
      return undefined;
    }

    // ── Strategy 1: regex over the first func line ───────────────────────────
    // Collapse the go block to a single line for matching (handles multi-line sigs)
    const oneLine = goBlock.replace(/\n\s*/g, " ").trim();

    // Match:  func [receiver] FuncName([params]) [returns]
    //   or:   func [receiver] pkg.FuncName([params]) [returns]
    // Receiver can contain brackets for generics: (*T[A, B])
    // We capture everything after the parameter closing paren as "tail".
    // Note: gopls sometimes emits a package-qualified name (e.g. "mongo.Connect")
    // so we use [\w.]+ instead of \w+ for the function name.
    const funcRe =
      /^func\s+(?:\([^)]*(?:\([^)]*\)[^)]*)*\)\s+)?[\w.]+\s*\(([^)(]|\([^)]*\))*\)\s*(.*)/;
    const funcMatch = oneLine.match(funcRe);
    if (!funcMatch) {
      console.log(
        `[go-assistant] extractReturnTypes: funcRe did not match: "${oneLine.substring(0, 200)}"`,
      );
      return undefined;
    }

    const tail = (funcMatch[2] ?? "").trim();
    console.log(`[go-assistant] extractReturnTypes: tail="${tail}"`);

    if (!tail) {
      return []; // void
    }

    // tail may have a trailing comment or doc — take only the return-type part
    // (everything up to the first whitespace-only EOL or brace)
    const returnsPart = tail.replace(/\s*(?:\/\/.*)?$/, "").trim();
    if (!returnsPart || returnsPart === "{") {
      return []; // void
    }

    return this.parseGoReturnTypes(returnsPart);
  }

  private parseGoReturnTypes(
    returnsPart: string,
  ): { name?: string; type: string }[] {
    if (!returnsPart) {
      return [];
    }

    // Single un-parenthesised return type, e.g. "error" or "*Message" or "string"
    if (!returnsPart.startsWith("(")) {
      return [{ type: returnsPart.trim() }];
    }

    // Parenthesised: "(Type1, Type2)" or "(name1 Type1, name2 Type2)"
    const inner = returnsPart.slice(1, -1).trim();
    if (!inner) {
      return [];
    }

    const parts = this.splitTopLevelCommas(inner);
    return parts.map((part) => {
      const trimmed = part.trim();
      // Named return: "name type" where name is a Go identifier and type is next token
      // Handles: "err error", "msg *Message", "n int"
      const namedMatch = trimmed.match(/^(\w+)\s+(\S.*)$/);
      if (namedMatch) {
        // Distinguish "name Type" from a single bare type like "[]byte"
        // If first token is lowercase or looks like a Go identifier (not a type keyword)
        // we treat it as a named return.
        const first = namedMatch[1];
        const second = namedMatch[2];
        // Named if first token starts lowercase AND isn't a known type prefix
        if (
          first[0] === first[0].toLowerCase() &&
          !first.match(/^(map|chan|func|interface|struct)$/)
        ) {
          return { name: first, type: second };
        }
      }
      return { type: trimmed };
    });
  }

  private splitTopLevelCommas(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
      } else if (ch === "," && depth === 0) {
        parts.push(s.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(s.slice(start));
    return parts;
  }

  /**
   * Derives a sensible Go variable name from a type string.
   * e.g. "*grpc.ClientConn" → "conn", "error" → "err", "*http.Request" → "req"
   */
  private typeToVarName(typeName: string): string {
    // Strip pointer, slice, channel, etc. decorators
    let base = typeName.replace(/^[*\[\]&]+/, "").trim();

    // Remove package qualifier: pkg.Type → Type
    const dotIdx = base.lastIndexOf(".");
    if (dotIdx >= 0) {
      base = base.slice(dotIdx + 1);
    }

    // Well-known names
    const known: Record<string, string> = {
      error: "err",
      bool: "ok",
      string: "s",
      Context: "ctx",
      ResponseWriter: "w",
      Request: "req",
      Response: "resp",
      ClientConn: "conn",
      Server: "srv",
      Client: "client",
      Conn: "conn",
      Reader: "r",
      Writer: "w",
      Buffer: "buf",
      File: "f",
    };
    if (known[base]) {
      return known[base];
    }

    // Numeric types
    if (
      /^u?int(8|16|32|64)?$/.test(base) ||
      base === "byte" ||
      base === "rune"
    ) {
      return "n";
    }
    if (
      /^float(32|64)$/.test(base) ||
      base === "complex128" ||
      base === "complex64"
    ) {
      return "f";
    }

    // Complex / structural types
    if (base.startsWith("map[")) {
      return "m";
    }
    if (base.startsWith("chan ") || base === "chan") {
      return "ch";
    }
    if (base === "interface{}" || base === "any") {
      return "v";
    }

    // Generic fallback: lower-case first letter
    if (!base) {
      return "v";
    }
    return base.charAt(0).toLowerCase() + base.slice(1);
  }

  /**
   * Derives a variable name from a function/method name.
   * "package.Method" → "method"
   * "MethodBase"     → "base"  (last PascalCase word, lowercased)
   * "get"            → "get"
   */
  private methodNameToVarName(funcName: string): string {
    // Strip package qualifier: "pkg.Method" → "Method"
    const dotIdx = funcName.lastIndexOf(".");
    const name = dotIdx >= 0 ? funcName.slice(dotIdx + 1) : funcName;
    if (!name) {
      return "";
    }
    // Split PascalCase/camelCase into words, take the last word
    const words = name.match(
      /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g,
    ) ?? [name];
    const last = words[words.length - 1];
    return last.charAt(0).toLowerCase() + last.slice(1);
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
