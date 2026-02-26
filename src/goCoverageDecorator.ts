import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

interface CoverageData {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  statements: number;
  count: number;
}

export class GoCoverageDecorator {
  private coveredDecorationType!: vscode.TextEditorDecorationType;
  private uncoveredDecorationType!: vscode.TextEditorDecorationType;
  private coverageData: Map<string, CoverageData[]> = new Map();
  private lastLoadedFilePath: string | undefined;

  getLastLoadedFilePath(): string | undefined {
    return this.lastLoadedFilePath;
  }

  constructor() {
    this.createDecorationTypes();
  }

  private createDecorationTypes(): void {
    const config = vscode.workspace.getConfiguration(
      "goAssistant.coverageDecorator",
    );

    const coveredHighlight = config.get<string>(
      "coveredHighlightColor",
      "rgba(100, 200, 100, 0.30)",
    );
    const uncoveredHighlight = config.get<string>(
      "uncoveredHighlightColor",
      "rgba(255, 182, 193, 0.25)",
    );
    const coveredBorder = config.get<string>(
      "coveredBorderColor",
      "rgba(100, 200, 100, 0.8)",
    );
    const uncoveredBorder = config.get<string>(
      "uncoveredBorderColor",
      "rgba(255, 100, 100, 0.8)",
    );

    this.coveredDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: coveredHighlight,
      isWholeLine: true,
      overviewRulerColor: coveredBorder,
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    this.uncoveredDecorationType = vscode.window.createTextEditorDecorationType(
      {
        backgroundColor: uncoveredHighlight,
        isWholeLine: true,
        overviewRulerColor: uncoveredBorder,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
      },
    );
  }

  refreshDecorationTypes(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.languageId === "go") {
        editor.setDecorations(this.coveredDecorationType, []);
        editor.setDecorations(this.uncoveredDecorationType, []);
      }
    }
    this.coveredDecorationType.dispose();
    this.uncoveredDecorationType.dispose();
    this.createDecorationTypes();
  }

  async loadCoverageFromFile(coverageFilePath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(coverageFilePath)) {
        console.log("Coverage file not found:", coverageFilePath);
        return false;
      }

      const content = fs.readFileSync(coverageFilePath, "utf-8");
      this.parseCoverageData(content);
      this.lastLoadedFilePath = coverageFilePath;
      return true;
    } catch (error) {
      console.error("Error loading coverage file:", error);
      return false;
    }
  }

  private parseCoverageData(content: string): void {
    this.coverageData.clear();

    const lines = content.split("\n");

    // Skip the first line (mode declaration)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        continue;
      }

      // Format: file.go:startLine.startCol,endLine.endCol numStmts count
      const match = line.match(
        /^(.+):(\d+)\.(\d+),(\d+)\.(\d+)\s+(\d+)\s+(\d+)$/,
      );
      if (match) {
        const file = match[1];
        const data: CoverageData = {
          file: file,
          startLine: parseInt(match[2]) - 1, // VS Code uses 0-based lines
          startCol: parseInt(match[3]) - 1,
          endLine: parseInt(match[4]) - 1,
          endCol: parseInt(match[5]) - 1,
          statements: parseInt(match[6]),
          count: parseInt(match[7]),
        };

        if (!this.coverageData.has(file)) {
          this.coverageData.set(file, []);
        }
        this.coverageData.get(file)!.push(data);
      }
    }

    console.log(`Parsed coverage for ${this.coverageData.size} files`);
  }

  applyDecorationsToEditor(editor: vscode.TextEditor): void {
    const documentPath = editor.document.uri.fsPath;

    // Find coverage data for this file (match by file suffix)
    let fileCoverage: CoverageData[] | undefined;

    for (const [coverageFile, data] of this.coverageData.entries()) {
      if (
        documentPath.endsWith(coverageFile) ||
        coverageFile.endsWith(path.basename(documentPath))
      ) {
        fileCoverage = data;
        break;
      }
    }

    if (!fileCoverage) {
      // No coverage data for this file
      return;
    }

    // Group coverage by line to avoid overlapping decorations causing different shades
    const linesCovered = new Set<number>();
    const linesUncovered = new Set<number>();

    for (const coverage of fileCoverage) {
      // Add all lines in range
      for (let line = coverage.startLine; line <= coverage.endLine; line++) {
        if (coverage.count > 0) {
          linesCovered.add(line);
          linesUncovered.delete(line); // Remove from uncovered if already there
        } else if (!linesCovered.has(line)) {
          // Only add to uncovered if not already covered
          linesUncovered.add(line);
        }
      }
    }

    // Create ranges from line sets
    const coveredRanges: vscode.Range[] = Array.from(linesCovered).map(
      (line) => new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
    );

    const uncoveredRanges: vscode.Range[] = Array.from(linesUncovered).map(
      (line) => new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
    );

    editor.setDecorations(this.coveredDecorationType, coveredRanges);
    editor.setDecorations(this.uncoveredDecorationType, uncoveredRanges);

    console.log(
      `Applied decorations to ${documentPath}: ${coveredRanges.length} covered, ${uncoveredRanges.length} uncovered`,
    );
  }

  applyDecorationsToAllEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.languageId === "go") {
        this.applyDecorationsToEditor(editor);
      }
    }
    vscode.commands.executeCommand(
      "setContext",
      "goAssistant.coverageAvailable",
      true,
    );
  }

  clearDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.languageId === "go") {
        editor.setDecorations(this.coveredDecorationType, []);
        editor.setDecorations(this.uncoveredDecorationType, []);
      }
    }
    this.coverageData.clear();
    vscode.commands.executeCommand(
      "setContext",
      "goAssistant.coverageAvailable",
      false,
    );
    console.log("Cleared all coverage decorations");
  }

  dispose(): void {
    this.coveredDecorationType.dispose();
    this.uncoveredDecorationType.dispose();
    this.clearDecorations();
  }
}
