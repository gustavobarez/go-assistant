import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { findGoMod } from "./goModFinder";

// ─── Core data model ───────────────────────────────────────────────────────

export interface SubTestInfo {
  name: string; // sub-test name only, e.g. "case1"
  fullName: string; // "TestFoo/case1"
  parentName: string; // "TestFoo"
  line?: number; // line of t.Run call
  file: string;
  packagePath: string;
  status?: "pass" | "fail" | "running" | "unknown";
  duration?: number;
}

export interface TestInfo {
  name: string;
  line: number;
  file: string;
  packagePath: string;
  status?: "pass" | "fail" | "running" | "unknown";
  duration?: number; // seconds from last run
  subTests?: SubTestInfo[];
}

export interface TestFileInfo {
  file: string;
  packagePath: string;
  tests: TestInfo[];
}

export interface TestPackageInfo {
  packagePath: string;
  /** Relative import path from module root e.g. "internal/utils".
   *  For root packages: the actual Go `package` declaration (e.g. "main"). */
  packageName: string;
  files: TestFileInfo[];
}

export interface TestModuleInfo {
  /** Module name from go.mod, e.g. "github.com/foo/bar" */
  moduleName: string;
  /** Absolute path to the directory containing go.mod */
  moduleRoot: string;
  packages: TestPackageInfo[];
}

// ─── Run history ───────────────────────────────────────────────────────────

export interface TestRunEntry {
  testName: string;
  packagePath: string;
  file: string;
  status: "pass" | "fail" | "unknown";
  duration?: number;
}

export interface TestRunHistory {
  id: string;
  /** Human-readable title shown in the tree, e.g. "2026-02-20 14:30 · all tests" */
  label: string;
  timestamp: Date;
  entries: TestRunEntry[];
}

export interface LastRunSpec {
  type: "all" | "package" | "file" | "test";
  label: string;
  workspacePath?: string;
  packagePath?: string;
  testPattern?: string;
}

// ─── Test flag options ────────────────────────────────────────────────────

export interface TestFlagOption {
  id: string;
  flag: string; // CLI flag, e.g. "-race"
  label: string; // display name in QuickPick
  description: string;
  activeByDefault: boolean;
  promptForValue?: boolean; // shows InputBox when enabled
  valuePlaceholder?: string;
  defaultValue?: string; // pre-filled value for promptForValue flags
  external?: boolean; // handled externally in exec commands (e.g. coverprofile)
}

export const AVAILABLE_TEST_FLAGS: TestFlagOption[] = [
  // ── Output ────────────────────────────────────────────────────────────────
  {
    id: "verbose",
    flag: "-v",
    label: "Verbose (-v)",
    description: "Show all test output",
    activeByDefault: true,
  },
  {
    id: "fullpath",
    flag: "-fullpath",
    label: "Full Path (-fullpath)",
    description: "Show full file paths in test output",
    activeByDefault: true,
  },
  // ── Execution ─────────────────────────────────────────────────────────────
  {
    id: "timeout",
    flag: "-timeout",
    label: "Timeout (-timeout)",
    description: "Maximum time allowed for all tests to run (0 = no limit)",
    activeByDefault: true,
    promptForValue: true,
    valuePlaceholder: "e.g. 30s, 2m, 0",
    defaultValue: "30s",
  },
  {
    id: "count",
    flag: "-count=1",
    label: "No Cache (-count=1)",
    description: "Disable test result caching",
    activeByDefault: false,
  },
  {
    id: "race",
    flag: "-race",
    label: "Race Detector (-race)",
    description: "Detect race conditions",
    activeByDefault: false,
  },
  {
    id: "bench",
    flag: "-bench=.",
    label: "Benchmarks (-bench=.)",
    description: "Also run all benchmarks",
    activeByDefault: false,
  },
  {
    id: "run",
    flag: "-run",
    label: "Filter (-run=...)",
    description:
      "Only run tests matching a regex (applied to run-all / package / file commands)",
    activeByDefault: false,
    promptForValue: true,
    valuePlaceholder: "e.g. TestFoo|TestBar",
  },
  // ── Coverage ──────────────────────────────────────────────────────────────
  {
    id: "coverprofile",
    flag: "-coverprofile",
    label: "Coverage Profile (save to file)",
    description: "Highlight covered and uncovered lines directly in the editor",
    activeByDefault: true,
    external: true,
  },
  {
    id: "coverpkg",
    flag: "-coverpkg=./...",
    label: "Shared Coverage (-coverpkg=./...)",
    description: "Measure coverage across all packages in the module",
    activeByDefault: false,
  },
];

