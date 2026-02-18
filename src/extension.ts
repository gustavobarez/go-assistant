// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { GoCodeActionProvider } from "./goCodeActionProvider";
import { GoCodeLensProvider } from "./goCodeLensProvider";
import { GoCoverageDecorator } from "./goCoverageDecorator";
import { GoDiagnosticsProvider } from "./goDiagnosticsProvider";
import { GoFileMoveHelper } from "./goFileMoveHelper";
import { GoInlayHintsProvider } from "./goInlayHintsProvider";
import { GoInlineValuesProvider } from "./goInlineValuesProvider";
import { findGoModForWorkspace, getGoModuleRoot } from "./goModFinder";
import { GoPostfixCompletionProvider } from "./goPostfixCompletionProvider";
import { GoProtoCodeLensProvider } from "./goProtoCodeLensProvider";
import { GoReferencesViewProvider, SymbolInfo } from "./goReferencesView";
import { GoTestsViewProvider } from "./goTestsView";

/**
 * Helper function to get symbol information at a position
 */
async function getSymbolAtPosition(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<SymbolInfo | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >("vscode.executeDocumentSymbolProvider", uri);

    if (!symbols) {
      return undefined;
    }

    // Find symbol at position
    const findSymbol = (
      syms: vscode.DocumentSymbol[],
    ): vscode.DocumentSymbol | undefined => {
      for (const symbol of syms) {
        if (symbol.range.contains(position)) {
          // Check children first (more specific)
          if (symbol.children && symbol.children.length > 0) {
            const child = findSymbol(symbol.children);
            if (child && child.selectionRange.contains(position)) {
              return child;
            }
          }
          // If the selection range contains the position, this is our symbol
          if (symbol.selectionRange.contains(position)) {
            return symbol;
          }
        }
      }
      return undefined;
    };

    const symbol = findSymbol(symbols);
    if (symbol) {
      return {
        name: symbol.name,
        kind: symbol.kind,
        location: new vscode.Location(uri, symbol.selectionRange),
      };
    }
  } catch (error) {
    console.error("Error getting symbol at position:", error);
  }
  return undefined;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("Go Helper extension is now active!");

  // Initialize References View Provider
  const referencesViewProvider = new GoReferencesViewProvider();
  const referencesView = vscode.window.createTreeView("goHelperReferences", {
    treeDataProvider: referencesViewProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(referencesView);

  // Set context when view has references
  vscode.commands.executeCommand("setContext", "goHelper.hasReferences", false);

  // Initialize Tests View Provider
  const testsViewProvider = new GoTestsViewProvider();
  const testsView = vscode.window.createTreeView("goHelperTests", {
    treeDataProvider: testsViewProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(testsView);

  // Discover tests on activation
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  if (workspacePath) {
    testsViewProvider.discoverTests(workspacePath);
  }

  // Initialize Coverage Decorator
  const coverageDecorator = new GoCoverageDecorator();
  context.subscriptions.push(coverageDecorator);

  // Apply decorations when editor changes
  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor && editor.document.languageId === "go") {
        coverageDecorator.applyDecorationsToEditor(editor);
      }
    },
    null,
    context.subscriptions,
  );

  // Apply decorations when visible editors change
  vscode.window.onDidChangeVisibleTextEditors(
    () => {
      coverageDecorator.applyDecorationsToAllEditors();
    },
    null,
    context.subscriptions,
  );

  // Set context when view has references
  vscode.commands.executeCommand("setContext", "goHelper.hasReferences", false);

  // Initialize CodeLens provider for Go files
  const codeLensProvider = new GoCodeLensProvider();
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    { language: "go", scheme: "file" },
    codeLensProvider,
  );

  // Initialize CodeLens provider for Protocol Buffer files
  const protoCodeLensProvider = new GoProtoCodeLensProvider();
  const protoCodeLensDisposable = vscode.languages.registerCodeLensProvider(
    { pattern: "**/*.proto", scheme: "file" },
    protoCodeLensProvider,
  );

  // Initialize Inlay Hints provider for Go files
  const inlayHintsProvider = new GoInlayHintsProvider();
  const inlayHintsDisposable = vscode.languages.registerInlayHintsProvider(
    { language: "go", scheme: "file" },
    inlayHintsProvider,
  );

  // Initialize Postfix Completion provider for Go files
  const postfixCompletionProvider = new GoPostfixCompletionProvider();
  const postfixCompletionDisposable =
    vscode.languages.registerCompletionItemProvider(
      { language: "go", scheme: "file" },
      postfixCompletionProvider,
      ".", // Trigger character
    );

  // Initialize Code Action provider for Go files
  const codeActionProvider = new GoCodeActionProvider();
  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    { language: "go", scheme: "file" },
    codeActionProvider,
    {
      providedCodeActionKinds: GoCodeActionProvider.providedCodeActionKinds,
    },
  );

  // Initialize Diagnostics provider for Go files
  const diagnosticsProvider = new GoDiagnosticsProvider();

  // Initialize Inline Values provider for debugging
  const inlineValuesProvider = new GoInlineValuesProvider();
  const inlineValuesDisposable = vscode.languages.registerInlineValuesProvider(
    { language: "go", scheme: "file" },
    inlineValuesProvider,
  );

  // Initialize File Move Helper
  const fileMoveHelper = new GoFileMoveHelper();

  // Register command to show references
  const showReferencesCommand = vscode.commands.registerCommand(
    "go-helper.showReferences",
    async (
      uri: vscode.Uri,
      position: vscode.Position,
      locations: vscode.Location[],
      title?: string,
    ) => {
      if (locations && locations.length > 0) {
        // Get symbol information at position
        const symbolInfo = await getSymbolAtPosition(uri, position);

        // Show in custom References view
        const displayTitle = title || "References";
        referencesViewProvider.showReferences(
          displayTitle,
          locations,
          symbolInfo,
        );

        // Set context to show the view
        vscode.commands.executeCommand(
          "setContext",
          "goHelper.hasReferences",
          true,
        );

        // Reveal the view
        await vscode.commands.executeCommand("goHelperReferences.focus");

        // Optionally also show in default view (commented out - remove comment to enable both)
        // await vscode.commands.executeCommand(
        //   "editor.action.showReferences",
        //   uri,
        //   position,
        //   locations,
        // );
      } else {
        vscode.window.showInformationMessage("Nenhuma referência encontrada");
      }
    },
  );

  // Register command to show implementations
  const showImplementationsCommand = vscode.commands.registerCommand(
    "go-helper.showImplementations",
    async (uri: vscode.Uri, position: vscode.Position) => {
      try {
        const locations = await vscode.commands.executeCommand<
          vscode.Location[]
        >("vscode.executeImplementationProvider", uri, position);

        if (locations && locations.length > 0) {
          // Get symbol information at position
          const symbolInfo = await getSymbolAtPosition(uri, position);

          referencesViewProvider.showReferences(
            "Implementations",
            locations,
            symbolInfo,
          );
          vscode.commands.executeCommand(
            "setContext",
            "goHelper.hasReferences",
            true,
          );
          await vscode.commands.executeCommand("goHelperReferences.focus");
        } else {
          vscode.window.showInformationMessage(
            "Nenhuma implementação encontrada",
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          "Erro ao buscar implementações: " + error,
        );
      }
    },
  );

  // Register command to show implementers (types that implement an interface)
  const showImplementersCommand = vscode.commands.registerCommand(
    "go-helper.showImplementers",
    async (
      uri: vscode.Uri,
      position: vscode.Position,
      locations?: vscode.Location[],
      title?: string,
    ) => {
      // Get symbol information at position
      const symbolInfo = await getSymbolAtPosition(uri, position);

      // If locations are provided, use them directly
      if (locations && locations.length > 0) {
        const displayTitle = title || "Implementers";
        referencesViewProvider.showReferences(
          displayTitle,
          locations,
          symbolInfo,
        );
        vscode.commands.executeCommand(
          "setContext",
          "goHelper.hasReferences",
          true,
        );
        await vscode.commands.executeCommand("goHelperReferences.focus");
      } else {
        // Otherwise, try to find implementations
        try {
          const foundLocations = await vscode.commands.executeCommand<
            vscode.Location[]
          >("vscode.executeImplementationProvider", uri, position);

          if (foundLocations && foundLocations.length > 0) {
            referencesViewProvider.showReferences(
              "Implementers",
              foundLocations,
              symbolInfo,
            );
            vscode.commands.executeCommand(
              "setContext",
              "goHelper.hasReferences",
              true,
            );
            await vscode.commands.executeCommand("goHelperReferences.focus");
          } else {
            vscode.window.showInformationMessage(
              "Nenhum implementador encontrado",
            );
          }
        } catch (error) {
          vscode.window.showErrorMessage(
            "Erro ao buscar implementadores: " + error,
          );
        }
      }
    },
  );

  // Register command to clear references view
  const clearReferencesViewCommand = vscode.commands.registerCommand(
    "go-helper.clearReferencesView",
    () => {
      referencesViewProvider.clear();
      vscode.commands.executeCommand(
        "setContext",
        "goHelper.hasReferences",
        false,
      );
    },
  );

  // Register command to refresh references view
  const refreshReferencesViewCommand = vscode.commands.registerCommand(
    "go-helper.refreshReferencesView",
    () => {
      referencesViewProvider.refresh();
    },
  );

  // Register command to discover tests
  const discoverTestsCommand = vscode.commands.registerCommand(
    "go-helper.discoverTests",
    async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (workspacePath) {
        await testsViewProvider.discoverTests(workspacePath);
        const count = testsViewProvider.getTotalTestCount();
        vscode.window.showInformationMessage(
          `Discovered ${count} test${count !== 1 ? "s" : ""}`,
        );
      }
    },
  );

  // Register command to run all tests
  const runAllTestsCommand = vscode.commands.registerCommand(
    "go-helper.runAllTests",
    async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!workspacePath) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: "Go Tests",
        cwd: workspacePath,
      });
      terminal.show();

      // Run tests with coverage
      const { exec } = require("child_process");
      const path = require("path");
      const coverageFile = path.join(workspacePath, "coverage.out");

      exec(
        "go test -coverprofile=coverage.out ./...",
        { cwd: workspacePath },
        (error: any, stdout: string, stderr: string) => {
          // Load and display coverage after tests complete
          setTimeout(() => {
            coverageDecorator
              .loadCoverageFromFile(coverageFile)
              .then((loaded) => {
                if (loaded) {
                  coverageDecorator.applyDecorationsToAllEditors();
                  vscode.window.showInformationMessage(
                    "Coverage applied to all files",
                  );
                }
              });
          }, 500);
        },
      );

      terminal.sendText("go test -coverprofile=coverage.out ./...");
    },
  );

  // Register command to run all tests with coverage
  const runAllTestsWithCoverageCommand = vscode.commands.registerCommand(
    "go-helper.runAllTestsWithCoverage",
    async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!workspacePath) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: "Go Tests (Shared Coverage)",
        cwd: workspacePath,
      });
      terminal.show();

      // Run tests with coverage and detailed package info
      const { exec } = require("child_process");
      const path = require("path");
      const coverageFile = path.join(workspacePath, "coverage.out");

      exec(
        "go test -coverprofile=coverage.out -coverpkg=./... ./...",
        { cwd: workspacePath },
        (error: any, stdout: string, stderr: string) => {
          // Load and display coverage after tests complete
          setTimeout(() => {
            coverageDecorator
              .loadCoverageFromFile(coverageFile)
              .then((loaded) => {
                if (loaded) {
                  coverageDecorator.applyDecorationsToAllEditors();
                  vscode.window.showInformationMessage(
                    "Coverage applied to all files",
                  );
                }
              });
          }, 500);
        },
      );

      terminal.sendText(
        "go test -coverprofile=coverage.out -coverpkg=./... ./...",
      );
    },
  );

  // Register command to run package tests
  const runPackageTestsCommand = vscode.commands.registerCommand(
    "go-helper.runPackageTests",
    async (item: any) => {
      if (!item?.packageInfo) {
        vscode.window.showErrorMessage("Invalid package selection");
        return;
      }

      const packagePath = item.packageInfo.packagePath;

      // Mark all tests in package as running
      for (const file of item.packageInfo.files) {
        for (const test of file.tests) {
          testsViewProvider.updateTestStatus(test.name, packagePath, "running");
        }
      }

      const terminal = vscode.window.createTerminal({
        name: `Go Tests - ${item.packageInfo.packageName}`,
        cwd: packagePath,
      });
      terminal.show();

      // Run tests with coverage and capture results
      const { exec } = require("child_process");
      const path = require("path");
      const coverageFile = path.join(packagePath, "coverage.out");

      exec(
        "go test -v -coverprofile=coverage.out",
        { cwd: packagePath },
        (error: any, stdout: string, stderr: string) => {
          const output = stdout + stderr;

          // Parse individual test results
          for (const file of item.packageInfo.files) {
            for (const test of file.tests) {
              const passMatch = new RegExp(`--- PASS: ${test.name}`, "m").test(
                output,
              );
              const failMatch = new RegExp(`--- FAIL: ${test.name}`, "m").test(
                output,
              );

              if (passMatch) {
                testsViewProvider.updateTestStatus(
                  test.name,
                  packagePath,
                  "pass",
                );
              } else if (failMatch) {
                testsViewProvider.updateTestStatus(
                  test.name,
                  packagePath,
                  "fail",
                );
              } else {
                testsViewProvider.updateTestStatus(
                  test.name,
                  packagePath,
                  "unknown",
                );
              }
            }
          }

          // Load and display coverage
          setTimeout(() => {
            coverageDecorator
              .loadCoverageFromFile(coverageFile)
              .then((loaded) => {
                if (loaded) {
                  coverageDecorator.applyDecorationsToAllEditors();
                  vscode.window.showInformationMessage(
                    "Coverage applied to editors",
                  );
                }
              });
          }, 500);
        },
      );

      terminal.sendText("go test -v -coverprofile=coverage.out");
    },
  );

  // Register command to run file tests
  const runFileTestsCommand = vscode.commands.registerCommand(
    "go-helper.runFileTests",
    async (item: any) => {
      if (!item?.fileInfo) {
        vscode.window.showErrorMessage("Invalid file selection");
        return;
      }

      const packagePath = item.fileInfo.packagePath;
      const fileName = require("path").basename(item.fileInfo.file);

      // Mark all tests in file as running
      for (const test of item.fileInfo.tests) {
        testsViewProvider.updateTestStatus(test.name, packagePath, "running");
      }

      const terminal = vscode.window.createTerminal({
        name: `Go Tests - ${fileName}`,
        cwd: packagePath,
      });
      terminal.show();

      // Run tests with coverage and capture results
      const { exec } = require("child_process");
      const path = require("path");
      const testPattern = `^(${item.fileInfo.tests.map((t: any) => t.name).join("|")})$`;
      const coverageFile = path.join(packagePath, "coverage.out");

      exec(
        `go test -v -coverprofile=coverage.out -run "${testPattern}"`,
        { cwd: packagePath },
        (error: any, stdout: string, stderr: string) => {
          const output = stdout + stderr;

          // Parse individual test results
          for (const test of item.fileInfo.tests) {
            const passMatch = new RegExp(`--- PASS: ${test.name}`, "m").test(
              output,
            );
            const failMatch = new RegExp(`--- FAIL: ${test.name}`, "m").test(
              output,
            );

            if (passMatch) {
              testsViewProvider.updateTestStatus(
                test.name,
                packagePath,
                "pass",
              );
            } else if (failMatch) {
              testsViewProvider.updateTestStatus(
                test.name,
                packagePath,
                "fail",
              );
            } else {
              testsViewProvider.updateTestStatus(
                test.name,
                packagePath,
                "unknown",
              );
            }
          }

          // Load and display coverage
          setTimeout(() => {
            coverageDecorator
              .loadCoverageFromFile(coverageFile)
              .then((loaded) => {
                if (loaded) {
                  coverageDecorator.applyDecorationsToAllEditors();
                  vscode.window.showInformationMessage(
                    "Coverage applied to editors",
                  );
                }
              });
          }, 500);
        },
      );

      terminal.sendText(
        `go test -v -coverprofile=coverage.out -run "${testPattern}"`,
      );
    },
  );

  // Register command to run single test
  const runTestCommand = vscode.commands.registerCommand(
    "go-helper.runTest",
    async (item: any) => {
      if (!item?.testInfo) {
        vscode.window.showErrorMessage("Invalid test selection");
        return;
      }

      const testName = item.testInfo.name;
      const packagePath = item.testInfo.packagePath;

      // Mark test as running
      testsViewProvider.updateTestStatus(testName, packagePath, "running");

      const terminal = vscode.window.createTerminal({
        name: `Go Test - ${testName}`,
        cwd: packagePath,
      });
      terminal.show();

      // Run test with coverage and capture result
      const { exec } = require("child_process");
      const path = require("path");
      const coverageFile = path.join(packagePath, "coverage.out");

      exec(
        `go test -v -coverprofile=coverage.out -run "^${testName}$"`,
        { cwd: packagePath },
        (error: any, stdout: string, stderr: string) => {
          const output = stdout + stderr;

          // Determine test result
          if (error) {
            testsViewProvider.updateTestStatus(testName, packagePath, "fail");
          } else if (output.includes("PASS") || output.includes("ok\t")) {
            testsViewProvider.updateTestStatus(testName, packagePath, "pass");
          } else {
            testsViewProvider.updateTestStatus(
              testName,
              packagePath,
              "unknown",
            );
          }

          // Load and display coverage
          setTimeout(() => {
            coverageDecorator
              .loadCoverageFromFile(coverageFile)
              .then((loaded) => {
                if (loaded) {
                  coverageDecorator.applyDecorationsToAllEditors();
                  vscode.window.showInformationMessage(
                    "Coverage applied to editors",
                  );
                }
              });
          }, 500);
        },
      );

      // Send command to terminal for display
      terminal.sendText(
        `go test -v -coverprofile=coverage.out -run "^${testName}$"`,
      );
    },
  );

  // Register command to debug package tests
  const debugPackageTestsCommand = vscode.commands.registerCommand(
    "go-helper.debugPackageTests",
    async (item: any) => {
      if (!item?.packageInfo) {
        vscode.window.showErrorMessage("Invalid package selection");
        return;
      }

      const packagePath = item.packageInfo.packagePath;
      await vscode.debug.startDebugging(undefined, {
        type: "go",
        name: `Debug Package Tests - ${item.packageInfo.packageName}`,
        request: "launch",
        mode: "test",
        program: packagePath,
      });
    },
  );

  // Register command to debug file tests
  const debugFileTestsCommand = vscode.commands.registerCommand(
    "go-helper.debugFileTests",
    async (item: any) => {
      if (!item?.fileInfo) {
        vscode.window.showErrorMessage("Invalid file selection");
        return;
      }

      const packagePath = item.fileInfo.packagePath;
      const testPattern = `^(${item.fileInfo.tests.map((t: any) => t.name).join("|")})$`;
      await vscode.debug.startDebugging(undefined, {
        type: "go",
        name: `Debug File Tests`,
        request: "launch",
        mode: "test",
        program: packagePath,
        args: ["-test.run", testPattern],
      });
    },
  );

  // Register command to debug single test
  const debugTestCommand = vscode.commands.registerCommand(
    "go-helper.debugTest",
    async (item: any) => {
      if (!item?.testInfo) {
        vscode.window.showErrorMessage("Invalid test selection");
        return;
      }

      const testName = item.testInfo.name;
      const packagePath = item.testInfo.packagePath;
      await vscode.debug.startDebugging(undefined, {
        type: "go",
        name: `Debug Test - ${testName}`,
        request: "launch",
        mode: "test",
        program: packagePath,
        args: ["-test.run", `^${testName}$`],
      });
    },
  );

  // Register command to open coverage HTML
  const openCoverageHtmlCommand = vscode.commands.registerCommand(
    "go-helper.openCoverageHtml",
    async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!workspacePath) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      const fs = require("fs");
      const path = require("path");
      const coverageFile = path.join(workspacePath, "coverage.out");

      if (!fs.existsSync(coverageFile)) {
        vscode.window.showErrorMessage(
          "No coverage.out file found. Run tests with coverage first.",
        );
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: "Go Coverage",
        cwd: workspacePath,
      });
      terminal.show();
      terminal.sendText("go tool cover -html=coverage.out");
    },
  );

  // Register command to clear coverage decorations
  const clearCoverageCommand = vscode.commands.registerCommand(
    "go-helper.clearCoverage",
    async () => {
      coverageDecorator.clearDecorations();
      vscode.window.showInformationMessage("Coverage decorations cleared");
    },
  );

  // Register command to add import
  const addImportCommand = vscode.commands.registerCommand(
    "go-helper.addImport",
    async (uri: vscode.Uri, packageName: string) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);

      // Find the import section
      const text = document.getText();
      const importMatch = text.match(/^import\s+\(/m);

      if (importMatch && importMatch.index !== undefined) {
        // Add to existing import block
        const importPos = document.positionAt(
          importMatch.index + importMatch[0].length,
        );
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, importPos, `\n\t"${packageName}"`);
        await vscode.workspace.applyEdit(edit);
      } else {
        // Create new import block after package declaration
        const packageMatch = text.match(/^package\s+\w+/m);
        if (packageMatch && packageMatch.index !== undefined) {
          const packageEndPos = document.positionAt(
            packageMatch.index + packageMatch[0].length,
          );
          const edit = new vscode.WorkspaceEdit();
          edit.insert(uri, packageEndPos, `\n\nimport "${packageName}"`);
          await vscode.workspace.applyEdit(edit);
        }
      }

      vscode.window.showInformationMessage(
        `Import "${packageName}" adicionado`,
      );
    },
  );

  // Register command to move declaration within package
  const moveDeclarationWithinPackageCommand = vscode.commands.registerCommand(
    "go-helper.moveDeclarationWithinPackage",
    async (uri: vscode.Uri, symbol: any) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const symbolRange = new vscode.Range(
        symbol.range.start.line,
        symbol.range.start.character,
        symbol.range.end.line,
        symbol.range.end.character,
      );
      const symbolText = document.getText(symbolRange);

      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(vscode.Uri.joinPath(uri, ".."), "*.go"),
        "**/vendor/**",
      );

      const items = files
        .filter((f) => f.fsPath !== uri.fsPath)
        .map((f) => ({
          label: vscode.workspace.asRelativePath(f),
          uri: f,
        }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select destination file for ${symbol.name}`,
      });

      if (selected) {
        const targetDoc = await vscode.workspace.openTextDocument(selected.uri);
        const edit = new vscode.WorkspaceEdit();

        const targetText = targetDoc.getText();
        const insertPosition = targetDoc.positionAt(targetText.length);
        edit.insert(selected.uri, insertPosition, "\n\n" + symbolText);

        edit.delete(uri, symbolRange);

        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
          await vscode.window.showTextDocument(selected.uri);
          vscode.window.showInformationMessage(
            `Moved ${symbol.name} to ${selected.label}`,
          );
        } else {
          vscode.window.showErrorMessage(`Failed to move ${symbol.name}`);
        }
      }
    },
  );

  // Register command to move declaration between packages
  const moveDeclarationBetweenPackagesCommand = vscode.commands.registerCommand(
    "go-helper.moveDeclarationBetweenPackages",
    async (uri: vscode.Uri, symbol: any) => {
      const goFiles = await vscode.workspace.findFiles(
        "**/*.go",
        "**/vendor/**",
      );

      const packages = new Map<string, vscode.Uri>();
      for (const file of goFiles) {
        const dir = vscode.Uri.joinPath(file, "..");
        const dirPath = dir.fsPath;
        if (!packages.has(dirPath)) {
          packages.set(dirPath, dir);
        }
      }

      const currentDir = vscode.Uri.joinPath(uri, "..").fsPath;
      const items = Array.from(packages.entries())
        .filter(([path]) => path !== currentDir)
        .map(([path, uri]) => ({
          label: vscode.workspace.asRelativePath(uri),
          uri: uri,
        }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select destination package for ${symbol.name}`,
      });

      if (selected) {
        vscode.window.showInformationMessage(
          `To move ${symbol.name} between packages, please use gopls refactoring or manually move the code and update imports.`,
        );
      }
    },
  );

  // Register unified move command
  const unifiedMoveCommand = vscode.commands.registerCommand(
    "go-helper.unifiedMove",
    async (
      uri: vscode.Uri,
      symbol: any,
      symbolType:
        | "struct"
        | "method"
        | "function"
        | "interface"
        | "variable"
        | "constant",
    ) => {
      const document = await vscode.workspace.openTextDocument(uri);

      // Check if this is a method with a receiver.
      // Run for both "method" and "function" symbolTypes because gopls may classify
      // Go methods (top-level `func (r *T) Name()`) as Function kind.
      let receiverType: string | null = null;
      if (symbolType === "method" || symbolType === "function") {
        const methodText = document.getText(
          new vscode.Range(
            symbol.range.start.line,
            symbol.range.start.character,
            symbol.range.end.line,
            symbol.range.end.character,
          ),
        );
        const receiverMatch = methodText.match(/func\s+\((\w+)\s+\*?(\w+)\)/);
        if (receiverMatch) {
          receiverType = receiverMatch[2];
        }
      }

      // gopls returns method children with names like "(*MyStruct).DoSomething" or
      // "MyStruct.DoSomething". Extract just the final segment before evaluating privacy.
      const plainSymbolName = symbol.name.includes(".")
        ? symbol.name.split(".").pop()!
        : symbol.name;
      const isPrivate = !/^[A-Z]/.test(plainSymbolName);

      // Fetch all movable top-level symbols in the file for the multi-select picker
      const fileSymbols =
        (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          "vscode.executeDocumentSymbolProvider",
          uri,
        )) ?? [];

      const movableSymbols = fileSymbols.filter(
        (s) =>
          s.kind === vscode.SymbolKind.Struct ||
          s.kind === vscode.SymbolKind.Class ||
          s.kind === vscode.SymbolKind.Interface ||
          s.kind === vscode.SymbolKind.Method ||
          s.kind === vscode.SymbolKind.Function,
      );

      // Build options
      const options: vscode.QuickPickItem[] = [];

      // Option to move to another file in the same package
      const filesInPackage = await vscode.workspace.findFiles(
        new vscode.RelativePattern(vscode.Uri.joinPath(uri, ".."), "*.go"),
        "**/vendor/**",
      );

      if (filesInPackage.length > 1) {
        options.push({
          label: "$(file) Move to file",
          description: "Move to another file in the same package",
          detail: receiverType
            ? `Will also move the ${receiverType} struct`
            : undefined,
        });
      }

      // Option to move to another package (only for public symbols)
      if (!isPrivate) {
        options.push({
          label: "$(package) Move to package",
          description: "Move to another package",
        });
      }

      // Multi-select option for all symbols in this file
      if (movableSymbols.length > 0) {
        options.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
        const count = movableSymbols.length;
        options.push({
          label: `$(list-tree) ${count} ${count === 1 ? "item" : "itens"} para mover`,
          description: "Selecionar múltiplos símbolos deste arquivo",
        });
      }

      if (
        options.filter((o) => o.kind !== vscode.QuickPickItemKind.Separator)
          .length === 0
      ) {
        vscode.window.showInformationMessage("No move options available");
        return;
      }

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: `Move ${symbol.name}`,
      });

      if (!selected) {
        return;
      }

      // ── Multi-select path ──────────────────────────────────────────────────
      if (
        selected.label.includes("itens para mover") ||
        selected.label.includes("item para mover")
      ) {
        const symbolItems = movableSymbols.map((s) => ({
          label: `${symbolKindIcon(s.kind)} ${s.name}`,
          description: vscode.SymbolKind[s.kind].toLowerCase(),
          symbol: s,
          // Pre-select the symbol the user clicked "move" on
          picked: s.range.start.line === symbol.range.start.line,
        }));

        const selectedSymbols = await vscode.window.showQuickPick(symbolItems, {
          placeHolder: "Choose to select...",
          canPickMany: true,
        });

        if (!selectedSymbols || selectedSymbols.length === 0) {
          return;
        }

        const destOptions: vscode.QuickPickItem[] = [];
        if (filesInPackage.length > 1) {
          destOptions.push({
            label: "$(file) Move to file",
            description: "Move to another file in the same package",
          });
        }
        const allPublic = selectedSymbols.every(
          (s) => s.symbol.name[0] !== s.symbol.name[0].toLowerCase(),
        );
        if (allPublic) {
          destOptions.push({
            label: "$(package) Move to package",
            description: "Move to another package",
          });
        }

        if (destOptions.length === 0) {
          vscode.window.showInformationMessage("No move options available");
          return;
        }

        const destSelected = await vscode.window.showQuickPick(destOptions, {
          placeHolder: `Move ${selectedSymbols.length} símbolo(s)`,
        });

        if (!destSelected) {
          return;
        }

        if (destSelected.label.includes("file")) {
          const files = filesInPackage
            .filter((f) => f.fsPath !== uri.fsPath)
            .map((f) => ({
              label: vscode.workspace.asRelativePath(f),
              uri: f,
            }));

          const targetFile = await vscode.window.showQuickPick(files, {
            placeHolder: "Select destination file",
          });

          if (targetFile) {
            await moveMultipleToFile(
              document,
              uri,
              selectedSymbols.map((s) => s.symbol),
              targetFile.uri,
            );
          }
        } else {
          for (const item of selectedSymbols) {
            await moveToPackage(uri, item.symbol);
          }
        }
        return;
      }

      // ── Single symbol path ─────────────────────────────────────────────────
      if (selected.label.includes("file")) {
        const files = filesInPackage
          .filter((f) => f.fsPath !== uri.fsPath)
          .map((f) => ({
            label: vscode.workspace.asRelativePath(f),
            uri: f,
          }));

        const targetFile = await vscode.window.showQuickPick(files, {
          placeHolder: `Select destination file for ${symbol.name}`,
        });

        if (targetFile) {
          await moveToFile(document, uri, symbol, targetFile.uri, receiverType);
        }
      } else {
        await moveToPackage(uri, symbol);
      }
    },
  );

  // Register command to show method interfaces
  const showMethodInterfacesCommand = vscode.commands.registerCommand(
    "go-helper.showMethodInterfaces",
    async (uri: vscode.Uri, symbol: any, interfaces: vscode.Location[]) => {
      if (interfaces && interfaces.length > 0) {
        // Get symbol information at position
        const position = new vscode.Position(
          symbol.selectionRange.start.line,
          symbol.selectionRange.start.character,
        );
        const symbolInfo = await getSymbolAtPosition(uri, position);

        // Show in custom References view
        referencesViewProvider.showReferences(
          "Interfaces Implemented",
          interfaces,
          symbolInfo,
        );

        // Set context to show the view
        vscode.commands.executeCommand(
          "setContext",
          "goHelper.hasReferences",
          true,
        );

        // Reveal the view
        await vscode.commands.executeCommand("goHelperReferences.focus");
      } else {
        vscode.window.showInformationMessage("No interfaces found");
      }
    },
  );

  // Register command to rename parameter (with update in all callers)
  const renameParameterCommand = vscode.commands.registerCommand(
    "go-helper.renameParameter",
    async (uri: vscode.Uri, line: number, paramName: string) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);

      // Use VS Code's rename functionality which will update all references
      const position = new vscode.Position(
        line,
        document.lineAt(line).text.indexOf(paramName),
      );

      await vscode.commands.executeCommand("editor.action.rename", [
        document.uri,
        position,
      ]);
    },
  );

  // Register command to change signature (old, will be replaced by Code Actions)
  const changeSignatureCommand = vscode.commands.registerCommand(
    "go-helper.changeSignature",
    async (uri: vscode.Uri, symbol: any) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);

      const funcLine = symbol.selectionRange.start.line;
      const lineText = document.lineAt(funcLine).text;
      const funcMatch = lineText.match(
        /func\s+(\([^)]+\)\s+)?(\w+)(\([^)]*\))(\s+[^{]*)?/,
      );

      if (funcMatch) {
        const paramsStart = lineText.indexOf(
          "(",
          lineText.indexOf(symbol.name),
        );
        const paramsEnd = lineText.indexOf(")", paramsStart) + 1;

        const startPos = new vscode.Position(funcLine, paramsStart);
        const endPos = new vscode.Position(funcLine, paramsEnd);

        editor.selection = new vscode.Selection(startPos, endPos);
        editor.revealRange(
          new vscode.Range(startPos, endPos),
          vscode.TextEditorRevealType.InCenter,
        );

        vscode.window.showInformationMessage(
          `Edit the signature of ${symbol.name}. Remember to update all callers.`,
        );
      } else {
        vscode.window.showWarningMessage(
          `Could not parse signature for ${symbol.name}`,
        );
      }
    },
  );

  // Register command to move struct within package
  const moveStructWithinPackageCommand = vscode.commands.registerCommand(
    "go-helper.moveStructWithinPackage",
    async (uri: vscode.Uri, symbol: any) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const symbolRange = new vscode.Range(
        symbol.range.start.line,
        symbol.range.start.character,
        symbol.range.end.line,
        symbol.range.end.character,
      );
      const symbolText = document.getText(symbolRange);

      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(vscode.Uri.joinPath(uri, ".."), "*.go"),
        "**/vendor/**",
      );

      const items = files
        .filter((f) => f.fsPath !== uri.fsPath)
        .map((f) => ({
          label: vscode.workspace.asRelativePath(f),
          uri: f,
        }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select destination file for ${symbol.name}`,
      });

      if (selected) {
        const targetDoc = await vscode.workspace.openTextDocument(selected.uri);
        const edit = new vscode.WorkspaceEdit();

        const targetText = targetDoc.getText();
        const insertPosition = targetDoc.positionAt(targetText.length);
        edit.insert(selected.uri, insertPosition, "\n\n" + symbolText);

        edit.delete(uri, symbolRange);

        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
          await vscode.window.showTextDocument(selected.uri);
          vscode.window.showInformationMessage(
            `Moved ${symbol.name} to ${selected.label}`,
          );
        } else {
          vscode.window.showErrorMessage(`Failed to move ${symbol.name}`);
        }
      }
    },
  );

  // Register command to move struct between packages
  const moveStructBetweenPackagesCommand = vscode.commands.registerCommand(
    "go-helper.moveStructBetweenPackages",
    async (uri: vscode.Uri, symbol: any) => {
      const goFiles = await vscode.workspace.findFiles(
        "**/*.go",
        "**/vendor/**",
      );

      const packages = new Map<string, vscode.Uri>();
      for (const file of goFiles) {
        const dir = vscode.Uri.joinPath(file, "..");
        const dirPath = dir.fsPath;
        if (!packages.has(dirPath)) {
          packages.set(dirPath, dir);
        }
      }

      const currentDir = vscode.Uri.joinPath(uri, "..").fsPath;
      const items = Array.from(packages.entries())
        .filter(([path]) => path !== currentDir)
        .map(([path, uri]) => ({
          label: vscode.workspace.asRelativePath(uri),
          uri: uri,
        }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select destination package for ${symbol.name}`,
      });

      if (selected) {
        vscode.window.showInformationMessage(
          `To move ${symbol.name} between packages, please use gopls refactoring or manually move the code and update imports.`,
        );
      }
    },
  );

  // Register command to generate interface stub
  const generateInterfaceStubCommand = vscode.commands.registerCommand(
    "go-helper.generateInterfaceStub",
    async (uri: vscode.Uri, symbol: any) => {
      const document = await vscode.workspace.openTextDocument(uri);

      // Extract methods from interface
      const interfaceText = document.getText(symbol.range);
      const methods: string[] = [];
      const methodRegex = /^\s*(\w+)\s*\(([^)]*)\)\s*(.*)$/gm;
      let match;

      while ((match = methodRegex.exec(interfaceText)) !== null) {
        const methodName = match[1];
        if (methodName !== "interface" && methodName !== "type") {
          methods.push(`\t${match[0].trim()}`);
        }
      }

      const stubName = `${symbol.name}Stub`;
      const stubCode = `
type ${stubName} struct {
\t${symbol.name}
}

${methods.map((m) => `func (s *${stubName}) ${m} {\n\tpanic("TODO: implement")\n}`).join("\n\n")}`;

      const edit = new vscode.WorkspaceEdit();
      const insertPosition = new vscode.Position(symbol.range.end.line + 1, 0);
      edit.insert(uri, insertPosition, stubCode);

      const success = await vscode.workspace.applyEdit(edit);
      if (success) {
        await vscode.commands.executeCommand("editor.action.formatDocument");
        vscode.window.showInformationMessage(`Generated ${stubName}`);
      }
    },
  );

  // Register command to move symbol up
  const moveSymbolUpCommand = vscode.commands.registerCommand(
    "go-helper.moveSymbolUp",
    async (
      uri: vscode.Uri,
      symbol: any,
      allSymbols: vscode.DocumentSymbol[],
    ) => {
      const document = await vscode.workspace.openTextDocument(uri);

      // Find previous symbol at the same level
      const topLevelSymbols = allSymbols
        .filter(
          (s) =>
            s.kind === vscode.SymbolKind.Interface ||
            s.kind === vscode.SymbolKind.Struct ||
            s.kind === vscode.SymbolKind.Class ||
            s.kind === vscode.SymbolKind.Method ||
            s.kind === vscode.SymbolKind.Function,
        )
        .sort((a, b) => a.range.start.line - b.range.start.line);

      const currentIndex = topLevelSymbols.findIndex(
        (s) => s.name === symbol.name,
      );

      if (currentIndex <= 0) {
        vscode.window.showInformationMessage("Already at the top");
        return;
      }

      const previousSymbol = topLevelSymbols[currentIndex - 1];
      await swapSymbols(document, uri, previousSymbol, symbol);
    },
  );

  // Register command to move symbol down
  const moveSymbolDownCommand = vscode.commands.registerCommand(
    "go-helper.moveSymbolDown",
    async (
      uri: vscode.Uri,
      symbol: any,
      allSymbols: vscode.DocumentSymbol[],
    ) => {
      const document = await vscode.workspace.openTextDocument(uri);

      // Find next symbol at the same level
      const topLevelSymbols = allSymbols
        .filter(
          (s) =>
            s.kind === vscode.SymbolKind.Interface ||
            s.kind === vscode.SymbolKind.Struct ||
            s.kind === vscode.SymbolKind.Class ||
            s.kind === vscode.SymbolKind.Method ||
            s.kind === vscode.SymbolKind.Function,
        )
        .sort((a, b) => a.range.start.line - b.range.start.line);

      const currentIndex = topLevelSymbols.findIndex(
        (s) => s.name === symbol.name,
      );

      if (currentIndex === -1 || currentIndex >= topLevelSymbols.length - 1) {
        vscode.window.showInformationMessage("Already at the bottom");
        return;
      }

      const nextSymbol = topLevelSymbols[currentIndex + 1];
      await swapSymbols(document, uri, symbol, nextSymbol);
    },
  );

  // Register command to add explicit type to var/const
  const addVarTypeCommand = vscode.commands.registerCommand(
    "go-helper.addVarType",
    async (uri: vscode.Uri, symbol: any) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);

      const symbolRange = new vscode.Range(
        symbol.range.start.line,
        symbol.range.start.character,
        symbol.range.end.line,
        symbol.range.end.character,
      );
      const symbolText = document.getText(symbolRange);

      // Determine if it's var or const
      const keyword = symbolText.trim().startsWith("var") ? "var" : "const";

      // Parse the declaration to get name and value
      // var x = 5 -> var x int = 5
      // const name = "John" -> const name string = "John"
      const pattern = new RegExp(`${keyword}\\s+(\\w+)\\s*=\\s*(.+)`);
      const match = symbolText.match(pattern);

      if (!match) {
        vscode.window.showErrorMessage("Could not parse variable declaration");
        return;
      }

      const varName = match[1];
      const valueExpr = match[2].trim();

      // Infer type from value using gopls hover
      const position = new vscode.Position(
        symbol.selectionRange.start.line,
        symbol.selectionRange.start.character,
      );

      try {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          document.uri,
          position,
        );

        if (hovers && hovers.length > 0) {
          const hoverText = hovers[0].contents[0];
          const typeMatch =
            typeof hoverText === "string"
              ? hoverText.match(/^(var|const)\s+\w+\s+(.+)$/m)
              : (hoverText as vscode.MarkdownString).value.match(
                  /```go\n(?:var|const)\s+\w+\s+(.+?)\n```/,
                );

          if (typeMatch) {
            const inferredType =
              typeof hoverText === "string" ? typeMatch[2] : typeMatch[1];

            // Replace the declaration with explicit type
            const newText = `${keyword} ${varName} ${inferredType} = ${valueExpr}`;

            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, symbolRange, newText);
            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage(
              `Type '${inferredType}' added to ${keyword} ${varName}`,
            );
            return;
          }
        }

        // Fallback: Basic type inference
        const inferredType = inferBasicType(valueExpr);
        if (inferredType) {
          const newText = `${keyword} ${varName} ${inferredType} = ${valueExpr}`;

          const edit = new vscode.WorkspaceEdit();
          edit.replace(uri, symbolRange, newText);
          await vscode.workspace.applyEdit(edit);

          vscode.window.showInformationMessage(
            `Type '${inferredType}' added to ${keyword} ${varName}`,
          );
        } else {
          vscode.window.showErrorMessage("Could not infer type");
        }
      } catch (error) {
        console.error("Error adding var type:", error);
        vscode.window.showErrorMessage("Error adding type");
      }
    },
  );

  // Find and display go.mod location when a Go file is opened
  const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument(
    async (document) => {
      if (document.languageId === "go") {
        const goModRoot = await getGoModuleRoot(document.uri.fsPath);
        if (goModRoot) {
          console.log(
            `go.mod encontrado para ${document.fileName} em: ${goModRoot}`,
          );
        } else {
          console.log(`go.mod não encontrado para ${document.fileName}`);
        }
      }
    },
  );

  // Check for go.mod when extension activates
  (async () => {
    const goModPath = await findGoModForWorkspace();
    if (goModPath) {
      console.log(`go.mod encontrado em: ${goModPath}`);
    } else {
      console.log("Nenhum go.mod encontrado no workspace");
    }
  })();

  // Refresh CodeLens when document changes
  const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (event.document.languageId === "go") {
        codeLensProvider.refresh();
      }
    },
  );

  // Clear cache and refresh when document is saved (for large project mode)
  const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument(
    (document) => {
      if (document.languageId === "go") {
        codeLensProvider.clearCache();
        codeLensProvider.refresh();
      }
    },
  );

  // Refresh when configuration changes
  const onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (event.affectsConfiguration("goHelper")) {
        codeLensProvider.clearCache();
        codeLensProvider.refresh();
        inlayHintsProvider.refresh();
      }
    },
  );

  // Add all disposables to subscriptions
  context.subscriptions.push(
    codeLensDisposable,
    protoCodeLensDisposable,
    inlayHintsDisposable,
    postfixCompletionDisposable,
    codeActionDisposable,
    inlineValuesDisposable,
    showReferencesCommand,
    showImplementationsCommand,
    showImplementersCommand,
    clearReferencesViewCommand,
    refreshReferencesViewCommand,
    discoverTestsCommand,
    runAllTestsCommand,
    runAllTestsWithCoverageCommand,
    runPackageTestsCommand,
    runFileTestsCommand,
    runTestCommand,
    debugPackageTestsCommand,
    debugFileTestsCommand,
    debugTestCommand,
    openCoverageHtmlCommand,
    clearCoverageCommand,
    addImportCommand,
    unifiedMoveCommand,
    showMethodInterfacesCommand,
    renameParameterCommand,
    changeSignatureCommand,
    generateInterfaceStubCommand,
    moveSymbolUpCommand,
    moveSymbolDownCommand,
    addVarTypeCommand,
    onDidOpenTextDocument,
    onDidChangeTextDocument,
    onDidSaveTextDocument,
    onDidChangeConfiguration,
    diagnosticsProvider,
    fileMoveHelper,
  );
}

