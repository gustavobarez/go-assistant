import * as vscode from "vscode";

interface Config {
  enable: boolean;
  buildTags: boolean;
  unhandledErrors: boolean;
}

export class GoInlayHintsProvider implements vscode.InlayHintsProvider {
  private _onDidChangeInlayHints: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  public readonly onDidChangeInlayHints: vscode.Event<void> =
    this._onDidChangeInlayHints.event;

  public refresh(): void {
    this._onDidChangeInlayHints.fire();
  }

  private getConfig(): Config {
    const config = vscode.workspace.getConfiguration("goHelper.inlayHints");
    const inspectionsConfig = vscode.workspace.getConfiguration(
      "goHelper.inspections",
    );
    return {
      enable: config.get<boolean>("enable", false),
      buildTags: config.get<boolean>("buildTags", true),
      unhandledErrors: false, // Feature removed
    };
  }

  async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlayHint[]> {
    const config = this.getConfig();
    if (document.languageId !== "go") {
      return [];
    }

    const hints: vscode.InlayHint[] = [];

    try {
      // Unhandled errors feature removed per user request

      // Only check other hints if explicitly enabled
      if (!config.enable) {
        return hints;
      }

      // Build tag diagnostics
      if (config.buildTags) {
        const buildTagHints = await this.createBuildTagHints(document);
        hints.push(...buildTagHints);
      }

      //
      // Get document symbols
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (!symbols) {
        return hints;
      }

      // Process symbols and create hints
      for (const symbol of symbols) {
        await this.processSymbolForHints(document, symbol, hints, range);
      }
    } catch (error) {
      console.error("Error providing inlay hints:", error);
    }

    return hints;
  }

  private async processSymbolForHints(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
    hints: vscode.InlayHint[],
    range: vscode.Range,
  ): Promise<void> {
    // Check if symbol is in range
    if (!range.intersection(symbol.range)) {
      return;
    }

    // Create hint for functions, methods, structs, interfaces
    if (this.shouldShowHintFor(symbol)) {
      try {
        const position = symbol.selectionRange.end;
        const references = await this.getReferences(
          document,
          symbol.selectionRange.start,
        );

        if (references > 0) {
          const hint = new vscode.InlayHint(
            position,
            ` (${references} refs)`,
            vscode.InlayHintKind.Type,
          );
          hint.paddingLeft = true;
          hints.push(hint);
        }
      } catch (error) {
        console.error(`Error creating hint for ${symbol.name}:`, error);
      }
    }

    // Process children
    if (symbol.children) {
      for (const child of symbol.children) {
        await this.processSymbolForHints(document, child, hints, range);
      }
    }
  }

  private shouldShowHintFor(symbol: vscode.DocumentSymbol): boolean {
    return (
      symbol.kind === vscode.SymbolKind.Function ||
      symbol.kind === vscode.SymbolKind.Method ||
      symbol.kind === vscode.SymbolKind.Struct ||
      symbol.kind === vscode.SymbolKind.Class ||
      symbol.kind === vscode.SymbolKind.Interface
    );
  }

  private async getReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<number> {
    try {
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        document.uri,
        position,
      );

      return locations?.length || 0;
    } catch (error) {
      return 0;
    }
  }

  private async createBuildTagHints(
    document: vscode.TextDocument,
  ): Promise<vscode.InlayHint[]> {
    const hints: vscode.InlayHint[] = [];

    try {
      const text = document.getText();
      const lines = text.split("\n");

      // Find build tags (//go:build or // +build)
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i];

        // Match //go:build syntax (preferred)
        const goBuildMatch = line.match(/^\/\/go:build\s+(.+)$/);
        if (goBuildMatch) {
          const buildExpr = goBuildMatch[1].trim();
          const status = this.evaluateBuildTag(buildExpr);

          const hint = new vscode.InlayHint(
            new vscode.Position(i, line.length),
            status.satisfied
              ? " ✓ (will build)"
              : ` ✗ (won't build: ${status.reason})`,
            vscode.InlayHintKind.Type,
          );
          hint.paddingLeft = true;
          hints.push(hint);
        }

        // Match // +build syntax (legacy)
        const plusBuildMatch = line.match(/^\/\/\s*\+build\s+(.+)$/);
        if (plusBuildMatch) {
          const buildTags = plusBuildMatch[1].trim();
          const hint = new vscode.InlayHint(
            new vscode.Position(i, line.length),
            " ⚠️ (use //go:build instead)",
            vscode.InlayHintKind.Type,
          );
          hint.paddingLeft = true;
          hints.push(hint);
        }
      }
    } catch (error) {
      console.error("Error creating build tag hints:", error);
    }

    return hints;
  }

  private evaluateBuildTag(expr: string): {
    satisfied: boolean;
    reason: string;
  } {
    // Get current OS and architecture from environment
    const os = process.platform; // darwin, linux, win32
    const arch = process.arch; // x64, arm64, etc.

    // Map Node.js platform names to Go GOOS names
    const goOS =
      os === "win32" ? "windows" : os === "darwin" ? "darwin" : "linux";
    const goArch = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : arch;

    // Simple evaluation (supports basic AND, OR, NOT)
    const normalizedExpr = expr.toLowerCase();

    // Check for NOT operator
    if (normalizedExpr.includes("!")) {
      const negatedTags = normalizedExpr.match(/!(\w+)/g);
      if (negatedTags) {
        for (const tag of negatedTags) {
          const tagName = tag.substring(1);
          if (tagName === goOS || tagName === goArch) {
            return { satisfied: false, reason: `excluded ${tagName}` };
          }
        }
      }
    }

    // Check for AND operator
    if (normalizedExpr.includes("&&")) {
      const tags = normalizedExpr.split("&&").map((t) => t.trim());
      for (const tag of tags) {
        if (tag.startsWith("!")) {
          const tagName = tag.substring(1);
          if (tagName === goOS || tagName === goArch) {
            return { satisfied: false, reason: `excluded ${tagName}` };
          }
        } else if (tag !== goOS && tag !== goArch && !this.isCommonTag(tag)) {
          return {
            satisfied: false,
            reason: `requires ${tag} (current: ${goOS}/${goArch})`,
          };
        }
      }
      return { satisfied: true, reason: "" };
    }

    // Check for OR operator
    if (normalizedExpr.includes("||")) {
      const tags = normalizedExpr.split("||").map((t) => t.trim());
      const hasMatch = tags.some(
        (tag) => tag === goOS || tag === goArch || this.isCommonTag(tag),
      );
      if (!hasMatch) {
        return {
          satisfied: false,
          reason: `requires one of: ${tags.join(", ")} (current: ${goOS}/${goArch})`,
        };
      }
      return { satisfied: true, reason: "" };
    }

    // Single tag
    if (normalizedExpr === goOS || normalizedExpr === goArch) {
      return { satisfied: true, reason: "" };
    }

    // Common tags that are usually satisfied
    if (this.isCommonTag(normalizedExpr)) {
      return { satisfied: true, reason: "" };
    }

    return {
      satisfied: false,
      reason: `requires ${normalizedExpr} (current: ${goOS}/${goArch})`,
    };
  }

  private isCommonTag(tag: string): boolean {
    // Tags that are commonly satisfied or don't affect compilation
    const commonTags = ["gc", "go1.", "cgo", "unix", "race", "msan", "asan"];
    return commonTags.some((t) => tag.includes(t));
  }
}