type TestTreeItemType =
  | "module"
  | "package"
  | "file"
  | "test"
  | "subtest"
  | "root"
  | "historyRoot"
  | "historyRun"
  | "historyTest";

class TestTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: TestTreeItemType,
    public readonly contextValue?: string,
    public readonly testInfo?: TestInfo,
    public readonly fileInfo?: TestFileInfo,
    public readonly packageInfo?: TestPackageInfo,
    public readonly moduleInfo?: TestModuleInfo,
    public readonly historyRun?: TestRunHistory,
    public readonly historyEntry?: TestRunEntry,
    public readonly subTestInfo?: SubTestInfo,
  ) {
    super(label, collapsibleState);

    switch (itemType) {
      case "module":
        this.iconPath = new vscode.ThemeIcon("package");
        if (moduleInfo) {
          const totalTests = moduleInfo.packages.reduce(
            (s, p) => s + p.files.reduce((fs, f) => fs + f.tests.length, 0),
            0,
          );
          const totalDuration = moduleInfo.packages.reduce(
            (ms, p) =>
              ms +
              p.files.reduce(
                (fs, f) =>
                  fs + f.tests.reduce((ts, t) => ts + (t.duration ?? 0), 0),
                0,
              ),
            0,
          );
          const hasDuration = moduleInfo.packages.some((p) =>
            p.files.some((f) => f.tests.some((t) => t.duration !== undefined)),
          );
          this.description = hasDuration
            ? `${totalTests} test${totalTests !== 1 ? "s" : ""} · ${totalDuration.toFixed(2)}s`
            : `${totalTests} test${totalTests !== 1 ? "s" : ""}`;
          this.tooltip = moduleInfo.moduleRoot;
        }
        break;

      case "package":
        this.iconPath = new vscode.ThemeIcon("symbol-namespace");
        if (packageInfo) {
          const totalTests = packageInfo.files.reduce(
            (s, f) => s + f.tests.length,
            0,
          );
          const totalDuration = packageInfo.files.reduce((s, f) => {
            return s + f.tests.reduce((ts, t) => ts + (t.duration ?? 0), 0);
          }, 0);
          const hasDuration = packageInfo.files.some((f) =>
            f.tests.some((t) => t.duration !== undefined),
          );
          this.description = hasDuration
            ? `${totalTests} test${totalTests !== 1 ? "s" : ""} · ${totalDuration.toFixed(2)}s`
            : `${totalTests} test${totalTests !== 1 ? "s" : ""}`;
          this.tooltip = packageInfo.packagePath;
        }
        break;

      case "file":
        if (fileInfo?.file) {
          this.resourceUri = vscode.Uri.file(fileInfo.file);
          this.iconPath = vscode.ThemeIcon.File;
        }
        if (fileInfo) {
          const count = fileInfo.tests.length;
          const totalDuration = fileInfo.tests.reduce(
            (s, t) => s + (t.duration ?? 0),
            0,
          );
          const hasDuration = fileInfo.tests.some(
            (t) => t.duration !== undefined,
          );
          this.description = hasDuration
            ? `${count} test${count !== 1 ? "s" : ""} · ${totalDuration.toFixed(2)}s`
            : `${count} test${count !== 1 ? "s" : ""}`;
          this.tooltip = fileInfo.file;
        }
        break;

      case "test":
        this._applyTestStatusIcon(testInfo?.status);
        if (testInfo) {
          this.description =
            testInfo.duration !== undefined
              ? `(${testInfo.duration.toFixed(2)}s)`
              : undefined;
          this.command =
            testInfo.subTests && testInfo.subTests.length > 0
              ? undefined // expandable – don't navigate on click
              : {
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
        }
        break;

      case "subtest":
        this._applyTestStatusIcon(subTestInfo?.status);
        if (subTestInfo) {
          this.description =
            subTestInfo.duration !== undefined
              ? `(${subTestInfo.duration.toFixed(2)}s)`
              : undefined;
          this.tooltip = subTestInfo.fullName;
          if (subTestInfo.line !== undefined) {
            this.command = {
              command: "vscode.open",
              title: "Go to Sub-test",
              arguments: [
                vscode.Uri.file(subTestInfo.file),
                {
                  selection: new vscode.Range(
                    new vscode.Position(subTestInfo.line, 0),
                    new vscode.Position(subTestInfo.line, 0),
                  ),
                  preview: false,
                },
              ],
            };
          }
        }
        break;

      case "historyRoot":
        this.iconPath = new vscode.ThemeIcon("history");
        this.tooltip = "Run History";
        break;

      case "historyRun":
        if (historyRun) {
          const pass = historyRun.entries.filter(
            (e) => e.status === "pass",
          ).length;
          const fail = historyRun.entries.filter(
            (e) => e.status === "fail",
          ).length;
          this.description = `${pass} pass${fail > 0 ? ` · ${fail} fail` : ""}`;
          this.iconPath =
            fail > 0
              ? new vscode.ThemeIcon(
                  "error",
                  new vscode.ThemeColor("testing.iconFailed"),
                )
              : new vscode.ThemeIcon(
                  "pass",
                  new vscode.ThemeColor("testing.iconPassed"),
                );
          this.tooltip = historyRun.timestamp.toLocaleString();
        }
        break;

      case "historyTest":
        this._applyTestStatusIcon(
          historyEntry?.status as TestInfo["status"] | undefined,
        );
        if (historyEntry) {
          this.description =
            historyEntry.duration !== undefined
              ? `(${historyEntry.duration.toFixed(2)}s)`
              : undefined;
          this.command = {
            command: "vscode.open",
            title: "Go to Test",
            arguments: [vscode.Uri.file(historyEntry.file)],
          };
        }
        break;

      case "root":
        break;
    }
  }

  private _applyTestStatusIcon(
    status: "pass" | "fail" | "running" | "unknown" | undefined,
  ): void {
    if (status === "pass") {
      this.iconPath = new vscode.ThemeIcon(
        "pass",
        new vscode.ThemeColor("testing.iconPassed"),
      );
    } else if (status === "fail") {
      this.iconPath = new vscode.ThemeIcon(
        "error",
        new vscode.ThemeColor("testing.iconFailed"),
      );
    } else if (status === "running") {
      this.iconPath = new vscode.ThemeIcon(
        "sync~spin",
        new vscode.ThemeColor("testing.iconQueued"),
      );
    } else {
      this.iconPath = new vscode.ThemeIcon("symbol-method");
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

  private modules: TestModuleInfo[] = [];
  private runHistory: TestRunHistory[] = [];
  private lastRunSpec?: LastRunSpec;
  private readonly MAX_HISTORY = 10;
  private workspacePath?: string;
  private activeFlags: Set<string>;
  private flagValues: Record<string, string>;

  constructor(private readonly context: vscode.ExtensionContext) {
    const saved = context.workspaceState.get<string[]>(
      "goAssistant.testFlags",
      AVAILABLE_TEST_FLAGS.filter((f) => f.activeByDefault).map((f) => f.id),
    );
    // Track which flag IDs have ever been seen so we can auto-enable
    // newly-added activeByDefault flags without overriding user choices.
    const knownIds = new Set(
      context.workspaceState.get<string[]>("goAssistant.knownFlagIds", []),
    );
    const merged = new Set(saved);
    const allCurrentIds = AVAILABLE_TEST_FLAGS.map((f) => f.id);
    for (const f of AVAILABLE_TEST_FLAGS) {
      if (f.activeByDefault && !knownIds.has(f.id)) {
        merged.add(f.id);
      }
    }
    context.workspaceState.update("goAssistant.knownFlagIds", allCurrentIds);
    context.workspaceState.update("goAssistant.testFlags", [...merged]);
    this.activeFlags = merged;
    this.flagValues = context.workspaceState.get<Record<string, string>>(
      "goAssistant.testFlagValues",
      {},
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // ── Flag management ────────────────────────────────────────────────────────

  getActiveFlagIds(): string[] {
    return [...this.activeFlags];
  }

  getFlagValues(): Record<string, string> {
    return { ...this.flagValues };
  }

  setActiveFlags(ids: string[], values: Record<string, string>): void {
    this.activeFlags = new Set(ids);
    this.flagValues = values;
    this.context.workspaceState.update("goAssistant.testFlags", ids);
    this.context.workspaceState.update("goAssistant.testFlagValues", values);
  }

  /**
   * Build the extra flags string for a `go test` invocation.
   * @param skipRun Skip the global `-run` filter (use when the command provides its own -run).
   * @param coverageFile If provided and the "coverprofile" flag is active, appends
   *                     `-coverprofile="<path>"` to the output.
   */
  buildExtraFlags(skipRun = false, coverageFile?: string): string {
    const parts: string[] = [];
    for (const f of AVAILABLE_TEST_FLAGS) {
      if (!this.activeFlags.has(f.id)) continue;
      if (f.external) continue; // handled below or externally
      if (f.id === "run" && skipRun) continue;
      if (f.promptForValue) {
        const val = this.flagValues[f.id] ?? f.defaultValue ?? "";
        if (val) parts.push(`${f.flag}="${val}"`);
      } else {
        parts.push(f.flag);
      }
    }
    // Append coverprofile after other flags
    if (coverageFile && this.activeFlags.has("coverprofile")) {
      parts.push(`-coverprofile="${coverageFile}"`);
    }
    return parts.join(" ");
  }

  isFlagActive(id: string): boolean {
    return this.activeFlags.has(id);
  }

  async discoverTests(workspacePath?: string): Promise<void> {
    this.workspacePath =
      workspacePath ||
      vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ||
      "";

    if (!this.workspacePath) {
      this.modules = [];
      this.refresh();
      return;
    }

    this.modules = await this.findAllTests(this.workspacePath);
    this.refresh();
  }

  // ── Discovery ────────────────────────────────────────────────────────────

  private async findAllTests(rootPath: string): Promise<TestModuleInfo[]> {
    const modulesMap = new Map<string, TestModuleInfo>();
    const packagesMap = new Map<string, TestPackageInfo>();

    const testFiles = await vscode.workspace.findFiles(
      new vscode.RelativePattern(rootPath, "**/*_test.go"),
      "**/vendor/**",
    );

    for (const fileUri of testFiles) {
      const filePath = fileUri.fsPath;
      const packagePath = path.dirname(filePath);

      // Resolve module root + module name
      const goModPath = await findGoMod(packagePath);
      const moduleRoot = goModPath ? path.dirname(goModPath) : rootPath;
      const moduleName = goModPath
        ? ((await this.parseModuleName(goModPath)) ?? path.basename(moduleRoot))
        : path.basename(moduleRoot);

      // Compute human-readable package label (relative import path)
      const relPkg = path.relative(moduleRoot, packagePath);
      let packageName: string;
      if (relPkg === "" || relPkg === ".") {
        // Root package – read actual `package` declaration
        packageName = (await this.readPackageDeclaration(filePath)) ?? "main";
      } else {
        packageName = relPkg.replace(/\\/g, "/");
      }

      // Parse tests
      const tests = await this.parseTestsFromFile(filePath, packagePath);
      if (tests.length === 0) {
        continue;
      }

      // Build package entry
      if (!packagesMap.has(packagePath)) {
        packagesMap.set(packagePath, { packagePath, packageName, files: [] });
      }
      packagesMap
        .get(packagePath)!
        .files.push({ file: filePath, packagePath, tests });

      // Build module entry (just a placeholder — packages are assigned below)
      if (!modulesMap.has(moduleRoot)) {
        modulesMap.set(moduleRoot, { moduleName, moduleRoot, packages: [] });
      }
    }

    // Assign packages to their owning module (longest matching prefix wins)
    for (const [packagePath, pkg] of packagesMap) {
      let bestModule: TestModuleInfo | undefined;
      let bestLength = -1;
      for (const [moduleRoot, mod] of modulesMap) {
        const rel = path.relative(moduleRoot, packagePath);
        if (!rel.startsWith("..")) {
          if (moduleRoot.length > bestLength) {
            bestLength = moduleRoot.length;
            bestModule = mod;
          }
        }
      }
      bestModule?.packages.push(pkg);
    }

    // Sort everything
    const result = Array.from(modulesMap.values()).sort((a, b) =>
      a.moduleName.localeCompare(b.moduleName),
    );
    for (const mod of result) {
      mod.packages.sort((a, b) => a.packageName.localeCompare(b.packageName));
      for (const pkg of mod.packages) {
        pkg.files.sort((a, b) =>
          path.basename(a.file).localeCompare(path.basename(b.file)),
        );
      }
    }
    return result;
  }

  private async parseModuleName(
    goModPath: string,
  ): Promise<string | undefined> {
    try {
      const content = await fs.promises.readFile(goModPath, "utf-8");
      const match = content.match(/^module\s+(\S+)/m);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  private async readPackageDeclaration(
    filePath: string,
  ): Promise<string | undefined> {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const match = content.match(/^package\s+(\w+)/m);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  private async parseTestsFromFile(
    filePath: string,
    packagePath: string,
  ): Promise<TestInfo[]> {
    const tests: TestInfo[] = [];

    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      // First pass: find all top-level test function boundaries
      const testFunctions: {
        name: string;
        line: number;
        startIdx: number;
        endIdx: number;
      }[] = [];
      let braceDepth = 0;
      let inTestFunc = false;
      let currentTest: { name: string; line: number; startIdx: number } | null =
        null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith("//")) continue;

        const testMatch = line.match(
          /^func\s+(Test[A-Z]\w*|Benchmark[A-Z]\w*|Example[A-Z]\w*)\s*\(/,
        );

        if (testMatch && !inTestFunc) {
          currentTest = { name: testMatch[1], line: i, startIdx: i };
          inTestFunc = true;
          braceDepth = 0;
        }

        if (inTestFunc) {
          for (const ch of line) {
            if (ch === "{") braceDepth++;
            else if (ch === "}") {
              braceDepth--;
              if (braceDepth === 0) {
                if (currentTest) {
                  testFunctions.push({ ...currentTest, endIdx: i });
                }
                inTestFunc = false;
                currentTest = null;
                break;
              }
            }
          }
        }
      }

      // Second pass: for each test function, collect sub-tests via t.Run / b.Run
      for (const tf of testFunctions) {
        const subTests: SubTestInfo[] = [];
        const literalRunRegex = /[tb]\.Run\(\s*"([^"]+)"/g;
        // Matches variable-based t.Run(tt.name,...) or t.Run(tc.name,...) etc.
        const varRunRegex = /[tb]\.Run\(\s*[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?\s*,/;

        let hasVarRun = false;

        for (let i = tf.startIdx + 1; i <= tf.endIdx; i++) {
          const line = lines[i];
          if (line.trim().startsWith("//")) continue;

          // Literal t.Run("name", ...) — may appear multiple times per line
          literalRunRegex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = literalRunRegex.exec(line)) !== null) {
            const subName = m[1];
            const runName = subName.replace(/ /g, "_");
            subTests.push({
              name: subName,
              fullName: `${tf.name}/${runName}`,
              parentName: tf.name,
              line: i,
              file: filePath,
              packagePath,
            });
          }

          // Variable-based t.Run(tt.name, ...)
          if (!hasVarRun && varRunRegex.test(line)) {
            hasVarRun = true;
          }
        }

        // Table-driven pattern: if no literal runs but a variable-based t.Run was found,
        // try the `name: "case name"` named-field strategy (most common Go convention).
        // If that also fails, leave subTests as empty array [] so the tree shows the
        // node as expandable — subtests will be populated from run output.
        if (subTests.length === 0 && hasVarRun) {
          const funcBody = lines
            .slice(tf.startIdx + 1, tf.endIdx + 1)
            .join("\n");

          const namedFieldRegex = /\bname\s*:\s*"([^"]+)"/g;
          let nm: RegExpExecArray | null;
          while ((nm = namedFieldRegex.exec(funcBody)) !== null) {
            const subName = nm[1];
            const runName = subName.replace(/ /g, "_");
            subTests.push({
              name: subName,
              fullName: `${tf.name}/${runName}`,
              parentName: tf.name,
              file: filePath,
              packagePath,
            });
          }
        }

        tests.push({
          name: tf.name,
          line: tf.line,
          file: filePath,
          packagePath,
          // undefined  → regular test (no expansion)
          // []         → table-driven detected, names not yet known (expand after run)
          // [...]      → names known statically
          subTests: subTests.length > 0 ? subTests : hasVarRun ? [] : undefined,
        });
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
    // Root level
    if (!element) {
      const items: TestTreeItem[] = [];

      if (this.modules.length === 0) {
        items.push(
          new TestTreeItem(
            "No tests found",
            vscode.TreeItemCollapsibleState.None,
            "root",
          ),
        );
      } else {
        const singleModule = this.modules.length === 1;
        for (const mod of this.modules) {
          items.push(
            new TestTreeItem(
              mod.moduleName,
              singleModule
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed,
              "module",
              "module",
              undefined,
              undefined,
              undefined,
              mod,
            ),
          );
        }
      }

      if (this.runHistory.length > 0) {
        items.push(
          new TestTreeItem(
            "Run History",
            vscode.TreeItemCollapsibleState.Collapsed,
            "historyRoot",
            "historyRoot",
          ),
        );
      }

      return items;
    }

    // Module → packages
    if (element.itemType === "module" && element.moduleInfo) {
      return element.moduleInfo.packages.map(
        (pkg) =>
          new TestTreeItem(
            pkg.packageName,
            vscode.TreeItemCollapsibleState.Expanded,
            "package",
            "package",
            undefined,
            undefined,
            pkg,
            element.moduleInfo,
          ),
      );
    }

    // Package → files
    if (element.itemType === "package" && element.packageInfo) {
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
            element.moduleInfo,
          ),
      );
    }

    // File → tests
    if (element.itemType === "file" && element.fileInfo) {
      return element.fileInfo.tests.map(
        (test) =>
          new TestTreeItem(
            test.name,
            test.subTests !== undefined
              ? vscode.TreeItemCollapsibleState.Collapsed
              : vscode.TreeItemCollapsibleState.None,
            "test",
            test.subTests !== undefined ? "testWithSubs" : "test",
            test,
            element.fileInfo,
            element.packageInfo,
            element.moduleInfo,
          ),
      );
    }

    // Test → sub-tests
    if (
      element.itemType === "test" &&
      element.testInfo?.subTests !== undefined
    ) {
      if (element.testInfo.subTests.length === 0) {
        // Placeholder: subtests not yet discovered
        const placeholder = new vscode.TreeItem(
          "Run the test to discover sub-tests",
          vscode.TreeItemCollapsibleState.None,
        );
        placeholder.iconPath = new vscode.ThemeIcon(
          "info",
          new vscode.ThemeColor("descriptionForeground"),
        );
        return [placeholder as TestTreeItem];
      }
      return element.testInfo.subTests.map(
        (sub) =>
          new TestTreeItem(
            sub.name,
            vscode.TreeItemCollapsibleState.None,
            "subtest",
            "subtest",
            element.testInfo,
            element.fileInfo,
            element.packageInfo,
            element.moduleInfo,
            undefined,
            undefined,
            sub,
          ),
      );
    }

    // History root → individual runs
    if (element.itemType === "historyRoot") {
      return this.runHistory
        .slice()
        .reverse()
        .map(
          (run) =>
            new TestTreeItem(
              run.label,
              vscode.TreeItemCollapsibleState.Collapsed,
              "historyRun",
              "historyRun",
              undefined,
              undefined,
              undefined,
              undefined,
              run,
            ),
        );
    }

    // History run → test results
    if (element.itemType === "historyRun" && element.historyRun) {
      const sorted = [...element.historyRun.entries].sort((a, b) => {
        const order: Record<string, number> = { fail: 0, unknown: 1, pass: 2 };
        return (order[a.status] ?? 1) - (order[b.status] ?? 1);
      });
      return sorted.map(
        (entry) =>
          new TestTreeItem(
            entry.testName,
            vscode.TreeItemCollapsibleState.None,
            "historyTest",
            "historyTest",
            undefined,
            undefined,
            undefined,
            undefined,
            element.historyRun,
            entry,
          ),
      );
    }

    return [];
  }

  // ── Runtime sub-test discovery from test output ─────────────────────────────────

  /**
   * Parses `go test -v` output for `=== RUN   Parent/Sub` lines and
   * `--- PASS/FAIL: Parent/Sub (0.01s)` lines to dynamically populate
   * subtests on any test that has `subTests: []` (table-driven placeholder)
   * or merge into existing named subtests.
   */
  updateSubTestsFromOutput(output: string, packagePath?: string): void {
    // Collect all subtest names per parent from RUN lines
    const discovered = new Map<
      string,
      Map<string, { status: "pass" | "fail" | "unknown"; duration?: number }>
    >();

    // Parse === RUN   TestFoo/sub_name
    const runRegex = /=== RUN\s+(\w+)\/(\S+)/gm;
    let m: RegExpExecArray | null;
    while ((m = runRegex.exec(output)) !== null) {
      const parent = m[1];
      const rawSub = m[2];
      if (!discovered.has(parent)) discovered.set(parent, new Map());
      if (!discovered.get(parent)!.has(rawSub)) {
        discovered.get(parent)!.set(rawSub, { status: "unknown" });
      }
    }

    // Parse --- PASS/FAIL: TestFoo/sub_name (0.01s)
    const resultRegex = /--- (PASS|FAIL):\s+(\w+)\/(\S+)\s+\(([\d.]+)s\)/gm;
    while ((m = resultRegex.exec(output)) !== null) {
      const parent = m[2];
      const rawSub = m[3];
      const status = m[1] === "PASS" ? "pass" : "fail";
      const duration = parseFloat(m[4]);
      if (!discovered.has(parent)) discovered.set(parent, new Map());
      discovered.get(parent)!.set(rawSub, { status, duration });
    }

    if (discovered.size === 0) return;

    let changed = false;
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (packagePath && pkg.packagePath !== packagePath) continue;
        for (const file of pkg.files) {
          for (const test of file.tests) {
            const subs = discovered.get(test.name);
            if (!subs) continue;
            // Rebuild subTests list (preserve existing statically-found entries
            // or replace placeholder [] entirely with discovered ones)
            const newSubTests: SubTestInfo[] = [];
            for (const [rawSub, info] of subs) {
              // Go test replaces spaces with _ in run output.
              // For display, convert _ back to space when we know the name came from
              // output (heuristic: keep as-is, user sees exact run pattern).
              const displayName = rawSub.replace(/_/g, " ");
              newSubTests.push({
                name: displayName,
                fullName: `${test.name}/${rawSub}`,
                parentName: test.name,
                file: test.file,
                packagePath: pkg.packagePath,
                status: info.status,
                duration: info.duration,
              });
            }
            test.subTests = newSubTests;
            changed = true;
          }
        }
      }
    }

    if (changed) this.refresh();
  }

  // ── Status updates ────────────────────────────────────────────────────────

  updateTestStatus(
    testName: string,
    packagePath: string,
    status: "pass" | "fail" | "running" | "unknown",
    duration?: number,
  ): void {
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (pkg.packagePath === packagePath) {
          for (const file of pkg.files) {
            for (const test of file.tests) {
              if (test.name === testName) {
                test.status = status;
                if (duration !== undefined && status !== "running") {
                  test.duration = duration;
                }
                this.refresh();
                return;
              }
            }
          }
        }
      }
    }
  }

  updateSubTestStatus(
    parentTestName: string,
    subTestFullName: string,
    packagePath: string,
    status: "pass" | "fail" | "running" | "unknown",
    duration?: number,
  ): void {
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (pkg.packagePath === packagePath) {
          for (const file of pkg.files) {
            for (const test of file.tests) {
              if (test.name === parentTestName && test.subTests) {
                for (const sub of test.subTests) {
                  if (sub.fullName === subTestFullName) {
                    sub.status = status;
                    if (duration !== undefined && status !== "running") {
                      sub.duration = duration;
                    }
                    this.refresh();
                    return;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  clearAllTestStatuses(): void {
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        for (const file of pkg.files) {
          for (const test of file.tests) {
            test.status = "unknown";
            test.duration = undefined;
          }
        }
      }
    }
    this.refresh();
  }

  // ── Run history ───────────────────────────────────────────────────────────

  addToHistory(label: string, entries: TestRunEntry[]): void {
    if (entries.length === 0) {
      return;
    }
    const now = new Date();
    const id = `${now.getTime()}`;
    const timestamp = now.toLocaleString("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const fullLabel = `${timestamp} · ${label}`;
    this.runHistory.push({ id, label: fullLabel, timestamp: now, entries });
    if (this.runHistory.length > this.MAX_HISTORY) {
      this.runHistory.splice(0, this.runHistory.length - this.MAX_HISTORY);
    }
    this.refresh();
  }

  clearHistory(): void {
    this.runHistory = [];
    this.refresh();
  }

  getRunHistory(): TestRunHistory[] {
    return this.runHistory;
  }

  // ── Last run spec ─────────────────────────────────────────────────────────

  setLastRunSpec(spec: LastRunSpec): void {
    this.lastRunSpec = spec;
  }

  getLastRunSpec(): LastRunSpec | undefined {
    return this.lastRunSpec;
  }

  // ── Compatibility / utility ───────────────────────────────────────────────

  /** Flat list of all packages across all modules (for backward compat). */
  getPackages(): TestPackageInfo[] {
    return this.modules.flatMap((m) => m.packages);
  }

  getModules(): TestModuleInfo[] {
    return this.modules;
  }

  getTotalTestCount(): number {
    return this.modules.reduce(
      (ms, mod) =>
        ms +
        mod.packages.reduce(
          (ps, pkg) => ps + pkg.files.reduce((fs, f) => fs + f.tests.length, 0),
          0,
        ),
      0,
    );
  }
}
