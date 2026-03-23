import * as path from "path";
import * as vscode from "vscode";

export class GoModCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): Promise<vscode.CodeAction[] | undefined> {
    if (!this.isGoModDocument(document)) {
      return undefined;
    }

    const dependencyPath = this.getDependencyPathAtPosition(
      document,
      range.start,
    );

    if (!dependencyPath) {
      return undefined;
    }

    const whyAction = new vscode.CodeAction(
      `Go mod why -m ${dependencyPath}`,
      vscode.CodeActionKind.QuickFix,
    );
    whyAction.command = {
      command: "go-assistant.goModWhyDependency",
      title: "Go mod why -m",
      arguments: [document.uri, dependencyPath],
    };

    const updateAction = new vscode.CodeAction(
      `Update dependency (${dependencyPath})`,
      vscode.CodeActionKind.QuickFix,
    );
    updateAction.command = {
      command: "go-assistant.goModUpdateDependency",
      title: "Update dependency",
      arguments: [document.uri, dependencyPath],
    };

    return [whyAction, updateAction];
  }

  private isGoModDocument(document: vscode.TextDocument): boolean {
    if (path.basename(document.uri.fsPath) === "go.mod") {
      return true;
    }

    return document.languageId === "go.mod";
  }

  private getDependencyPathAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string | undefined {
    const lineText = document.lineAt(position.line).text;
    const trimmed = lineText.trim();

    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      trimmed === "(" ||
      trimmed === ")"
    ) {
      return undefined;
    }

    if (
      trimmed.startsWith("module ") ||
      trimmed.startsWith("go ") ||
      trimmed.startsWith("toolchain ") ||
      trimmed.startsWith("replace ") ||
      trimmed.startsWith("exclude ") ||
      trimmed.startsWith("retract ")
    ) {
      return undefined;
    }

    const inlineRequire = trimmed.match(/^require\s+(\S+)\s+\S+/);
    if (inlineRequire?.[1]) {
      return inlineRequire[1];
    }

    const blockRequire = trimmed.match(/^(\S+)\s+(v\S+)/);
    if (blockRequire?.[1] && blockRequire[2].startsWith("v")) {
      return blockRequire[1];
    }

    return undefined;
  }
}
