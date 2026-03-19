import * as vscode from "vscode";

interface GoSymbol {
  name: string;
  kind: vscode.SymbolKind;
  range: vscode.Range;
  selectionRange: vscode.Range;
  line: number;
}

interface Config {
  enable: boolean;
  references: boolean;
  methods: boolean;
  implementers: boolean;
  implementations: boolean;
  implementInterface: boolean;
  fields: boolean;
  packageImports: boolean;
  largeProject: boolean;
  runDebug: boolean;
  debugTests: boolean;
}

// Cache for large project mode
interface ReferenceCache {
  [key: string]: {
    locations: vscode.Location[];
    timestamp: number;
  };
}

export class GoCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> =
    this._onDidChangeCodeLenses.event;
  private referenceCache: ReferenceCache = {};
  private readonly CACHE_TTL = 30000; // 30 seconds
  private cachedConfig: Config | undefined;

  private isVerboseLoggingEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("goAssistant.logging")
      .get<boolean>("verbose", false);
  }

  private debugLog(message: string): void {
    if (this.isVerboseLoggingEnabled()) {
      console.log(message);
    }
  }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  public clearCache(): void {
    this.referenceCache = {};
    this.cachedConfig = undefined;
  }

  /**
   * Removes all entries that have passed their TTL.
   * Called on save to prevent the cache growing without bound when files change.
   */
  private pruneExpiredCache(): void {
    const now = Date.now();
    for (const key of Object.keys(this.referenceCache)) {
      if (now - this.referenceCache[key].timestamp >= this.CACHE_TTL) {
        delete this.referenceCache[key];
      }
    }
  }

  private getConfig(): Config {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }
    const config = vscode.workspace.getConfiguration("goAssistant.codelens");
    this.cachedConfig = {
      enable: config.get<boolean>("enable", true),
      references: config.get<boolean>("references", true),
      methods: config.get<boolean>("methods", true),
      implementers: config.get<boolean>("implementers", true),
      implementations: config.get<boolean>("implementations", true),
      implementInterface: config.get<boolean>("implementInterface", true),
      fields: config.get<boolean>("fields", false),
      packageImports: config.get<boolean>("packageImports", true),
      largeProject: config.get<boolean>("largeProject", false),
      runDebug: config.get<boolean>("runDebug", true),
      debugTests: config.get<boolean>("debugTests", true),
    };
    return this.cachedConfig;
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (document.languageId !== "go") {
      return [];
    }

    const config = this.getConfig();
    if (!config.enable) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];

    try {
      // Run / Debug main.go
      if (config.runDebug) {
        const mainLenses = await this.createMainLenses(document);
        codeLenses.push(...mainLenses);
      }

      if (token.isCancellationRequested) {
        return [];
      }

      // Debug table-driven tests
      if (config.debugTests) {
        const testLenses = await this.createTableDrivenTestLenses(document);
        codeLenses.push(...testLenses);
      }

      if (token.isCancellationRequested) {
        return [];
      }

      // Package imports CodeLens (show how many files import this package)
      if (config.packageImports) {
        const packageLens = await this.createPackageImportsLens(document);
        if (packageLens) {
          codeLenses.push(packageLens);
        }
      }

      if (token.isCancellationRequested) {
        return [];
      }

      const { symbols, rawSymbols: documentSymbols } =
        await this.getDocumentSymbols(document);

      if (token.isCancellationRequested) {
        return [];
      }

      for (const symbol of symbols) {
        if (token.isCancellationRequested) {
          return [];
        }
        if (this.isStruct(symbol)) {
          // References for struct
          if (config.references) {
            const referenceLens = await this.createReferenceLens(
              document,
              symbol,
            );
            if (referenceLens) {
              codeLenses.push(referenceLens);
            }
          }

          // Methods using this struct as receiver
          if (config.methods) {
            const methodLens = await this.createMethodReceiverLens(
              document,
              symbol,
            );
            if (methodLens) {
              codeLenses.push(methodLens);
            }
          }

          // Interfaces implemented by this struct
          if (config.implementations) {
            const implLens = await this.createImplementationsLens(
              document,
              symbol,
            );
            if (implLens) {
              codeLenses.push(implLens);
            }
          }

          // Implement Interface CodeLens
          if (config.implementInterface) {
            const implInterfaceLens = this.createImplementInterfaceLens(
              document,
              symbol,
            );
            codeLenses.push(implInterfaceLens);
          }

          // Move declaration CodeLens for structs (unified)
          const structMoveLens = await this.createUnifiedMoveLens(
            document,
            symbol,
            "struct",
          );
          if (structMoveLens) {
            codeLenses.push(structMoveLens);
          }
        } else if (this.isInterface(symbol)) {
          // References for interface
          if (config.references) {
            const referenceLens = await this.createReferenceLens(
              document,
              symbol,
            );
            if (referenceLens) {
              codeLenses.push(referenceLens);
            }
          }

          // Types implementing this interface
          if (config.implementers) {
            const implementersLens = await this.createImplementersLens(
              document,
              symbol,
            );
            if (implementersLens) {
              codeLenses.push(implementersLens);
            }
          }

          // For each method in the interface, show implementations
          if (documentSymbols) {
            const interfaceSymbol = this.findDocumentSymbol(
              documentSymbols,
              symbol.name,
              vscode.SymbolKind.Interface,
            );
            if (
              interfaceSymbol &&
              interfaceSymbol.children &&
              interfaceSymbol.children.length > 0
            ) {
              for (const method of interfaceSymbol.children) {
                if (method.kind === vscode.SymbolKind.Method) {
                  const methodImplLens =
                    await this.createInterfaceMethodImplementationsLens(
                      document,
                      method,
                      symbol.name,
                    );
                  if (methodImplLens) {
                    codeLenses.push(methodImplLens);
                  }
                }
              }
            }
          }

          // Move declaration CodeLens for interfaces
          const interfaceMoveLens = await this.createUnifiedMoveLens(
            document,
            symbol,
            "interface",
          );
          if (interfaceMoveLens) {
            codeLenses.push(interfaceMoveLens);
          }
        } else if (this.isMethod(symbol) || this.isFunction(symbol)) {
          // References for method/function (skip main function and test functions)
          const isTestFunction =
            symbol.name.startsWith("Test") ||
            symbol.name.startsWith("Benchmark") ||
            symbol.name.startsWith("Example");

          if (config.references && symbol.name !== "main" && !isTestFunction) {
            const referenceLens = await this.createReferenceLens(
              document,
              symbol,
            );
            if (referenceLens) {
              codeLenses.push(referenceLens);
            }
          }

          // Show which interfaces this method implements (before move)
          // Check both symbol.kind and actual code (gopls may classify as Function)
          // Skip interface methods - only concrete (struct) methods can "implement" an interface method
          const isIfaceMethod =
            documentSymbols?.some(
              (s) =>
                s.kind === vscode.SymbolKind.Interface &&
                s.children?.some(
                  (c) =>
                    c.kind === vscode.SymbolKind.Method &&
                    c.range.start.line === symbol.line,
                ),
            ) ?? false;

          if (
            !isIfaceMethod &&
            (this.isMethod(symbol) ||
              (await this.isMethodByCode(document, symbol)))
          ) {
            const interfaceImplementationsLens =
              await this.createMethodInterfaceImplementationsLens(
                document,
                symbol,
              );
            if (interfaceImplementationsLens) {
              codeLenses.push(interfaceImplementationsLens);
            }
          }

          // Move declaration CodeLens (unified)
          const moveLens = await this.createUnifiedMoveLens(
            document,
            symbol,
            this.isMethod(symbol) ? "method" : "function",
          );
          if (moveLens) {
            codeLenses.push(moveLens);
          }
        } else if (this.isField(symbol) && config.fields) {
          // References for fields (optional, can be slow)
          const referenceLens = await this.createReferenceLens(
            document,
            symbol,
          );
          if (referenceLens) {
            codeLenses.push(referenceLens);
          }
        } else if (this.isVariable(symbol) || this.isConstant(symbol)) {
          // References for top-level variables and constants
          if (config.references) {
            const referenceLens = await this.createReferenceLens(
              document,
              symbol,
            );
            if (referenceLens) {
              codeLenses.push(referenceLens);
            }
          }

          // Move declaration CodeLens (unified)
          const moveLens = await this.createUnifiedMoveLens(
            document,
            symbol,
            this.isVariable(symbol) ? "variable" : "constant",
          );
          if (moveLens) {
            codeLenses.push(moveLens);
          }
        }
      }
    } catch (error) {
      console.error("Error providing CodeLenses:", error);
    }

    return codeLenses;
  }

  private async getDocumentSymbols(
    document: vscode.TextDocument,
  ): Promise<{ symbols: GoSymbol[]; rawSymbols: vscode.DocumentSymbol[] }> {
    const symbols: GoSymbol[] = [];
    let rawSymbols: vscode.DocumentSymbol[] = [];

    try {
      const result = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (result) {
        rawSymbols = result;
        this.flattenSymbols(result, symbols);
      }
    } catch (error) {
      console.error("Error getting document symbols:", error);
    }

    return { symbols, rawSymbols };
  }

  private flattenSymbols(
    symbolsToFlatten: vscode.DocumentSymbol[],
    result: GoSymbol[],
  ): void {
    for (const symbol of symbolsToFlatten) {
      result.push({
        name: symbol.name,
        kind: symbol.kind,
        range: symbol.range,
        selectionRange: symbol.selectionRange,
        line: symbol.range.start.line,
      });

      if (symbol.children && symbol.children.length > 0) {
        this.flattenSymbols(symbol.children, result);
      }
    }
  }

  private findDocumentSymbol(
    symbols: vscode.DocumentSymbol[],
    name: string,
    kind: vscode.SymbolKind,
  ): vscode.DocumentSymbol | null {
    for (const symbol of symbols) {
      if (symbol.name === name && symbol.kind === kind) {
        return symbol;
      }
      if (symbol.children && symbol.children.length > 0) {
        const found = this.findDocumentSymbol(symbol.children, name, kind);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  private isStruct(symbol: GoSymbol): boolean {
    return (
      symbol.kind === vscode.SymbolKind.Struct ||
      symbol.kind === vscode.SymbolKind.Class
    );
  }

  private isInterface(symbol: GoSymbol): boolean {
    return symbol.kind === vscode.SymbolKind.Interface;
  }

  private isMethod(symbol: GoSymbol): boolean {
    return symbol.kind === vscode.SymbolKind.Method;
  }

  private async isMethodByCode(
    document: vscode.TextDocument,
    symbol: GoSymbol,
  ): Promise<boolean> {
    // Method = function with receiver: func (receiver Type) or func (receiver *Type)
    // Check the actual code to detect methods even if gopls classifies them as Function
    try {
      const line = document.lineAt(symbol.line);
      const text = line.text.trim();
      // Match: func (receiverName Type) or func (Type) methodName
      return /^func\s+\(\s*\w*\s*\*?\w+\s*\)\s+\w+/.test(text);
    } catch {
      return false;
    }
  }

  private isFunction(symbol: GoSymbol): boolean {
    return symbol.kind === vscode.SymbolKind.Function;
  }

  private isField(symbol: GoSymbol): boolean {
    return (
      symbol.kind === vscode.SymbolKind.Field ||
      symbol.kind === vscode.SymbolKind.Property
    );
  }

  private isVariable(symbol: GoSymbol): boolean {
    return symbol.kind === vscode.SymbolKind.Variable;
  }

  private isConstant(symbol: GoSymbol): boolean {
    return symbol.kind === vscode.SymbolKind.Constant;
  }

  private async createReferenceLens(
    document: vscode.TextDocument,
    symbol: GoSymbol,
    filterIndirectRefs: boolean = false,
  ): Promise<vscode.CodeLens | null> {
    try {
      // Use the selection range which points to the symbol name
      const position = symbol.selectionRange.start;
      const config = this.getConfig();
      const references = await this.findReferences(
        document,
        position,
        symbol.name,
        config.largeProject,
        filterIndirectRefs,
      );

      const count = references.length;
      const range = new vscode.Range(symbol.line, 0, symbol.line, 0);

      let title = `${count} ${count === 1 ? "referência" : "referências"}`;

      this.debugLog(`${symbol.name}: ${count} referências encontradas`);

      const codeLens = new vscode.CodeLens(range, {
        title: title,
        command: "go-assistant.showReferences",
        arguments: [document.uri, position, references],
      });

      return codeLens;
    } catch (error) {
      console.error(`Error creating reference lens for ${symbol.name}:`, error);
      return null;
    }
  }

  private async createMethodReceiverLens(
    document: vscode.TextDocument,
    symbol: GoSymbol,
  ): Promise<vscode.CodeLens | null> {
    try {
      const methods = await this.findMethodsWithReceiver(document, symbol.name);
      const count = methods.length;

      this.debugLog(`${symbol.name}: ${count} métodos encontrados`);

      if (count === 0) {
        return null;
      }

      const range = new vscode.Range(symbol.line, 0, symbol.line, 0);
      let title = `${count} ${count === 1 ? "método" : "métodos"}`;

      const codeLens = new vscode.CodeLens(range, {
        title: title,
        command: "go-assistant.showReferences",
        arguments: [document.uri, symbol.selectionRange.start, methods],
      });

      return codeLens;
    } catch (error) {
      console.error(
        `Error creating method receiver lens for ${symbol.name}:`,
        error,
      );
      return null;
    }
  }

  private async createImplementersLens(
    document: vscode.TextDocument,
    symbol: GoSymbol,
  ): Promise<vscode.CodeLens | null> {
    try {
      const implementers = await this.findImplementations(document, symbol);
      const count = implementers.length;

      if (count === 0) {
        return null;
      }

      const range = new vscode.Range(symbol.line, 0, symbol.line, 0);
      let title = `${count} ${count === 1 ? "implementador" : "implementadores"}`;

      const codeLens = new vscode.CodeLens(range, {
        title: title,
        command: "go-assistant.showReferences",
        arguments: [document.uri, symbol.selectionRange.start, implementers],
      });

      return codeLens;
    } catch (error) {
      console.error(
        `Error creating implementers lens for ${symbol.name}:`,
        error,
      );
      return null;
    }
  }

  private createImplementInterfaceLens(
    document: vscode.TextDocument,
    symbol: GoSymbol,
  ): vscode.CodeLens {
    const range = new vscode.Range(symbol.line, 0, symbol.line, 0);
    return new vscode.CodeLens(range, {
      title: "implementar interface",
      command: "go-assistant.implementInterface",
      arguments: [document.uri, symbol.name, symbol.range.end.line],
    });
  }

  private async createImplementationsLens(
    document: vscode.TextDocument,
    symbol: GoSymbol,
  ): Promise<vscode.CodeLens | null> {
    try {
      const implementations = await this.findTypeDefinitions(document, symbol);
      const count = implementations.length;

      if (count === 0) {
        return null;
      }

      const range = new vscode.Range(symbol.line, 0, symbol.line, 0);
      let title = `implementa ${count} ${count === 1 ? "interface" : "interfaces"}`;

      const codeLens = new vscode.CodeLens(range, {
        title: title,
        command: "go-assistant.showReferences",
        arguments: [document.uri, symbol.selectionRange.start, implementations],
      });

      return codeLens;
    } catch (error) {
      console.error(
        `Error creating implementations lens for ${symbol.name}:`,
        error,
      );
      return null;
    }
  }

  private async findReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbolName: string,
    useLargeProjectMode: boolean = false,
    filterIndirectRefs: boolean = false,
  ): Promise<vscode.Location[]> {
    try {
      // Generate cache key
      const cacheKey = `${document.uri.toString()}:${position.line}:${position.character}:${symbolName}`;

      // Check cache if large project mode is enabled
      if (useLargeProjectMode && this.referenceCache[cacheKey]) {
        const cached = this.referenceCache[cacheKey];
        const now = Date.now();

        // Use cached value if not expired
        if (now - cached.timestamp < this.CACHE_TTL) {
          console.log(
            `Using cached references for ${symbolName} (${cached.locations.length} refs)`,
          );
          if (filterIndirectRefs && cached.locations.length > 0) {
            return this.filterIndirectReferences(
              document,
              position,
              cached.locations,
            );
          }
          return cached.locations;
        } else {
          // Remove expired cache entry
          delete this.referenceCache[cacheKey];
        }
      }

      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        document.uri,
        position,
      );

      // Filter out the definition itself (only keep actual references)
      const filtered =
        locations?.filter((loc) => {
          // Exclude if it's the exact same location as the definition
          return !(
            loc.uri.toString() === document.uri.toString() &&
            loc.range.start.line === position.line &&
            loc.range.start.character === position.character
          );
        }) || [];

      // Cache result if large project mode is enabled
      if (useLargeProjectMode && filtered.length > 0) {
        this.pruneExpiredCache();
        this.referenceCache[cacheKey] = {
          locations: filtered,
          timestamp: Date.now(),
        };
      }

      // For methods: filter out interface-mediated references
      // gopls includes calls through interfaces when finding references for concrete methods
      if (filterIndirectRefs && filtered.length > 0) {
        return this.filterIndirectReferences(document, position, filtered);
      }

      return filtered;
    } catch (error) {
      console.error(`Error finding references for ${symbolName}:`, error);
      return [];
    }
  }

  private async filterIndirectReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    references: vscode.Location[],
  ): Promise<vscode.Location[]> {
    // For each reference, check if "go to definition" points back to the original method.
    // If it points elsewhere (e.g. an interface method), the reference is indirect.
    const checks = await Promise.all(
      references.map(async (ref) => {
        try {
          const defs = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeDefinitionProvider",
            ref.uri,
            ref.range.start,
          );

          if (!defs || defs.length === 0) {
            return true;
          }

          // Keep only if definition points back to the original method position
          return defs.some(
            (d) =>
              d.uri.toString() === document.uri.toString() &&
              d.range.start.line === position.line,
          );
        } catch {
          return true;
        }
      }),
    );

    return references.filter((_, i) => checks[i]);
  }

  private async findMethodsWithReceiver(
    document: vscode.TextDocument,
    structName: string,
  ): Promise<vscode.Location[]> {
    const methods: vscode.Location[] = [];
    const seenLines = new Set<number>();

    try {
      // Use gopls document symbols - methods are children of their receiver type
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return methods;
      }

      // 1. Check children of the struct symbol (gopls normally nests methods under their receiver)
      for (const symbol of symbols) {
        if (
          symbol.name === structName &&
          (symbol.kind === vscode.SymbolKind.Struct ||
            symbol.kind === vscode.SymbolKind.Class)
        ) {
          if (symbol.children) {
            for (const child of symbol.children) {
              // Include both Method and Function kinds - gopls may classify
              // methods without receiver names (e.g. protoc-gen) as Function
              if (
                child.kind === vscode.SymbolKind.Method ||
                child.kind === vscode.SymbolKind.Function
              ) {
                seenLines.add(child.range.start.line);
                methods.push(new vscode.Location(document.uri, child.range));
              }
            }
          }
          break;
        }
      }

      // 2. Also check top-level symbols - gopls may place methods without receiver
      // variable names (e.g. protoc-gen) as top-level symbols, not nested under the struct
      const escapedName = structName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const receiverRegex = new RegExp(
        `^func\\s+\\(\\s*\\w*\\s*\\*?${escapedName}\\s*\\)\\s+\\w+`,
      );

      for (const symbol of symbols) {
        if (
          (symbol.kind === vscode.SymbolKind.Method ||
            symbol.kind === vscode.SymbolKind.Function) &&
          !seenLines.has(symbol.range.start.line)
        ) {
          try {
            const lineText = document
              .lineAt(symbol.range.start.line)
              .text.trim();
            if (receiverRegex.test(lineText)) {
              seenLines.add(symbol.range.start.line);
              methods.push(new vscode.Location(document.uri, symbol.range));
            }
          } catch {
            // skip lines that can't be read
          }
        }
      }
    } catch (error) {
      console.error(`Error finding methods for ${structName}:`, error);
    }

    return methods;
  }

  private async findImplementations(
    document: vscode.TextDocument,
    symbol: GoSymbol,
  ): Promise<vscode.Location[]> {
    try {
      const position = symbol.selectionRange.start;
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeImplementationProvider",
        document.uri,
        position,
      );

      if (!locations || locations.length === 0) {
        return [];
      }

      // Deduplicate - gopls can return multiple locations for pointer vs value receiver
      const seen = new Set<string>();
      const unique: vscode.Location[] = [];

      for (const loc of locations) {
        const key = `${loc.uri.toString()}:${loc.range.start.line}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(loc);
        }
      }

      // Filter out interfaces - only keep concrete types (structs)
      // gopls returns both concrete types and other interfaces with matching method sets
      const concreteTypes: vscode.Location[] = [];

      for (const loc of unique) {
        const docSymbols = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[]
        >("vscode.executeDocumentSymbolProvider", loc.uri);

        if (docSymbols) {
          let isInterface = false;
          for (const sym of docSymbols) {
            if (
              sym.kind === vscode.SymbolKind.Interface &&
              sym.range.contains(loc.range.start)
            ) {
              isInterface = true;
              break;
            }
          }
          if (!isInterface) {
            concreteTypes.push(loc);
          }
        } else {
          // If we can't get symbols, include it
          concreteTypes.push(loc);
        }
      }

      console.log(
        `[Interface ${symbol.name}] Found ${concreteTypes.length} concrete implementations (${locations.length} total from gopls, ${unique.length} unique)`,
      );

      return concreteTypes;
    } catch (error) {
      console.error(`Error finding implementations for ${symbol.name}:`, error);
      return [];
    }
  }

  private async findTypeDefinitions(
    document: vscode.TextDocument,
    symbol: GoSymbol,
  ): Promise<vscode.Location[]> {
    try {
      // Use gopls implementation provider - on a concrete type,
      // it returns the interfaces it implements (bidirectional in gopls)
      const position = symbol.selectionRange.start;
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeImplementationProvider",
        document.uri,
        position,
      );

      if (!locations || locations.length === 0) {
        console.log(
          `[Struct ${symbol.name}] No interfaces found via ImplementationProvider`,
        );
        return [];
      }

      // Filter: keep only interfaces (not the struct itself or other concrete types)
      const interfaces: vscode.Location[] = [];
      const seen = new Set<string>();

      for (const loc of locations) {
        // Skip the struct itself
        if (
          loc.uri.toString() === document.uri.toString() &&
          loc.range.start.line === symbol.line
        ) {
          continue;
        }

        const key = `${loc.uri.toString()}:${loc.range.start.line}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        // Verify this location is actually an interface
        const docSymbols = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[]
        >("vscode.executeDocumentSymbolProvider", loc.uri);

        if (docSymbols) {
          for (const sym of docSymbols) {
            if (
              sym.kind === vscode.SymbolKind.Interface &&
              sym.range.contains(loc.range.start)
            ) {
              interfaces.push(new vscode.Location(loc.uri, sym.range));
              break;
            }
          }
        }
      }

      this.debugLog(
        `[Struct ${symbol.name}] Implements ${interfaces.length} interfaces (${locations.length} total from gopls)`,
      );

      return interfaces;
    } catch (error) {
      console.error(
        `Error finding type definitions for ${symbol.name}:`,
        error,
      );
      return [];
    }
  }

  private async createMainLenses(
    document: vscode.TextDocument,
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();

    if (!/^package\s+main\b/m.test(text)) {
      return lenses;
    }

    const mainFuncMatch = /^func\s+main\s*\(\s*\)/m.exec(text);
    if (!mainFuncMatch) {
      return lenses;
    }

    const line = document.positionAt(mainFuncMatch.index).line;
    const range = new vscode.Range(line, 0, line, 0);
    const filePath = document.uri.fsPath;

    lenses.push(
      new vscode.CodeLens(range, {
        title: "▶ Run",
        command: "go-assistant.runMain",
        tooltip: "Run main.go",
        arguments: [filePath],
      }),
    );

    lenses.push(
      new vscode.CodeLens(range, {
        title: "▶ Debug",
        command: "go-assistant.debugMain",
        tooltip: "Debug main.go",
        arguments: [filePath],
      }),
    );

    return lenses;
  }

  private async createTableDrivenTestLenses(
    document: vscode.TextDocument,
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    try {
      const text = document.getText();
      const filePath = document.uri.fsPath;

      // Match ALL test functions: TestXxx, BenchmarkXxx, ExampleXxx
      const testFuncRegex =
        /func\s+((?:Test|Benchmark|Example)[A-Z]\w*)\s*\(\s*(?:t\s+\*testing\.T|b\s+\*testing\.B|)\s*\)/g;
      let testMatch: RegExpExecArray | null;

      while ((testMatch = testFuncRegex.exec(text)) !== null) {
        const testName = testMatch[1];
        const testLine = document.positionAt(testMatch.index).line;

        // ▶ Run button on the test function declaration line
        lenses.push(
          new vscode.CodeLens(new vscode.Range(testLine, 0, testLine, 0), {
            title: "▶ Run",
            command: "go-assistant.runTestWithOptions",
            tooltip: "Run, Debug or Profile this test",
            arguments: [{ testName, filePath }],
          }),
        );

        // Extract function body with brace counting
        const braceStart = text.indexOf(
          "{",
          testMatch.index + testMatch[0].length,
        );
        if (braceStart === -1) {
          continue;
        }

        let depth = 1,
          pos = braceStart + 1;
        while (pos < text.length && depth > 0) {
          if (text[pos] === "{") {
            depth++;
          } else if (text[pos] === "}") {
            depth--;
          }
          pos++;
        }
        const bodyText = text.slice(braceStart + 1, pos - 1);
        const bodyOffset = braceStart + 1;

        // Detect table-driven by finding t.Run(loopVar.fieldName, ...) pattern.
        // This is exactly how GoLand detects it — from the t.Run call itself,
        // not by hardcoding a "name" field assumption.
        const tRunMatch = bodyText.match(/\b(?:t|b)\.Run\(\s*(\w+)\.(\w+)\s*,/);
        if (!tRunMatch) {
          continue;
        } // not table-driven

        const loopVar = tRunMatch[1]; // e.g. "tt" or "tc"
        const nameField = tRunMatch[2]; // e.g. "name" (or whatever field the user chose)

        // Find the range variable: for _, loopVar := range rangeVar
        const rangeRe = new RegExp(
          `for\\s+(?:[\\w]+\\s*,\\s*)?${loopVar}\\s*:=\\s*range\\s+(\\w+)`,
        );
        const rangeMatch = bodyText.match(rangeRe);

        // Find the VALUES block that holds the test cases
        let caseSearchText = bodyText;
        let caseSearchOffset = bodyOffset;

        if (rangeMatch?.[1]) {
          const rangeVar = rangeMatch[1];
          // Find definition: rangeVar := ... or var rangeVar = ...
          const defRe = new RegExp(`(?:var\\s+)?\\b${rangeVar}\\b\\s*:?=\\s*`);
          const defMatch = defRe.exec(bodyText);
          if (defMatch) {
            const valuesBlock = this.findValuesBlock(
              bodyText,
              defMatch.index + defMatch[0].length,
              nameField,
            );
            if (valuesBlock) {
              caseSearchText = valuesBlock.text;
              caseSearchOffset = bodyOffset + valuesBlock.offset;
            }
          }
        }

        // Extract each top-level case entry and its name
        const caseEntries = this.extractCaseEntries(
          caseSearchText,
          caseSearchOffset,
          nameField,
          document,
        );

        const usedLines = new Set<number>();
        for (const entry of caseEntries) {
          usedLines.add(entry.line);
          lenses.push(
            new vscode.CodeLens(
              new vscode.Range(entry.line, 0, entry.line, 0),
              {
                title: "▶ Run",
                command: "go-assistant.runSubTestFromCode",
                tooltip: `Run / Debug / Profile: ${testName}/${entry.name}`,
                arguments: [{ testName, subTestName: entry.name, filePath }],
              },
            ),
          );
        }

        // Also handle map[string]...: "key": { ... } style table tests
        const mapKeyRe = /"([^"\\]+)"\s*:\s*\{/g;
        let mk: RegExpExecArray | null;
        while ((mk = mapKeyRe.exec(caseSearchText)) !== null) {
          const absOffset = caseSearchOffset + mk.index;
          const caseLine = document.positionAt(absOffset).line;
          if (usedLines.has(caseLine)) {
            continue;
          }
          const caseName = mk[1];
          lenses.push(
            new vscode.CodeLens(new vscode.Range(caseLine, 0, caseLine, 0), {
              title: "▶ Run",
              command: "go-assistant.runSubTestFromCode",
              tooltip: `Run / Debug / Profile: ${testName}/${caseName}`,
              arguments: [{ testName, subTestName: caseName, filePath }],
            }),
          );
        }
      }
    } catch (error) {
      console.error("Error creating test lenses:", error);
    }

    return lenses;
  }

  /**
   * Find the VALUES block `{ cases... }` (not a type definition block).
   * Scans forward from `fromIndex`, skipping type-definition `{...}` blocks,
   * until it finds one whose content contains `nameField: "..."` at depth 1.
   */
  private findValuesBlock(
    text: string,
    fromIndex: number,
    nameField: string,
  ): { text: string; offset: number } | null {
    const nameRe = new RegExp(`\\b${nameField}\\s*:\\s*"`);
    let i = fromIndex;

    while (i < text.length) {
      if (text[i] === "{") {
        // Measure this block
        let d = 1,
          j = i + 1;
        while (j < text.length && d > 0) {
          if (text[j] === "{") {
            d++;
          } else if (text[j] === "}") {
            d--;
          }
          j++;
        }
        const blockContent = text.slice(i + 1, j - 1);
        if (nameRe.test(blockContent)) {
          // This block directly contains cases with nameField — it's the values block
          return { text: blockContent, offset: i + 1 };
        }
        // Skip this block (it's a type definition: struct{...} or map[K]struct{...})
        i = j;
        continue;
      }
      i++;
    }
    return null;
  }

  /**
   * Walk `valuesText` at depth 0 collecting top-level `{ ... }` entries.
   * For each entry, if it contains `nameField: "value"` at any depth, add it.
   * The lens is placed on the line of the opening `{` of each case entry.
   */
  private extractCaseEntries(
    valuesText: string,
    valuesOffset: number,
    nameField: string,
    document: vscode.TextDocument,
  ): Array<{ name: string; line: number }> {
    const entries: Array<{ name: string; line: number }> = [];
    const nameRe = new RegExp(`\\b${nameField}\\s*:\\s*"([^"\\\\]+)"`);
    let depth = 0;
    let caseStart = -1;

    for (let i = 0; i < valuesText.length; i++) {
      const c = valuesText[i];
      if (c === "{") {
        if (depth === 0) {
          caseStart = i;
        }
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0 && caseStart !== -1) {
          const caseContent = valuesText.slice(caseStart + 1, i);
          const nfMatch = nameRe.exec(caseContent);
          if (nfMatch) {
            const absOffset = valuesOffset + caseStart;
            entries.push({
              name: nfMatch[1],
              line: document.positionAt(absOffset).line,
            });
          }
          caseStart = -1;
        }
      }
    }

    return entries;
  }

  private async createPackageImportsLens(
    document: vscode.TextDocument,
  ): Promise<vscode.CodeLens | null> {
    try {
      const packageInfo = await this.getPackageInfo(document);
      if (!packageInfo) {
        return null;
      }

      const imports = await this.findPackageImports(packageInfo.importPath);
      const count = imports.length;

      if (count === 0) {
        return null;
      }

      // Place CodeLens on package declaration line
      const range = new vscode.Range(packageInfo.line, 0, packageInfo.line, 0);
      const title = `${count} ${count === 1 ? "import" : "imports"}`;

      const codeLens = new vscode.CodeLens(range, {
        title: title,
        command: "go-assistant.showReferences",
        arguments: [
          document.uri,
          new vscode.Position(packageInfo.line, 0),
          imports,
        ],
      });

      return codeLens;
    } catch (error) {
      console.error("Error creating package imports lens:", error);
      return null;
    }
  }

  private async getPackageInfo(
    document: vscode.TextDocument,
  ): Promise<{ importPath: string; line: number; packageName: string } | null> {
    // Find package declaration
    const text = document.getText();
    const packageMatch = text.match(/^package\s+(\w+)/m);

    if (!packageMatch) {
      return null;
    }

    const packageName = packageMatch[1];
    const packageLine = document.positionAt(packageMatch.index!).line;

    // Don't show for main package
    if (packageName === "main") {
      return null;
    }

    // Get the import path for this package
    const importPath = await this.getImportPath(document);
    if (!importPath) {
      return null;
    }

    return {
      importPath,
      line: packageLine,
      packageName,
    };
  }

  private async getImportPath(
    document: vscode.TextDocument,
  ): Promise<string | null> {
    try {
      const { getGoModuleRoot } = await import("./goModFinder.js");
      const moduleRoot = await getGoModuleRoot(document.uri.fsPath);

      if (!moduleRoot) {
        return null;
      }

      // Read go.mod to get module name
      const fs = await import("fs");
      const path = await import("path");
      const goModPath = path.join(moduleRoot, "go.mod");
      const goModContent = await fs.promises.readFile(goModPath, "utf-8");
      const moduleMatch = goModContent.match(/^module\s+(.+)$/m);

      if (!moduleMatch) {
        return null;
      }

      const moduleName = moduleMatch[1].trim();

      // Calculate relative path from module root to package directory
      const packageDir = path.dirname(document.uri.fsPath);
      const relativePath = path.relative(moduleRoot, packageDir);

      if (!relativePath || relativePath === ".") {
        return moduleName;
      }

      // Normalize path separators to forward slashes (Go import paths always use /)
      const normalizedPath = relativePath.split(path.sep).join("/");
      return `${moduleName}/${normalizedPath}`;
    } catch (error) {
      console.error("Error getting import path:", error);
      return null;
    }
  }

  private async findPackageImports(
    importPath: string,
  ): Promise<vscode.Location[]> {
    const imports: vscode.Location[] = [];

    try {
      // Search for import statements in all Go files
      const files = await vscode.workspace.findFiles("**/*.go", "**/vendor/**");

      for (const file of files) {
        try {
          const document = await vscode.workspace.openTextDocument(file);
          const text = document.getText();

          // Match various import styles:
          // import "path"
          // import ( "path" )
          // import alias "path"
          const importRegex = new RegExp(
            `import\\s+(?:[\\w_]+\\s+)?"${importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
            "g",
          );
          const multiLineRegex = new RegExp(
            `^\\s*(?:[\\w_]+\\s+)?"${importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
            "gm",
          );

          let match;

          // Check single-line imports
          while ((match = importRegex.exec(text)) !== null) {
            const pos = document.positionAt(match.index);
            imports.push(new vscode.Location(file, pos));
          }

          // Check multi-line imports (inside import ( ... ))
          const importBlockRegex = /import\s*\(\s*([\s\S]*?)\s*\)/g;
          let blockMatch;

          while ((blockMatch = importBlockRegex.exec(text)) !== null) {
            const blockContent = blockMatch[1];
            const blockStart =
              blockMatch.index + blockMatch[0].indexOf(blockContent);

            let lineMatch;
            while ((lineMatch = multiLineRegex.exec(blockContent)) !== null) {
              const pos = document.positionAt(blockStart + lineMatch.index);
              imports.push(new vscode.Location(file, pos));
            }
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }
    } catch (error) {
      console.error("Error finding package imports:", error);
    }

    return imports;
  }

  private async createUnifiedMoveLens(
    document: vscode.TextDocument,
    symbol: GoSymbol,
    symbolType:
      | "struct"
      | "method"
      | "function"
      | "interface"
      | "variable"
      | "constant",
  ): Promise<vscode.CodeLens | null> {
    try {
      return new vscode.CodeLens(symbol.selectionRange, {
        title: "move",
        command: "go-assistant.unifiedMove",
        arguments: [document.uri, symbol, symbolType],
      });
    } catch (error) {
      console.error("Error creating unified move lens:", error);
      return null;
    }
  }

  private async createMethodInterfaceImplementationsLens(
    document: vscode.TextDocument,
    symbol: GoSymbol,
  ): Promise<vscode.CodeLens | null> {
    try {
      // Find which interfaces this method implements
      const interfaces = await this.findInterfacesImplementedByMethod(
        document,
        symbol,
      );

      if (interfaces.length === 0) {
        return null;
      }

      const count = interfaces.length;
      const title =
        count === 1
          ? `implementa método de ${count} interface`
          : `implementa método de ${count} interfaces`;

      return new vscode.CodeLens(symbol.selectionRange, {
        title: title,
        command: "go-assistant.showMethodInterfaces",
        arguments: [document.uri, symbol, interfaces],
      });
    } catch (error) {
      console.error(
        "Error creating method interface implementations lens:",
        error,
      );
      return null;
    }
  }

  private async findInterfacesImplementedByMethod(
    document: vscode.TextDocument,
    methodSymbol: GoSymbol,
  ): Promise<vscode.Location[]> {
    try {
      // Use gopls implementation provider - on a concrete method,
      // it returns the interface methods it satisfies (bidirectional in gopls)
      const position = methodSymbol.selectionRange.start;
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeImplementationProvider",
        document.uri,
        position,
      );

      if (!locations || locations.length === 0) {
        this.debugLog(
          `[Method ${methodSymbol.name}] No interface methods found via ImplementationProvider`,
        );
        return [];
      }

      this.debugLog(
        `[Method ${methodSymbol.name}] ImplementationProvider returned ${locations.length} locations`,
      );

      // Filter: keep only locations inside interfaces, then get parent interface
      const interfaceLocations: vscode.Location[] = [];
      const seenInterfaces = new Set<string>();

      for (const location of locations) {
        // Skip if it's the method itself
        if (
          location.uri.toString() === document.uri.toString() &&
          location.range.start.line === methodSymbol.line
        ) {
          continue;
        }

        // Get symbols in the target file
        const symbols = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[]
        >("vscode.executeDocumentSymbolProvider", location.uri);

        if (!symbols) {
          continue;
        }

        // Find the parent interface containing this method
        for (const symbol of symbols) {
          if (symbol.kind === vscode.SymbolKind.Interface && symbol.children) {
            const containsMethod = symbol.children.some(
              (child) =>
                child.kind === vscode.SymbolKind.Method &&
                child.range.contains(location.range.start),
            );

            if (containsMethod) {
              const key = `${location.uri.toString()}:${symbol.range.start.line}`;
              if (!seenInterfaces.has(key)) {
                seenInterfaces.add(key);
                interfaceLocations.push(
                  new vscode.Location(location.uri, symbol.range),
                );
                this.debugLog(
                  `[Method ${methodSymbol.name}] Implements interface: ${symbol.name}`,
                );
              }
            }
          }
        }
      }

      this.debugLog(
        `[Method ${methodSymbol.name}] Returning ${interfaceLocations.length} interfaces`,
      );

      return interfaceLocations;
    } catch (error) {
      console.error("Error finding interfaces implemented by method:", error);
      return [];
    }
  }

  private async createInterfaceMethodImplementationsLens(
    document: vscode.TextDocument,
    method: vscode.DocumentSymbol,
    interfaceName: string,
  ): Promise<vscode.CodeLens | null> {
    try {
      // Find all structs in the workspace that implement this interface method
      const implementations = await this.findMethodImplementations(
        document,
        method.name,
        interfaceName,
      );

      if (implementations.length === 0) {
        return null;
      }

      const count = implementations.length;
      const title = `${count} ${count === 1 ? "implementação" : "implementações"}`;

      return new vscode.CodeLens(method.selectionRange, {
        title: title,
        command: "go-assistant.showReferences",
        arguments: [document.uri, method.selectionRange.start, implementations],
      });
    } catch (error) {
      console.error(
        "Error creating interface method implementations lens:",
        error,
      );
      return null;
    }
  }

  private async findMethodImplementations(
    document: vscode.TextDocument,
    methodName: string,
    interfaceName: string,
  ): Promise<vscode.Location[]> {
    try {
      // Use gopls' implementation provider to find proper implementations
      // This respects interface boundaries and type checking
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return [];
      }

      // Find the interface and method
      let targetMethod: vscode.DocumentSymbol | null = null;
      for (const symbol of symbols) {
        if (
          symbol.kind === vscode.SymbolKind.Interface &&
          symbol.name === interfaceName
        ) {
          if (symbol.children) {
            for (const method of symbol.children) {
              if (method.name === methodName) {
                targetMethod = method;
                break;
              }
            }
          }
          if (targetMethod) {
            break;
          }
        }
      }

      if (!targetMethod) {
        return [];
      }

      // Use gopls to find implementations of this specific interface method
      const position = targetMethod.selectionRange.start;
      const implementations = await vscode.commands.executeCommand<
        vscode.Location[]
      >("vscode.executeImplementationProvider", document.uri, position);

      if (!implementations || implementations.length === 0) {
        return [];
      }

      // Deduplicate implementations based on file+line
      // gopls can return multiple locations for pointer vs value receiver
      const seen = new Set<string>();
      const unique: vscode.Location[] = [];

      for (const impl of implementations) {
        const key = `${impl.uri.toString()}:${impl.range.start.line}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(impl);
        }
      }

      // Filter out interface methods - only keep concrete (struct) method implementations
      // gopls returns both concrete implementations and methods in other interfaces
      const concreteImpls: vscode.Location[] = [];

      for (const loc of unique) {
        const docSymbols = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[]
        >("vscode.executeDocumentSymbolProvider", loc.uri);

        if (docSymbols) {
          let isInterfaceMethod = false;
          for (const sym of docSymbols) {
            if (
              sym.kind === vscode.SymbolKind.Interface &&
              sym.children?.some(
                (c) =>
                  c.kind === vscode.SymbolKind.Method &&
                  c.range.contains(loc.range.start),
              )
            ) {
              isInterfaceMethod = true;
              break;
            }
          }
          if (!isInterfaceMethod) {
            concreteImpls.push(loc);
          }
        } else {
          concreteImpls.push(loc);
        }
      }

      console.log(
        `[Interface ${interfaceName}.${methodName}] Found ${concreteImpls.length} concrete implementations (${implementations.length} total from gopls, ${unique.length} unique)`,
      );

      return concreteImpls;
    } catch (error) {
      console.error("Error finding method implementations:", error);
      return [];
    }
  }

  resolveCodeLens(
    codeLens: vscode.CodeLens,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeLens> {
    return codeLens;
  }
}
