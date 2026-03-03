import * as cp from "child_process";
import * as path from "path";
import * as vscode from "vscode";

interface InterfaceItem extends vscode.QuickPickItem {
  qualifiedName: string;
  /** Short-form pkg.Name suitable for the `impl` CLI tool */
  implQualifiedName: string;
  symbolName: string;
  uri: vscode.Uri;
  range: vscode.Range;
  containerName: string;
}

/**
 * Provides "Implement Interface" functionality for Go structs.
 *
 * Uses gopls workspace/symbol for fast interface discovery across
 * stdlib, dependencies, and workspace. Uses the `impl` tool for
 * reliable stub generation with manual fallback via gopls hover.
 */
export class GoImplementInterfaceProvider {
  private implToolChecked = false;
  private implToolAvailable = false;

  /**
   * Main entry point: show picker → generate stubs → insert into document.
   */
  async implementInterface(
    documentUri: vscode.Uri,
    structName: string,
    structEndLine: number,
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument(documentUri);

    // Show QuickPick for interface selection
    const selected = await this.showInterfacePicker();
    if (!selected) {
      console.log(
        "[go-assistant] implementInterface: picker dismissed or no item selected",
      );
      return;
    }

    // Determine receiver name (first lowercase letter of struct name)
    const receiverName = structName[0].toLowerCase();

    // Find existing methods of the struct to avoid duplicates
    const existingMethods = this.findExistingMethods(document, structName);

    // Generate stubs via multiple strategies
    console.log(
      `[go-assistant] implementInterface: struct=${structName} iface=${selected.qualifiedName} implQualified=${selected.implQualifiedName}`,
    );
    const stubs = await this.generateStubs(
      document,
      structName,
      receiverName,
      selected,
      existingMethods,
    );

    // undefined  → all strategies failed to locate the interface
    // empty string → interface found but all methods already exist
    if (stubs === undefined) {
      return; // error message already shown inside generateStubs
    }
    if (stubs.trim().length === 0) {
      vscode.window.showInformationMessage(
        `${structName} already implements all methods from ${selected.qualifiedName}`,
      );
      return;
    }

    // Insert stubs after the struct definition
    const edit = new vscode.WorkspaceEdit();
    const insertPosition = new vscode.Position(structEndLine + 1, 0);
    edit.insert(document.uri, insertPosition, "\n" + stubs + "\n");

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      // Format the document
      await vscode.commands.executeCommand(
        "editor.action.formatDocument",
        document.uri,
      );

      const methodCount = (stubs.match(/^func /gm) || []).length;
      vscode.window.showInformationMessage(
        `Implemented ${methodCount} method${methodCount === 1 ? "" : "s"} from ${selected.qualifiedName}`,
      );
    }
  }

  /**
   * Shows a QuickPick with real-time interface search via gopls workspace/symbol.
   */
  private async showInterfacePicker(): Promise<InterfaceItem | undefined> {
    return new Promise<InterfaceItem | undefined>((resolve) => {
      const picker = vscode.window.createQuickPick<InterfaceItem>();
      picker.placeholder =
        "Type to search interfaces (e.g., Writer, Reader, Stringer, Handler)";
      picker.matchOnDescription = true;
      picker.matchOnDetail = true;

      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;

      picker.onDidChangeValue((value) => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        if (value.length < 1) {
          picker.items = [];
          return;
        }

        picker.busy = true;
        debounceTimer = setTimeout(async () => {
          if (disposed) {
            return;
          }
          const items = await this.searchInterfaces(value);
          if (!disposed) {
            picker.items = items;
            picker.busy = false;
          }
        }, 150);
      });

      picker.onDidAccept(() => {
        // For single-select QuickPick, activeItems[0] is the highlighted item;
        // selectedItems[0] is empty until after the event resolves.
        const selected = picker.activeItems[0] ?? picker.selectedItems[0];
        console.log(
          `[go-assistant] picker accepted: selected=${selected?.label ?? "(none)"}`,
        );
        disposed = true;
        resolve(selected);
        picker.dispose();
      });

      picker.onDidHide(() => {
        disposed = true;
        picker.dispose();
        resolve(undefined);
      });

      picker.show();
    });
  }

  /**
   * Extracts the short package name from a container name that might be a full import path.
   * e.g. "github.com/foo/bar" → "bar", "io" → "io"
   */
  private shortPkgName(containerName: string): string {
    const parts = containerName.split("/");
    return parts[parts.length - 1];
  }

  /**
   * Searches for interfaces using gopls workspace/symbol.
   */
  private async searchInterfaces(query: string): Promise<InterfaceItem[]> {
    try {
      const symbols = await vscode.commands.executeCommand<
        vscode.SymbolInformation[]
      >("vscode.executeWorkspaceSymbolProvider", query);

      if (!symbols) {
        console.log("[go-assistant] searchInterfaces: no symbols returned");
        return [];
      }

      const seen = new Set<string>();

      return symbols
        .filter((s) => s.kind === vscode.SymbolKind.Interface)
        .map((s) => {
          // containerName from gopls may be a full import path like "github.com/foo/bar"
          // We use the full import path as qualifiedName (required by impl tool and go doc)
          // but display just the short package name
          const importPath = s.containerName || "";
          const pkgShort = importPath ? this.shortPkgName(importPath) : "";
          const qualifiedName = importPath ? `${importPath}.${s.name}` : s.name;
          const implQualifiedName = pkgShort ? `${pkgShort}.${s.name}` : s.name;

          return {
            label: `$(symbol-interface) ${s.name}`,
            description: pkgShort,
            detail: this.formatFilePath(s.location.uri.fsPath),
            qualifiedName,
            implQualifiedName,
            symbolName: s.name,
            uri: s.location.uri,
            range: s.location.range,
            containerName: importPath,
          };
        })
        .filter((item) => {
          if (seen.has(item.qualifiedName)) {
            return false;
          }
          seen.add(item.qualifiedName);
          return true;
        })
        .slice(0, 80);
    } catch (error) {
      console.error("[go-assistant] searchInterfaces error:", error);
      return [];
    }
  }

  /**
   * Generates method stubs using a cascade of strategies:
   * 1. impl tool (best)
   * 2. gopls hover to read interface definition
   * 3. gopls document symbols on the interface file
   * 4. go doc as last resort
   */
  private async generateStubs(
    document: vscode.TextDocument,
    structName: string,
    receiverName: string,
    iface: InterfaceItem,
    existingMethods: Set<string>,
  ): Promise<string | undefined> {
    console.log(
      `[go-assistant] generateStubs: trying strategies for ${iface.qualifiedName}`,
    );

    // Strategy 1: impl tool
    const implResult = await this.tryImplTool(
      document,
      structName,
      receiverName,
      iface.implQualifiedName,
      existingMethods,
    );
    if (implResult !== undefined) {
      console.log(
        "[go-assistant] Strategy 1 (impl tool) returned:",
        implResult || "<empty – already implemented>",
      );
      return implResult;
    }
    console.log(
      "[go-assistant] Strategy 1 (impl tool) returned undefined – trying hover",
    );

    // Strategy 2: gopls hover on interface name → parses full definition
    const hoverResult = await this.generateFromHover(
      iface,
      structName,
      receiverName,
      existingMethods,
    );
    // undefined = strategy failed; "" = found but already implemented; non-empty = success
    if (hoverResult !== undefined) {
      console.log(
        "[go-assistant] Strategy 2 (hover) returned:",
        hoverResult || "<empty – already implemented>",
      );
      return hoverResult;
    }
    console.log(
      "[go-assistant] Strategy 2 (hover) returned undefined – trying document symbols",
    );

    // Strategy 3: open the file, find interface by name, read methods
    const manualResult = await this.generateFromDocumentSymbols(
      iface,
      structName,
      receiverName,
      existingMethods,
    );
    if (manualResult !== undefined) {
      console.log(
        "[go-assistant] Strategy 3 (document symbols) returned:",
        manualResult || "<empty – already implemented>",
      );
      return manualResult;
    }
    console.log(
      "[go-assistant] Strategy 3 (document symbols) returned undefined – trying go doc",
    );

    // Strategy 4: go doc
    const goDocResult = await this.generateFromGoDoc(
      structName,
      receiverName,
      iface.implQualifiedName,
      existingMethods,
    );
    if (goDocResult !== undefined) {
      console.log(
        "[go-assistant] Strategy 4 (go doc) returned:",
        goDocResult || "<empty – already implemented>",
      );
      return goDocResult;
    }
    console.log(
      "[go-assistant] Strategy 4 (go doc) returned undefined – trying raw source",
    );

    // Strategy 5: fallback — parse raw source text of the interface using
    // brace-balanced extraction so nested `}` inside method bodies don't truncate.
    try {
      const doc = await vscode.workspace.openTextDocument(iface.uri);
      const text = doc.getText();

      // Find the start of the interface declaration
      const headerRe = new RegExp(
        `type\\s+${iface.symbolName}\\s+interface\\s*\\{`,
      );
      const headerMatch = headerRe.exec(text);
      if (headerMatch) {
        // Walk forward counting braces to find the matching closing `}`
        let depth = 1;
        let i = headerMatch.index + headerMatch[0].length;
        while (i < text.length && depth > 0) {
          if (text[i] === "{") {
            depth++;
          } else if (text[i] === "}") {
            depth--;
          }
          i++;
        }
        const body = text.slice(
          headerMatch.index + headerMatch[0].length,
          i - 1,
        );
        console.log(
          `[go-assistant] Strategy 5 raw body (first 300): ${body.substring(0, 300)}`,
        );
        const methods = this.parseInterfaceBody(
          "type X interface {" + body + "}",
        );
        const stubs: string[] = [];
        for (const method of methods) {
          if (existingMethods.has(method.name)) {
            continue;
          }
          const returnSuffix = method.returns ? ` ${method.returns}` : "";
          stubs.push(
            `func (${receiverName} *${structName}) ${method.name}(${method.params})${returnSuffix} {\n\t//TODO implement me\n\tpanic("implement me")\n}`,
          );
        }
        console.log(`[go-assistant] Strategy 5 returned ${stubs.length} stubs`);
        return stubs.join("\n\n");
      }
    } catch (error) {
      console.error("[go-assistant] fallback raw source error:", error);
    }
    vscode.window.showErrorMessage(
      "Não foi possível encontrar métodos para a interface selecionada. Veja logs do Output > Extension Host para detalhes.",
    );
    return undefined;
  }

  /**
   * Strategy 1: Use the `impl` tool.
   */
  private async tryImplTool(
    document: vscode.TextDocument,
    structName: string,
    receiverName: string,
    qualifiedName: string,
    existingMethods: Set<string>,
  ): Promise<string | undefined> {
    if (this.implToolChecked && !this.implToolAvailable) {
      return undefined;
    }

    const cwd = path.dirname(document.uri.fsPath);

    // Add GOPATH/bin and GOROOT/bin to PATH so the `impl` binary is found
    const gopath = process.env.GOPATH || require("os").homedir() + "/go";
    const extraPaths = [`${gopath}/bin`, "/usr/local/go/bin", "/usr/local/bin"];
    const envPath = [...extraPaths, process.env.PATH || ""].join(":");

    return new Promise<string | undefined>((resolve) => {
      const cmd = `impl '${receiverName} *${structName}' ${qualifiedName}`;
      console.log(`[go-assistant] impl tool: running: ${cmd} (cwd=${cwd})`);
      cp.exec(
        cmd,
        { cwd, timeout: 15000, env: { ...process.env, PATH: envPath } },
        (err, stdout, stderr) => {
          if (err) {
            console.log(
              `[go-assistant] impl tool error: ${err.message}; stderr: ${stderr?.trim()}`,
            );
            if (!this.implToolChecked) {
              this.implToolChecked = true;
              this.implToolAvailable = false;
              console.log(
                "[go-assistant] impl tool not available, using fallback. Install: go install github.com/josharian/impl@latest",
              );
            }
            resolve(undefined);
            return;
          }

          this.implToolChecked = true;
          this.implToolAvailable = true;

          const output = stdout.trim();
          if (!output) {
            resolve("");
            return;
          }

          const filtered = this.filterAndCustomizeImplOutput(
            output,
            existingMethods,
          );
          resolve(filtered);
        },
      );
    });
  }

  /**
   * Strategy 2: Use gopls hover on the interface name to get the full definition,
   * then parse methods from the hover content.
   * gopls hover returns the full interface body including embedded interfaces (resolved).
   */
  private async generateFromHover(
    iface: InterfaceItem,
    structName: string,
    receiverName: string,
    existingMethods: Set<string>,
  ): Promise<string | undefined> {
    try {
      // Hover on the interface name position
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        iface.uri,
        iface.range.start,
      );

      if (!hovers || hovers.length === 0) {
        console.log(
          `[go-assistant] No hover for ${iface.qualifiedName} at ${iface.uri.fsPath}`,
        );
        return undefined;
      }

      // Extract the Go code block from hover content
      const hoverText = hovers
        .flatMap((h) =>
          h.contents.map((c) =>
            typeof c === "string" ? c : (c as vscode.MarkdownString).value,
          ),
        )
        .join("\n");

      console.log(
        `[go-assistant] Hover content for ${iface.qualifiedName} (${iface.uri.fsPath}:${iface.range.start.line}): ${hoverText.substring(0, 500)}`,
      );

      // gopls hover shows something like:
      // ```go
      // type Writer interface {
      //     Write(p []byte) (n int, err error)
      // }
      // ```
      const goBlockMatch = hoverText.match(/```go\n([\s\S]*?)```/);
      if (!goBlockMatch) {
        console.log(
          `[go-assistant] No Go code block in hover for ${iface.qualifiedName}. Full hover: ${hoverText.substring(0, 300)}`,
        );
        return undefined;
      }

      const goCode = goBlockMatch[1];
      console.log(
        `[go-assistant] Hover Go block for ${iface.qualifiedName}: ${goCode.substring(0, 300)}`,
      );

      // Check if it's actually an interface
      if (!goCode.includes("interface")) {
        console.log(
          `[go-assistant] Hover code block is not an interface for ${iface.qualifiedName}`,
        );
        return undefined;
      }

      // Parse methods from the interface definition
      const methods = this.parseInterfaceBody(goCode);

      if (methods.length === 0) {
        console.log(
          `[go-assistant] No methods parsed from hover for ${iface.qualifiedName}. Go code: ${goCode}`,
        );
        return undefined;
      }
      console.log(
        `[go-assistant] Hover parsed ${methods.length} methods: ${methods.map((m) => m.name).join(", ")}`,
      );

      const stubs: string[] = [];
      for (const method of methods) {
        if (existingMethods.has(method.name)) {
          continue;
        }
        const returnSuffix = method.returns ? ` ${method.returns}` : "";
        stubs.push(
          `func (${receiverName} *${structName}) ${method.name}(${method.params})${returnSuffix} {\n\t//TODO implement me\n\tpanic("implement me")\n}`,
        );
      }

      return stubs.length > 0 ? stubs.join("\n\n") : "";
    } catch (error) {
      console.error(
        `[go-assistant] Error in generateFromHover for ${iface.qualifiedName}:`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Strategy 3: Open the file, find interface by NAME (not range), read children.
   */
  private async generateFromDocumentSymbols(
    iface: InterfaceItem,
    structName: string,
    receiverName: string,
    existingMethods: Set<string>,
  ): Promise<string | undefined> {
    try {
      const doc = await vscode.workspace.openTextDocument(iface.uri);
      const docSymbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", iface.uri);

      if (!docSymbols) {
        return undefined;
      }

      // Find by NAME, not by range (much more reliable)
      const ifaceSymbol = this.findInterfaceByName(
        docSymbols,
        iface.symbolName,
      );
      if (!ifaceSymbol) {
        console.log(
          `[go-assistant] Could not find interface ${iface.symbolName} in document symbols`,
        );
        return undefined;
      }

      console.log(
        `[go-assistant] DocSymbols: found interface ${iface.symbolName} with ${ifaceSymbol.children?.length ?? 0} children`,
      );

      if (!ifaceSymbol.children || ifaceSymbol.children.length === 0) {
        console.log(
          `[go-assistant] Interface ${iface.symbolName} has no children symbols – falling back to source text parse`,
        );
        // Try parsing directly from source text
        const ifaceText = doc.getText(ifaceSymbol.range);
        console.log(
          `[go-assistant] Interface source text: ${ifaceText.substring(0, 200)}`,
        );
        const methods = this.parseInterfaceBody(ifaceText);

        if (methods.length === 0) {
          console.log(
            `[go-assistant] DocSymbols fallback: no methods parsed from source text`,
          );
          return undefined;
        }

        const stubs: string[] = [];
        for (const method of methods) {
          if (existingMethods.has(method.name)) {
            continue;
          }
          const returnSuffix = method.returns ? ` ${method.returns}` : "";
          stubs.push(
            `func (${receiverName} *${structName}) ${method.name}(${method.params})${returnSuffix} {\n\t//TODO implement me\n\tpanic("implement me")\n}`,
          );
        }
        return stubs.join("\n\n"); // empty string = already implemented
      }

      const stubs: string[] = [];

      for (const child of ifaceSymbol.children) {
        // Method or Function kinds both appear inside interface bodies in gopls
        if (
          child.kind === vscode.SymbolKind.Method ||
          child.kind === vscode.SymbolKind.Function
        ) {
          const lineText = doc.lineAt(child.range.start.line).text.trim();
          console.log(
            `[go-assistant] DocSymbols child method: kind=${vscode.SymbolKind[child.kind]} line="${lineText}"`,
          );
          const parsed = this.parseMethodSignature(lineText);
          if (parsed && !existingMethods.has(parsed.name)) {
            const returnSuffix = parsed.returns ? ` ${parsed.returns}` : "";
            stubs.push(
              `func (${receiverName} *${structName}) ${parsed.name}(${parsed.params})${returnSuffix} {\n\t//TODO implement me\n\tpanic("implement me")\n}`,
            );
          } else if (!parsed) {
            console.log(
              `[go-assistant] DocSymbols: could not parse method signature: "${lineText}"`,
            );
          }
        } else if (
          child.kind === vscode.SymbolKind.Interface ||
          child.kind === vscode.SymbolKind.Field
        ) {
          // Embedded interface — resolve via go-to-definition
          try {
            const definitions = await vscode.commands.executeCommand<
              vscode.Location[]
            >(
              "vscode.executeDefinitionProvider",
              doc.uri,
              child.selectionRange.start,
            );

            if (definitions && definitions.length > 0) {
              const def = definitions[0];
              const embeddedDoc = await vscode.workspace.openTextDocument(
                def.uri,
              );
              const embeddedSymbols = await vscode.commands.executeCommand<
                vscode.DocumentSymbol[]
              >("vscode.executeDocumentSymbolProvider", def.uri);
              if (embeddedSymbols) {
                const embeddedIface = this.findInterfaceByName(
                  embeddedSymbols,
                  child.name.includes(".")
                    ? child.name.split(".").pop()!
                    : child.name,
                );
                if (embeddedIface?.children) {
                  for (const method of embeddedIface.children) {
                    if (method.kind === vscode.SymbolKind.Method) {
                      const lineText = embeddedDoc
                        .lineAt(method.range.start.line)
                        .text.trim();
                      const parsed = this.parseMethodSignature(lineText);
                      if (parsed && !existingMethods.has(parsed.name)) {
                        const returnSuffix = parsed.returns
                          ? ` ${parsed.returns}`
                          : "";
                        stubs.push(
                          `func (${receiverName} *${structName}) ${parsed.name}(${parsed.params})${returnSuffix} {\n\t//TODO implement me\n\tpanic("implement me")\n}`,
                        );
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.log(
              `[go-assistant] Could not resolve embedded interface ${child.name}`,
            );
          }
        }
      }

      console.log(`[go-assistant] DocSymbols: generated ${stubs.length} stubs`);
      return stubs.join("\n\n"); // empty string = already implemented
    } catch (error) {
      console.error(
        `[go-assistant] Error in generateFromDocumentSymbols for ${iface.qualifiedName}:`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Strategy 4: go doc as last resort.
   */
  private async generateFromGoDoc(
    structName: string,
    receiverName: string,
    qualifiedName: string,
    existingMethods: Set<string>,
  ): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

      // go doc expects "pkg.Name" or "pkg Name" format
      console.log(
        `[go-assistant] go doc: running 'go doc ${qualifiedName}' in ${cwd}`,
      );
      cp.exec(
        `go doc ${qualifiedName}`,
        { cwd, timeout: 10000 },
        (err, stdout, stderr) => {
          if (err || !stdout) {
            console.log(
              `[go-assistant] go doc ${qualifiedName} failed:`,
              err?.message,
              "stderr:",
              stderr?.trim(),
            );
            resolve(undefined);
            return;
          }
          console.log(
            `[go-assistant] go doc output (first 300 chars): ${stdout.substring(0, 300)}`,
          );

          const methods = this.parseInterfaceBody(stdout);

          console.log(
            `[go-assistant] go doc: parsed ${methods.length} methods`,
          );
          if (methods.length === 0) {
            console.log(
              `[go-assistant] No methods parsed from go doc output for ${qualifiedName}. Output: ${stdout.substring(0, 200)}`,
            );
            resolve(undefined);
            return;
          }

          const stubs: string[] = [];
          for (const method of methods) {
            if (existingMethods.has(method.name)) {
              continue;
            }
            const returnSuffix = method.returns ? ` ${method.returns}` : "";
            stubs.push(
              `func (${receiverName} *${structName}) ${method.name}(${method.params})${returnSuffix} {\n\t//TODO implement me\n\tpanic("implement me")\n}`,
            );
          }

          resolve(stubs.length > 0 ? stubs.join("\n\n") : "");
        },
      );
    });
  }

  // ─── Parsing helpers ─────────────────────────────────────────────────

  /**
   * Parses an interface body text and extracts method signatures.
   * Handles the text from gopls hover, go doc, or raw source.
   *
   * Expected formats:
   *   type Writer interface {
   *       Write(p []byte) (n int, err error)
   *   }
   *
   * Also handles raw "Write(p []byte) (n int, err error)" lines.
   */
  private parseInterfaceBody(
    text: string,
  ): { name: string; params: string; returns: string }[] {
    const methods: { name: string; params: string; returns: string }[] = [];
    const lines = text.split("\n");

    let inInterface = false;
    let braceDepth = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Detect interface opening
      if (/\binterface\s*\{/.test(line)) {
        inInterface = true;
        braceDepth = 1;
        // Check if there's a method on the same line as the opening brace
        // (very unlikely but handle it)
        continue;
      }

      if (!inInterface) {
        continue;
      }

      // Track braces for nested types
      for (const ch of line) {
        if (ch === "{") {
          braceDepth++;
        }
        if (ch === "}") {
          braceDepth--;
        }
      }

      if (braceDepth <= 0) {
        break;
      }

      // Skip empty lines and comments
      if (!line || line.startsWith("//") || line.startsWith("/*")) {
        continue;
      }

      // Skip embedded interface references (lines without parentheses that
      // are just type names like "io.Reader" or "Reader")
      if (!line.includes("(")) {
        continue;
      }

      // Parse method signature
      const parsed = this.parseMethodSignature(line);
      if (parsed) {
        methods.push(parsed);
      }
    }

    return methods;
  }

  /**
   * Post-processes impl output: filters existing methods and adds TODO comments.
   */
  private filterAndCustomizeImplOutput(
    output: string,
    existingMethods: Set<string>,
  ): string {
    const methods = output.split(/\n(?=func\s)/);

    const filtered = methods
      .map((m) => m.trim())
      .filter((m) => {
        if (!m) {
          return false;
        }
        const nameMatch = m.match(/func\s+\([^)]+\)\s+(\w+)\s*\(/);
        if (nameMatch && existingMethods.has(nameMatch[1])) {
          return false;
        }
        return true;
      })
      .map((m) => {
        // Replace boilerplate panic with our TODO + panic pattern
        return m.replace(
          /\{\s*\n\s*panic\("not implemented"\)\s*\n\}/,
          '{\n\t//TODO implement me\n\tpanic("implement me")\n}',
        );
      });

    return filtered.join("\n\n");
  }

  /**
   * Parses a single method signature line.
   * e.g., "Read(p []byte) (n int, err error)" or "Write(p []byte) (n int, err error)"
   */
  private parseMethodSignature(
    line: string,
  ): { name: string; params: string; returns: string } | undefined {
    // Match: MethodName(  — the start of a method signature
    const match = line.match(/^(\w+)\s*\((.*)/);
    if (!match) {
      return undefined;
    }

    const name = match[1];
    // Skip keywords
    if (
      name === "type" ||
      name === "interface" ||
      name === "func" ||
      name === "struct"
    ) {
      return undefined;
    }

    const rest = match[2];

    // Find the closing paren for params (handle nested parens like func(int) params)
    let depth = 1;
    let i = 0;
    for (; i < rest.length; i++) {
      if (rest[i] === "(") {
        depth++;
      }
      if (rest[i] === ")") {
        depth--;
      }
      if (depth === 0) {
        break;
      }
    }

    const params = rest.substring(0, i);
    const returns = rest.substring(i + 1).trim();

    return { name, params, returns };
  }

  // ─── Symbol lookup helpers ────────────────────────────────────────────

  /**
   * Finds an interface DocumentSymbol by name (more reliable than by range).
   */
  private findInterfaceByName(
    symbols: vscode.DocumentSymbol[],
    name: string,
  ): vscode.DocumentSymbol | undefined {
    for (const sym of symbols) {
      if (sym.kind === vscode.SymbolKind.Interface && sym.name === name) {
        return sym;
      }
      if (sym.children) {
        const found = this.findInterfaceByName(sym.children, name);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  /**
   * Finds all existing methods of a struct by scanning the document.
   */
  private findExistingMethods(
    document: vscode.TextDocument,
    structName: string,
  ): Set<string> {
    const existing = new Set<string>();
    const text = document.getText();
    const escaped = structName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `func\\s+\\(\\s*\\w+\\s+\\*?${escaped}\\s*\\)\\s+(\\w+)`,
      "g",
    );
    let match;
    while ((match = pattern.exec(text)) !== null) {
      existing.add(match[1]);
    }
    return existing;
  }

  // ─── UI helpers ───────────────────────────────────────────────────────

  /**
   * Formats a file path for display in the QuickPick.
   */
  private formatFilePath(fsPath: string): string {
    // Shorten GOROOT paths
    if (fsPath.includes("/go/src/")) {
      const match = fsPath.match(/\/go\/src\/(.+)/);
      if (match) {
        return `stdlib: ${match[1]}`;
      }
    }

    // Shorten GOMODCACHE paths
    const modMatch = fsPath.match(/\/go\/pkg\/mod\/(.+)/);
    if (modMatch) {
      return `mod: ${modMatch[1]}`;
    }

    // Workspace-relative path
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        if (fsPath.startsWith(folder.uri.fsPath)) {
          return fsPath.substring(folder.uri.fsPath.length + 1);
        }
      }
    }

    return fsPath;
  }
}
