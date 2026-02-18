import * as path from "path";
import * as vscode from "vscode";

export class GoFileMoveHelper {
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Listen to file rename/move events
    this.disposables.push(
      vscode.workspace.onDidRenameFiles(async (event) => {
        await this.handleFileRename(event);
      }),
    );

    // Listen to folder rename events
    this.disposables.push(
      vscode.workspace.onWillRenameFiles(async (event) => {
        await this.prepareFileRename(event);
      }),
    );
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration("goHelper.helpers");
    return {
      autoUpdateImports: config.get<boolean>("autoUpdateImports", true),
      autoUpdateReferences: config.get<boolean>("autoUpdateReferences", true),
    };
  }

  private async prepareFileRename(
    event: vscode.FileWillRenameEvent,
  ): Promise<void> {
    const config = this.getConfig();
    if (!config.autoUpdateImports && !config.autoUpdateReferences) {
      return;
    }

    // Show progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Preparing to update Go imports and references...",
        cancellable: false,
      },
      async () => {
        // Analyze what will change
        for (const file of event.files) {
          if (file.oldUri.fsPath.endsWith(".go")) {
            await this.analyzeFileMove(file.oldUri, file.newUri);
          }
        }
      },
    );
  }

  private async handleFileRename(event: vscode.FileRenameEvent): Promise<void> {
    const config = this.getConfig();
    if (!config.autoUpdateImports && !config.autoUpdateReferences) {
      return;
    }

    const edit = new vscode.WorkspaceEdit();

    for (const file of event.files) {
      // Handle Go file moves
      if (file.oldUri.fsPath.endsWith(".go")) {
        await this.updateGoImports(file.oldUri, file.newUri, edit);
      }

      // Handle folder moves (update all Go files in folder)
      const oldStat = await vscode.workspace.fs.stat(file.newUri);
      if (oldStat.type === vscode.FileType.Directory) {
        await this.updateFolderImports(file.oldUri, file.newUri, edit);
      }
    }

    // Apply all edits
    if (edit.size > 0) {
      await vscode.workspace.applyEdit(edit);
      vscode.window.showInformationMessage("Updated Go imports and references");
    }
  }

  private async analyzeFileMove(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
  ): Promise<void> {
    // This could show a preview of what will change
    const oldPath = oldUri.fsPath;
    const newPath = newUri.fsPath;

    const oldDir = path.dirname(oldPath);
    const newDir = path.dirname(newPath);

    if (oldDir !== newDir) {
      // Package is changing
      const oldPkg = path.basename(oldDir);
      const newPkg = path.basename(newDir);

      console.log(`Package will change from ${oldPkg} to ${newPkg}`);
    }
  }

  private async updateGoImports(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    edit: vscode.WorkspaceEdit,
  ): Promise<void> {
    const oldPath = oldUri.fsPath;
    const newPath = newUri.fsPath;

    const oldDir = path.dirname(oldPath);
    const newDir = path.dirname(newPath);

    // If directory changed, update package declaration
    if (oldDir !== newDir) {
      const newPkg = path.basename(newDir);
      const document = await vscode.workspace.openTextDocument(newUri);
      const text = document.getText();

      // Update package declaration
      const pkgMatch = text.match(/^package\s+\w+/m);
      if (pkgMatch) {
        const range = new vscode.Range(
          document.positionAt(pkgMatch.index!),
          document.positionAt(pkgMatch.index! + pkgMatch[0].length),
        );
        edit.replace(newUri, range, `package ${newPkg}`);
      }
    }

    // Find all Go files that might import the moved file
    const allGoFiles = await vscode.workspace.findFiles(
      "**/*.go",
      "**/vendor/**",
    );

    for (const fileUri of allGoFiles) {
      if (fileUri.fsPath === newPath) {
        continue; // Skip the moved file itself
      }

      const document = await vscode.workspace.openTextDocument(fileUri);
      await this.updateImportsInFile(document, oldPath, newPath, edit);
    }
  }

  private async updateImportsInFile(
    document: vscode.TextDocument,
    oldPath: string,
    newPath: string,
    edit: vscode.WorkspaceEdit,
  ): Promise<void> {
    const text = document.getText();

    // Find go.mod to determine module path
    const goModPath = await this.findGoMod(document.uri);
    if (!goModPath) {
      return;
    }

    const goModContent = await vscode.workspace.fs.readFile(
      vscode.Uri.file(goModPath),
    );
    const moduleMatch = goModContent.toString().match(/^module\s+(.+)$/m);
    if (!moduleMatch) {
      return;
    }

    const moduleName = moduleMatch[1].trim();
    const goModDir = path.dirname(goModPath);

    // Calculate old and new import paths
    const oldRelPath = path.relative(goModDir, oldPath).replace(/\\/g, "/");
    const newRelPath = path.relative(goModDir, newPath).replace(/\\/g, "/");

    const oldImportPath = `${moduleName}/${path.dirname(oldRelPath)}`;
    const newImportPath = `${moduleName}/${path.dirname(newRelPath)}`;

    if (oldImportPath === newImportPath) {
      return; // No change needed
    }

    // Update import statements
    const importRegex = new RegExp(
      `"${oldImportPath.replace(/\//g, "\\/")}"`,
      "g",
    );
    let match;

    while ((match = importRegex.exec(text)) !== null) {
      const range = new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length),
      );
      edit.replace(document.uri, range, `"${newImportPath}"`);
    }
  }

  private async updateFolderImports(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    edit: vscode.WorkspaceEdit,
  ): Promise<void> {
    // Find all Go files in the renamed folder
    const pattern = new vscode.RelativePattern(newUri, "**/*.go");
    const files = await vscode.workspace.findFiles(pattern);

    for (const fileUri of files) {
      // Calculate old path
      const relativePath = path.relative(newUri.fsPath, fileUri.fsPath);
      const oldFilePath = path.join(oldUri.fsPath, relativePath);
      const oldFileUri = vscode.Uri.file(oldFilePath);

      await this.updateGoImports(oldFileUri, fileUri, edit);
    }
  }

  private async findGoMod(fileUri: vscode.Uri): Promise<string | null> {
    let currentDir = path.dirname(fileUri.fsPath);
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      const goModPath = path.join(currentDir, "go.mod");
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(goModPath));
        return goModPath;
      } catch {
        // go.mod not found, try parent directory
        currentDir = path.dirname(currentDir);
      }
    }

    return null;
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
