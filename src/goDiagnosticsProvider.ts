import * as vscode from "vscode";

export class GoDiagnosticsProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("go-helper");

    // Listen to document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "go") {
          this.updateDiagnostics(e.document);
        }
      }),
    );

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === "go") {
          this.updateDiagnostics(document);
        }
      }),
    );

    // Analyze all open documents
    vscode.workspace.textDocuments.forEach((document) => {
      if (document.languageId === "go") {
        this.updateDiagnostics(document);
      }
    });
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration("goHelper.inspections");
    return {
      enable: config.get<boolean>("enable", true),
      unusedSymbols: config.get<boolean>("unusedSymbols", false), // Disabled by default (gopls does this)
      unhandledErrors: config.get<boolean>("unhandledErrors", true),
      deprecatedSymbols: config.get<boolean>("deprecatedSymbols", false), // Only if vscode-go isn't installed
    };
  }

  private async updateDiagnostics(
    document: vscode.TextDocument,
  ): Promise<void> {
    const config = this.getConfig();
    if (!config.enable) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split("\n");

    // Check for unhandled errors
    if (config.unhandledErrors) {
      diagnostics.push(...this.checkUnhandledErrors(document, lines));
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private checkUnhandledErrors(
    document: vscode.TextDocument,
    lines: string[],
  ): vscode.Diagnostic[] {
    // Disabled - moved to inlay hints for better UX
    return [];
  }

  public dispose(): void {
    this.diagnosticCollection.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