// Helper interfaces and functions for implementing interfaces
interface InterfaceMethod {
  name: string;
  signature: string;
  params: string;
  returns: string;
}

interface InterfaceInfo {
  name: string;
  package: string;
  methods: InterfaceMethod[];
  location?: vscode.Location;
}

async function findAvailableInterfaces(
  document: vscode.TextDocument,
): Promise<InterfaceInfo[]> {
  const interfaces: InterfaceInfo[] = [];

  try {
    // Add common stdlib interfaces (io, fmt, http, context, encoding, database, etc.)
    interfaces.push(
      {
        name: "io.Reader",
        package: "io",
        methods: [
          {
            name: "Read",
            signature: "Read(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
        ],
      },
      {
        name: "io.Writer",
        package: "io",
        methods: [
          {
            name: "Write",
            signature: "Write(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
        ],
      },
      {
        name: "io.Closer",
        package: "io",
        methods: [
          {
            name: "Close",
            signature: "Close() error",
            params: "",
            returns: "error",
          },
        ],
      },
      {
        name: "io.ReadWriter",
        package: "io",
        methods: [
          {
            name: "Read",
            signature: "Read(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
          {
            name: "Write",
            signature: "Write(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
        ],
      },
      {
        name: "io.ReadCloser",
        package: "io",
        methods: [
          {
            name: "Read",
            signature: "Read(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
          {
            name: "Close",
            signature: "Close() error",
            params: "",
            returns: "error",
          },
        ],
      },
      {
        name: "io.WriteCloser",
        package: "io",
        methods: [
          {
            name: "Write",
            signature: "Write(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
          {
            name: "Close",
            signature: "Close() error",
            params: "",
            returns: "error",
          },
        ],
      },
      {
        name: "fmt.Stringer",
        package: "fmt",
        methods: [
          {
            name: "String",
            signature: "String() string",
            params: "",
            returns: "string",
          },
        ],
      },
      {
        name: "error",
        package: "builtin",
        methods: [
          {
            name: "Error",
            signature: "Error() string",
            params: "",
            returns: "string",
          },
        ],
      },
      {
        name: "http.Handler",
        package: "net/http",
        methods: [
          {
            name: "ServeHTTP",
            signature: "ServeHTTP(w http.ResponseWriter, r *http.Request)",
            params: "w http.ResponseWriter, r *http.Request",
            returns: "",
          },
        ],
      },
      {
        name: "context.Context",
        package: "context",
        methods: [
          {
            name: "Deadline",
            signature: "Deadline() (deadline time.Time, ok bool)",
            params: "",
            returns: "(deadline time.Time, ok bool)",
          },
          {
            name: "Done",
            signature: "Done() <-chan struct{}",
            params: "",
            returns: "<-chan struct{}",
          },
          {
            name: "Err",
            signature: "Err() error",
            params: "",
            returns: "error",
          },
          {
            name: "Value",
            signature: "Value(key any) any",
            params: "key any",
            returns: "any",
          },
        ],
      },
      {
        name: "json.Marshaler",
        package: "encoding/json",
        methods: [
          {
            name: "MarshalJSON",
            signature: "MarshalJSON() ([]byte, error)",
            params: "",
            returns: "([]byte, error)",
          },
        ],
      },
      {
        name: "json.Unmarshaler",
        package: "encoding/json",
        methods: [
          {
            name: "UnmarshalJSON",
            signature: "UnmarshalJSON(data []byte) error",
            params: "data []byte",
            returns: "error",
          },
        ],
      },
      {
        name: "sql.Scanner",
        package: "database/sql",
        methods: [
          {
            name: "Scan",
            signature: "Scan(src any) error",
            params: "src any",
            returns: "error",
          },
        ],
      },
      {
        name: "driver.Valuer",
        package: "database/sql/driver",
        methods: [
          {
            name: "Value",
            signature: "Value() (driver.Value, error)",
            params: "",
            returns: "(driver.Value, error)",
          },
        ],
      },
      {
        name: "io.Seeker",
        package: "io",
        methods: [
          {
            name: "Seek",
            signature: "Seek(offset int64, whence int) (int64, error)",
            params: "offset int64, whence int",
            returns: "(int64, error)",
          },
        ],
      },
      {
        name: "io.ReadSeeker",
        package: "io",
        methods: [
          {
            name: "Read",
            signature: "Read(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
          {
            name: "Seek",
            signature: "Seek(offset int64, whence int) (int64, error)",
            params: "offset int64, whence int",
            returns: "(int64, error)",
          },
        ],
      },
      {
        name: "io.WriteSeeker",
        package: "io",
        methods: [
          {
            name: "Write",
            signature: "Write(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
          {
            name: "Seek",
            signature: "Seek(offset int64, whence int) (int64, error)",
            params: "offset int64, whence int",
            returns: "(int64, error)",
          },
        ],
      },
      {
        name: "io.ReadWriteSeeker",
        package: "io",
        methods: [
          {
            name: "Read",
            signature: "Read(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
          {
            name: "Write",
            signature: "Write(p []byte) (n int, err error)",
            params: "p []byte",
            returns: "(n int, err error)",
          },
          {
            name: "Seek",
            signature: "Seek(offset int64, whence int) (int64, error)",
            params: "offset int64, whence int",
            returns: "(int64, error)",
          },
        ],
      },
      {
        name: "sort.Interface",
        package: "sort",
        methods: [
          {
            name: "Len",
            signature: "Len() int",
            params: "",
            returns: "int",
          },
          {
            name: "Less",
            signature: "Less(i, j int) bool",
            params: "i, j int",
            returns: "bool",
          },
          {
            name: "Swap",
            signature: "Swap(i, j int)",
            params: "i, j int",
            returns: "",
          },
        ],
      },
      {
        name: "heap.Interface",
        package: "container/heap",
        methods: [
          {
            name: "Len",
            signature: "Len() int",
            params: "",
            returns: "int",
          },
          {
            name: "Less",
            signature: "Less(i, j int) bool",
            params: "i, j int",
            returns: "bool",
          },
          {
            name: "Swap",
            signature: "Swap(i, j int)",
            params: "i, j int",
            returns: "",
          },
          {
            name: "Push",
            signature: "Push(x any)",
            params: "x any",
            returns: "",
          },
          {
            name: "Pop",
            signature: "Pop() any",
            params: "",
            returns: "any",
          },
        ],
      },
      {
        name: "fs.FS",
        package: "io/fs",
        methods: [
          {
            name: "Open",
            signature: "Open(name string) (fs.File, error)",
            params: "name string",
            returns: "(fs.File, error)",
          },
        ],
      },
      {
        name: "fs.File",
        package: "io/fs",
        methods: [
          {
            name: "Stat",
            signature: "Stat() (fs.FileInfo, error)",
            params: "",
            returns: "(fs.FileInfo, error)",
          },
          {
            name: "Read",
            signature: "Read([]byte) (int, error)",
            params: "[]byte",
            returns: "(int, error)",
          },
          {
            name: "Close",
            signature: "Close() error",
            params: "",
            returns: "error",
          },
        ],
      },
      {
        name: "fs.ReadDirFile",
        package: "io/fs",
        methods: [
          {
            name: "Stat",
            signature: "Stat() (fs.FileInfo, error)",
            params: "",
            returns: "(fs.FileInfo, error)",
          },
          {
            name: "Read",
            signature: "Read([]byte) (int, error)",
            params: "[]byte",
            returns: "(int, error)",
          },
          {
            name: "Close",
            signature: "Close() error",
            params: "",
            returns: "error",
          },
          {
            name: "ReadDir",
            signature: "ReadDir(n int) ([]fs.DirEntry, error)",
            params: "n int",
            returns: "([]fs.DirEntry, error)",
          },
        ],
      },
      {
        name: "http.ResponseWriter",
        package: "net/http",
        methods: [
          {
            name: "Header",
            signature: "Header() http.Header",
            params: "",
            returns: "http.Header",
          },
          {
            name: "Write",
            signature: "Write([]byte) (int, error)",
            params: "[]byte",
            returns: "(int, error)",
          },
          {
            name: "WriteHeader",
            signature: "WriteHeader(statusCode int)",
            params: "statusCode int",
            returns: "",
          },
        ],
      },
      {
        name: "http.RoundTripper",
        package: "net/http",
        methods: [
          {
            name: "RoundTrip",
            signature: "RoundTrip(*http.Request) (*http.Response, error)",
            params: "*http.Request",
            returns: "(*http.Response, error)",
          },
        ],
      },
      {
        name: "net.Conn",
        package: "net",
        methods: [
          {
            name: "Read",
            signature: "Read(b []byte) (n int, err error)",
            params: "b []byte",
            returns: "(n int, err error)",
          },
          {
            name: "Write",
            signature: "Write(b []byte) (n int, err error)",
            params: "b []byte",
            returns: "(n int, err error)",
          },
          {
            name: "Close",
            signature: "Close() error",
            params: "",
            returns: "error",
          },
          {
            name: "LocalAddr",
            signature: "LocalAddr() net.Addr",
            params: "",
            returns: "net.Addr",
          },
          {
            name: "RemoteAddr",
            signature: "RemoteAddr() net.Addr",
            params: "",
            returns: "net.Addr",
          },
          {
            name: "SetDeadline",
            signature: "SetDeadline(t time.Time) error",
            params: "t time.Time",
            returns: "error",
          },
          {
            name: "SetReadDeadline",
            signature: "SetReadDeadline(t time.Time) error",
            params: "t time.Time",
            returns: "error",
          },
          {
            name: "SetWriteDeadline",
            signature: "SetWriteDeadline(t time.Time) error",
            params: "t time.Time",
            returns: "error",
          },
        ],
      },
      {
        name: "net.Listener",
        package: "net",
        methods: [
          {
            name: "Accept",
            signature: "Accept() (net.Conn, error)",
            params: "",
            returns: "(net.Conn, error)",
          },
          {
            name: "Close",
            signature: "Close() error",
            params: "",
            returns: "error",
          },
          {
            name: "Addr",
            signature: "Addr() net.Addr",
            params: "",
            returns: "net.Addr",
          },
        ],
      },
    );

    // Get all Go files in workspace (local project)
    const goFiles = await vscode.workspace.findFiles("**/*.go", "**/vendor/**");

    // Scan workspace interfaces
    for (const file of goFiles) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const symbols = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[]
        >("vscode.executeDocumentSymbolProvider", doc.uri);

        if (symbols) {
          for (const symbol of symbols) {
            if (symbol.kind === vscode.SymbolKind.Interface) {
              const methods = await extractInterfaceMethods(doc, symbol);
              const packageName = await getPackageNameFromDocument(doc);

              interfaces.push({
                name: symbol.name,
                package: packageName || "unknown",
                methods: methods,
                location: new vscode.Location(file, symbol.range),
              });
            }
          }
        }
      } catch (error) {
        // Skip files that can't be processed
      }
    }

    // Try to scan GOMODCACHE/GOPATH for installed packages interfaces
    try {
      const { execSync } = require("child_process");

      // Get GOMODCACHE path
      let goModCache: string | undefined;
      try {
        goModCache = execSync("go env GOMODCACHE", { encoding: "utf8" }).trim();
      } catch (error) {
        // Try GOPATH/pkg/mod as fallback
        try {
          const goPath = execSync("go env GOPATH", { encoding: "utf8" }).trim();
          goModCache = `${goPath}/pkg/mod`;
        } catch (e) {
          // Ignore
        }
      }

      if (goModCache && require("fs").existsSync(goModCache)) {
        // Scan Go module cache for interfaces (limited to avoid performance issues)
        // Focus on common packages: github.com, golang.org, google.golang.org
        const modCachePattern = new vscode.RelativePattern(
          goModCache,
          "{github.com,golang.org,google.golang.org}/**/*.go",
        );

        const modFiles = await vscode.workspace.findFiles(
          modCachePattern,
          "{**/testdata/**,**/*_test.go,**/vendor/**}",
          1000, // Limit to 1000 files to avoid performance issues
        );

        for (const file of modFiles) {
          try {
            const doc = await vscode.workspace.openTextDocument(file);
            const symbols = await vscode.commands.executeCommand<
              vscode.DocumentSymbol[]
            >("vscode.executeDocumentSymbolProvider", doc.uri);

            if (symbols) {
              for (const symbol of symbols) {
                if (symbol.kind === vscode.SymbolKind.Interface) {
                  const methods = await extractInterfaceMethods(doc, symbol);
                  const packageName = await getPackageNameFromDocument(doc);

                  // Extract module path from file path for better package name
                  const filePath = file.fsPath;
                  const modMatch = filePath.match(
                    /(github\.com|golang\.org|google\.golang\.org)\/[^\/]+\/[^\/]+/,
                  );
                  const fullPackage = modMatch
                    ? `${modMatch[0]}/${packageName}`
                    : packageName || "unknown";

                  interfaces.push({
                    name: symbol.name,
                    package: fullPackage,
                    methods: methods,
                    location: new vscode.Location(file, symbol.range),
                  });
                }
              }
            }
          } catch (error) {
            // Skip files that can't be processed
          }
        }
      }
    } catch (error) {
      // Silently fail if can't access GOMODCACHE
      console.log("Could not scan GOMODCACHE for interfaces:", error);
    }
  } catch (error) {
    console.error("Error finding interfaces:", error);
  }

  return interfaces;
}

async function extractInterfaceMethods(
  document: vscode.TextDocument,
  interfaceSymbol: vscode.DocumentSymbol,
): Promise<InterfaceMethod[]> {
  const methods: InterfaceMethod[] = [];

  try {
    // Get interface body text
    const interfaceText = document.getText(interfaceSymbol.range);

    // Parse method signatures from interface
    const methodRegex = /^\s*(\w+)\s*\(([^)]*)\)\s*(.*)$/gm;
    let match;

    while ((match = methodRegex.exec(interfaceText)) !== null) {
      const methodName = match[1];
      const params = match[2].trim();
      const returns = match[3].trim();

      // Skip if it's the interface declaration itself
      if (methodName === "interface" || methodName === "type") {
        continue;
      }

      methods.push({
        name: methodName,
        signature: `${methodName}(${params}) ${returns}`,
        params: params,
        returns: returns,
      });
    }
  } catch (error) {
    console.error("Error extracting interface methods:", error);
  }

  return methods;
}

async function getPackageNameFromDocument(
  document: vscode.TextDocument,
): Promise<string | null> {
  const text = document.getText();
  const packageMatch = text.match(/^package\s+(\w+)/m);
  return packageMatch ? packageMatch[1] : null;
}

async function implementInterfaceMethods(
  document: vscode.TextDocument,
  structSymbol: any,
  interfaceInfo: InterfaceInfo,
): Promise<void> {
  try {
    const editor = await vscode.window.showTextDocument(document);
    const structName = structSymbol.name;

    // Find the best insertion point (after the struct definition)
    const structEndLine = structSymbol.range.end.line;
    const insertPosition = new vscode.Position(structEndLine + 1, 0);

    // Generate method stubs
    const methodStubs: string[] = [];

    for (const method of interfaceInfo.methods) {
      const receiverName = structName.charAt(0).toLowerCase();
      const stub = `
func (${receiverName} *${structName}) ${method.signature} {
\tpanic("TODO: implement ${interfaceInfo.name}.${method.name}")
}`;
      methodStubs.push(stub);
    }

    // Insert all method stubs
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, insertPosition, methodStubs.join("\n"));

    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
      // Format the document
      await vscode.commands.executeCommand(
        "editor.action.formatDocument",
        document.uri,
      );

      const methodCount = interfaceInfo.methods.length;
      vscode.window.showInformationMessage(
        `Implemented ${methodCount} method${methodCount === 1 ? "" : "s"} from ${interfaceInfo.name}`,
      );
    } else {
      vscode.window.showErrorMessage(
        `Failed to implement ${interfaceInfo.name}`,
      );
    }
  } catch (error) {
    console.error("Error implementing interface methods:", error);
    vscode.window.showErrorMessage(`Error implementing interface: ${error}`);
  }
}

// Helper function to move symbol to another file
async function moveToFile(
  document: vscode.TextDocument,
  sourceUri: vscode.Uri,
  symbol: any,
  targetUri: vscode.Uri,
  receiverType: string | null,
): Promise<void> {
  try {
    const symbolRange = new vscode.Range(
      symbol.range.start.line,
      symbol.range.start.character,
      symbol.range.end.line,
      symbol.range.end.character,
    );

    let textToMove = document.getText(symbolRange);

    // If this is a method with a receiver, also move the struct
    if (receiverType) {
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", sourceUri);

      if (symbols) {
        const structSymbol = findSymbol(
          symbols,
          receiverType,
          vscode.SymbolKind.Struct,
        );
        if (structSymbol) {
          const structRange = structSymbol.range;
          const structText = document.getText(structRange);
          textToMove = structText + "\n\n" + textToMove;

          // Delete struct too
          const edit = new vscode.WorkspaceEdit();
          edit.delete(sourceUri, structRange);
        }
      }
    }

    const targetDoc = await vscode.workspace.openTextDocument(targetUri);
    const edit = new vscode.WorkspaceEdit();

    const targetText = targetDoc.getText();
    const insertPosition = targetDoc.positionAt(targetText.length);
    edit.insert(targetUri, insertPosition, "\n\n" + textToMove);

    edit.delete(sourceUri, symbolRange);

    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
      await vscode.window.showTextDocument(targetUri);
      vscode.window.showInformationMessage(
        `Moved ${symbol.name}${receiverType ? ` and ${receiverType}` : ""} to ${vscode.workspace.asRelativePath(targetUri)}`,
      );
    } else {
      vscode.window.showErrorMessage(`Failed to move ${symbol.name}`);
    }
  } catch (error) {
    console.error("Error moving to file:", error);
    vscode.window.showErrorMessage(`Error: ${error}`);
  }
}

// Maps VS Code SymbolKind to the corresponding codicon label
function symbolKindIcon(kind: vscode.SymbolKind): string {
  switch (kind) {
    case vscode.SymbolKind.Struct:
      return "$(symbol-structure)";
    case vscode.SymbolKind.Class:
      return "$(symbol-class)";
    case vscode.SymbolKind.Interface:
      return "$(symbol-interface)";
    case vscode.SymbolKind.Method:
      return "$(symbol-method)";
    case vscode.SymbolKind.Function:
      return "$(symbol-function)";
    case vscode.SymbolKind.Variable:
      return "$(symbol-variable)";
    case vscode.SymbolKind.Constant:
      return "$(symbol-constant)";
    case vscode.SymbolKind.Field:
      return "$(symbol-field)";
    default:
      return "$(symbol-misc)";
  }
}

// Move multiple symbols to a target file in a single WorkspaceEdit
async function moveMultipleToFile(
  document: vscode.TextDocument,
  sourceUri: vscode.Uri,
  symbols: vscode.DocumentSymbol[],
  targetUri: vscode.Uri,
): Promise<void> {
  try {
    // Original order for the appended text
    const inOrder = [...symbols].sort(
      (a, b) => a.range.start.line - b.range.start.line,
    );
    // Reverse order for deletions so line offsets stay valid
    const inReverse = [...inOrder].reverse();

    const targetDoc = await vscode.workspace.openTextDocument(targetUri);
    const insertPosition = targetDoc.positionAt(targetDoc.getText().length);
    const textToAppend = inOrder
      .map((s) => document.getText(s.range))
      .join("\n\n");

    const edit = new vscode.WorkspaceEdit();
    edit.insert(targetUri, insertPosition, "\n\n" + textToAppend);
    for (const sym of inReverse) {
      edit.delete(sourceUri, sym.range);
    }

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      await vscode.window.showTextDocument(targetUri);
      vscode.window.showInformationMessage(
        `Moved ${inOrder.map((s) => s.name).join(", ")} to ${vscode.workspace.asRelativePath(targetUri)}`,
      );
    } else {
      vscode.window.showErrorMessage("Failed to move symbols");
    }
  } catch (error) {
    console.error("Error moving multiple symbols to file:", error);
    vscode.window.showErrorMessage(`Error: ${error}`);
  }
}

// Helper function to move symbol to another package
async function moveToPackage(uri: vscode.Uri, symbol: any): Promise<void> {
  // gopls may return method names as "(*Receiver).MethodName" – use just the final segment
  const plainName = symbol.name.includes(".")
    ? symbol.name.split(".").pop()!
    : symbol.name;

  const goFiles = await vscode.workspace.findFiles("**/*.go", "**/vendor/**");

  // Build unique package directories
  const packages = new Map<string, vscode.Uri>();
  for (const file of goFiles) {
    const dir = vscode.Uri.joinPath(file, "..");
    const dirPath = dir.fsPath;
    if (!packages.has(dirPath)) {
      packages.set(dirPath, dir);
    }
  }

  const currentDir = vscode.Uri.joinPath(uri, "..").fsPath;
  const items = Array.from(packages.entries())
    .filter(([p]) => p !== currentDir)
    .map(([, dirUri]) => ({
      label: vscode.workspace.asRelativePath(dirUri),
      uri: dirUri,
    }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Select destination package for ${plainName}`,
  });

  if (!selected) {
    return;
  }

  try {
    const sourceDoc = await vscode.workspace.openTextDocument(uri);

    // Determine target package name by reading an existing .go file in that dir
    const dirFiles = await vscode.workspace.findFiles(
      new vscode.RelativePattern(selected.uri, "*.go"),
      "**/vendor/**",
      5,
    );
    let targetPackageName: string | undefined;
    for (const f of dirFiles) {
      const doc = await vscode.workspace.openTextDocument(f);
      const m = doc.getText().match(/^package\s+(\w+)/m);
      if (m) {
        targetPackageName = m[1];
        break;
      }
    }
    if (!targetPackageName) {
      // Derive from directory name
      const path = await import("path");
      targetPackageName = path.basename(selected.uri.fsPath);
    }

    const symbolRange = new vscode.Range(
      symbol.range.start.line,
      0,
      symbol.range.end.line,
      symbol.range.end.character,
    );
    const symbolText = sourceDoc.getText(symbolRange);

    // Pick or create a target .go file
    let targetFileUri: vscode.Uri;
    if (dirFiles.length > 0) {
      const fileChoices = [
        {
          label: "$(new-file) Create new file...",
          uri: undefined as vscode.Uri | undefined,
        },
        ...dirFiles.map((f) => ({
          label: vscode.workspace.asRelativePath(f),
          uri: f,
        })),
      ];
      const fileChoice = await vscode.window.showQuickPick(fileChoices, {
        placeHolder: "Append to existing file or create new",
      });
      if (!fileChoice) {
        return;
      }
      if (fileChoice.uri) {
        targetFileUri = fileChoice.uri;
      } else {
        const newName = await vscode.window.showInputBox({
          prompt: "New file name (without .go)",
          value: plainName.toLowerCase(),
        });
        if (!newName) {
          return;
        }
        const path = await import("path");
        targetFileUri = vscode.Uri.file(
          path.join(selected.uri.fsPath, `${newName}.go`),
        );
      }
    } else {
      const path = await import("path");
      targetFileUri = vscode.Uri.file(
        path.join(selected.uri.fsPath, `${plainName.toLowerCase()}.go`),
      );
    }

    // Check if file exists
    let targetExists = false;
    try {
      await vscode.workspace.openTextDocument(targetFileUri);
      targetExists = true;
    } catch {
      targetExists = false;
    }

    const edit = new vscode.WorkspaceEdit();

    if (targetExists) {
      const targetDoc = await vscode.workspace.openTextDocument(targetFileUri);
      const insertPos = targetDoc.positionAt(targetDoc.getText().length);
      edit.insert(targetFileUri, insertPos, `\n\n${symbolText}`);
    } else {
      edit.createFile(targetFileUri, { ignoreIfExists: false });
      edit.insert(
        targetFileUri,
        new vscode.Position(0, 0),
        `package ${targetPackageName}\n\n${symbolText}`,
      );
    }

    // Delete from source
    // Include a leading blank line if there is one before the symbol
    const startLine = symbol.range.start.line;
    const deleteStart =
      startLine > 0 && sourceDoc.lineAt(startLine - 1).text.trim() === ""
        ? new vscode.Position(startLine - 1, 0)
        : new vscode.Position(startLine, 0);
    const deleteEnd =
      symbol.range.end.line + 1 < sourceDoc.lineCount
        ? new vscode.Position(symbol.range.end.line + 1, 0)
        : new vscode.Position(
            symbol.range.end.line,
            symbol.range.end.character,
          );
    edit.delete(uri, new vscode.Range(deleteStart, deleteEnd));

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      await vscode.window.showTextDocument(targetFileUri);
      vscode.window.showInformationMessage(
        `Moved ${plainName} to ${vscode.workspace.asRelativePath(targetFileUri)}. Update imports manually if needed.`,
      );
    } else {
      vscode.window.showErrorMessage(`Failed to move ${plainName}`);
    }
  } catch (error) {
    console.error("Error moving to package:", error);
    vscode.window.showErrorMessage(`Error: ${error}`);
  }
}

// Helper function to find a symbol by name and kind
function findSymbol(
  symbols: vscode.DocumentSymbol[],
  name: string,
  kind: vscode.SymbolKind,
): vscode.DocumentSymbol | null {
  for (const symbol of symbols) {
    if (symbol.name === name && symbol.kind === kind) {
      return symbol;
    }
    if (symbol.children) {
      const found = findSymbol(symbol.children, name, kind);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

// Helper function to swap two symbols
async function swapSymbols(
  document: vscode.TextDocument,
  uri: vscode.Uri,
  first: vscode.DocumentSymbol,
  second: vscode.DocumentSymbol,
): Promise<void> {
  try {
    const firstText = document.getText(first.range);
    const secondText = document.getText(second.range);

    const edit = new vscode.WorkspaceEdit();

    // Replace in reverse order to avoid offset issues
    edit.replace(uri, second.range, firstText);
    edit.replace(uri, first.range, secondText);

    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
      await vscode.commands.executeCommand("editor.action.formatDocument");
      vscode.window.showInformationMessage("Symbols swapped");
    } else {
      vscode.window.showErrorMessage("Failed to swap symbols");
    }
  } catch (error) {
    console.error("Error swapping symbols:", error);
    vscode.window.showErrorMessage(`Error: ${error}`);
  }
}

// Helper function to infer basic types from expressions
function inferBasicType(expr: string): string | null {
  const trimmed = expr.trim();

  // String literals
  if (trimmed.startsWith('"') || trimmed.startsWith("`")) {
    return "string";
  }

  // Boolean
  if (trimmed === "true" || trimmed === "false") {
    return "bool";
  }

  // Integer (without decimal point)
  if (/^-?\d+$/.test(trimmed)) {
    return "int";
  }

  // Float (with decimal point or scientific notation)
  if (/^-?\d+\.\d+$/.test(trimmed) || /^-?\d+\.?\d*e[+-]?\d+$/i.test(trimmed)) {
    return "float64";
  }

  // Rune literal
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return "rune";
  }

  // Array/slice literals
  if (trimmed.startsWith("[]")) {
    return null; // Too complex, let gopls handle it
  }

  // Map literals
  if (trimmed.startsWith("map[")) {
    return null; // Too complex, let gopls handle it
  }

  // Struct literals
  if (/^\w+\{/.test(trimmed)) {
    return null; // Too complex, let gopls handle it
  }

  // Function calls or complex expressions
  if (trimmed.includes("(")) {
    return null; // Too complex, let gopls handle it
  }

  return null;
}

// This method is called when your extension is deactivated
export function deactivate() {}
