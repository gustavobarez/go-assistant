import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface TestInfo {
  name: string;
  line: number;
  file: string;
  packagePath: string;
  status?: "pass" | "fail" | "running" | "unknown";
}

export interface TestFileInfo {
  file: string;
  packagePath: string;
  tests: TestInfo[];
}

export interface TestPackageInfo {
  packagePath: string;
  packageName: string;
  files: TestFileInfo[];
}

type TestTreeItemType = "package" | "file" | "test" | "root";

class TestTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: TestTreeItemType,
    public readonly contextValue?: string,
    public readonly testInfo?: TestInfo,
    public readonly fileInfo?: TestFileInfo,
    public readonly packageInfo?: TestPackageInfo,
  ) {
    super(label, collapsibleState);

    // Set icons based on type
    if (itemType === "package") {
      this.iconPath = new vscode.ThemeIcon("package");
    } else if (itemType === "file") {
      // Set resourceUri for files to let VS Code use theme's file icon
      if (fileInfo?.file) {
        this.resourceUri = vscode.Uri.file(fileInfo.file);
        // Also explicitly set to use file icon from theme
        this.iconPath = vscode.ThemeIcon.File;
      }
    } else if (itemType === "test") {
      // Set icon based on test status
      if (testInfo?.status === "pass") {
        this.iconPath = new vscode.ThemeIcon(
          "pass",
          new vscode.ThemeColor("testing.iconPassed"),
        );
      } else if (testInfo?.status === "fail") {
        this.iconPath = new vscode.ThemeIcon(
          "error",
          new vscode.ThemeColor("testing.iconFailed"),
        );
      } else if (testInfo?.status === "running") {
        this.iconPath = new vscode.ThemeIcon(
          "sync~spin",
          new vscode.ThemeColor("testing.iconQueued"),
        );
      } else {
        this.iconPath = new vscode.ThemeIcon("symbol-method");
      }
    }

    // Set command for test items to navigate to test
    if (testInfo) {
      this.command = {
        command: "vscode.open",
        title: "Go to Test",
        arguments: [
          vscode.Uri.file(testInfo.file),
          {
            selection: new vscode.Range(
              new vscode.Position(testInfo.line, 0),
              new vscode.Position(testInfo.line, 0),
            ),
            preview: false,
          },
        ],
      };
      this.tooltip = `${path.basename(testInfo.file)}:${testInfo.line + 1}`;
    } else if (fileInfo) {
      this.tooltip = fileInfo.file;
      this.description = `${fileInfo.tests.length} test${fileInfo.tests.length !== 1 ? "s" : ""}`;
    } else if (packageInfo) {
      const totalTests = packageInfo.files.reduce(
        (sum, f) => sum + f.tests.length,
        0,
      );
      this.description = `${totalTests} test${totalTests !== 1 ? "s" : ""}`;
      this.tooltip = packageInfo.packagePath;
    }
  }
}

export class GoTestsViewProvider implements vscode.TreeDataProvider<TestTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    TestTreeItem | undefined | null | void
  > = new vscode.EventEmitter<TestTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    TestTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private packages: TestPackageInfo[] = [];
  private workspacePath?: string;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async discoverTests(workspacePath?: string): Promise<void> {
    this.workspacePath =
      workspacePath ||
      vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ||
      "";

    if (!this.workspacePath) {
      this.packages = [];
      this.refresh();
      return;
    }

    this.packages = await this.findAllTests(this.workspacePath);
    this.refresh();
  }

  private async findAllTests(rootPath: string): Promise<TestPackageInfo[]> {
    const packages = new Map<string, TestPackageInfo>();

    // Find all *_test.go files
    const testFiles = await vscode.workspace.findFiles(
      new vscode.RelativePattern(rootPath, "**/*_test.go"),
      "**/vendor/**",
    );

    for (const fileUri of testFiles) {
      const filePath = fileUri.fsPath;
      const packagePath = path.dirname(filePath);
      const packageName = path.basename(packagePath);

      // Parse tests from file
      const tests = await this.parseTestsFromFile(filePath, packagePath);

      if (tests.length === 0) {
        continue;
      }

      if (!packages.has(packagePath)) {
        packages.set(packagePath, {
          packagePath,
          packageName,
          files: [],
        });
      }

      packages.get(packagePath)!.files.push({
        file: filePath,
        packagePath,
        tests,
      });
    }

    // Sort packages by path
    return Array.from(packages.values()).sort((a, b) =>
      a.packagePath.localeCompare(b.packagePath),
    );
  }

  private async parseTestsFromFile(
    filePath: string,
    packagePath: string,
  ): Promise<TestInfo[]> {
    const tests: TestInfo[] = [];

    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip commented lines
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("//")) {
          continue;
        }
        // Match test functions: func TestXxx(t *testing.T)
        const testMatch = line.match(
          /^func\s+(Test[A-Z]\w*|Benchmark[A-Z]\w*|Example[A-Z]\w*)\s*\(/,
        );

        if (testMatch) {
          const testName = testMatch[1];
          tests.push({
            name: testName,
            line: i,
            file: filePath,
            packagePath,
          });
        }
      }
    } catch (error) {
      console.error(`Error parsing tests from ${filePath}:`, error);
    }

    return tests;
  }

  getTreeItem(element: TestTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TestTreeItem): Promise<TestTreeItem[]> {
    if (!element) {
      // Root level - show packages
      if (this.packages.length === 0) {
        return [
          new TestTreeItem(
            "No tests found",
            vscode.TreeItemCollapsibleState.None,
            "root",
          ),
        ];
      }

      return this.packages.map(
        (pkg) =>
          new TestTreeItem(
            pkg.packageName,
            vscode.TreeItemCollapsibleState.Expanded,
            "package",
            "package",
            undefined,
            undefined,
            pkg,
          ),
      );
    }

    if (element.itemType === "package" && element.packageInfo) {
      // Show files in package
      return element.packageInfo.files.map(
        (file) =>
          new TestTreeItem(
            path.basename(file.file),
            vscode.TreeItemCollapsibleState.Expanded,
            "file",
            "file",
            undefined,
            file,
            element.packageInfo,
          ),
      );
    }

    if (element.itemType === "file" && element.fileInfo) {
      // Show tests in file
      return element.fileInfo.tests.map(
        (test) =>
          new TestTreeItem(
            test.name,
            vscode.TreeItemCollapsibleState.None,
            "test",
            "test",
            test,
            element.fileInfo,
            element.packageInfo,
          ),
      );
    }

    return [];
  }

  getPackages(): TestPackageInfo[] {
    return this.packages;
  }

  getTotalTestCount(): number {
    return this.packages.reduce(
      (sum, pkg) =>
        sum +
        pkg.files.reduce((fileSum, file) => fileSum + file.tests.length, 0),
      0,
    );
  }

  updateTestStatus(
    testName: string,
    packagePath: string,
    status: "pass" | "fail" | "running" | "unknown",
  ): void {
    for (const pkg of this.packages) {
      if (pkg.packagePath === packagePath) {
        for (const file of pkg.files) {
          for (const test of file.tests) {
            if (test.name === testName) {
              test.status = status;
              this.refresh();
              return;
            }
          }
        }
      }
    }
  }

  clearAllTestStatuses(): void {
    for (const pkg of this.packages) {
      for (const file of pkg.files) {
        for (const test of file.tests) {
          test.status = "unknown";
        }
      }
    }
    this.refresh();
  }
}
