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
  fileCoverage?: number;
  packageCoverage?: number;
}

export interface TestInfo {
  name: string;
  line: number;
  file: string;
  packagePath: string;
  status?: "pass" | "fail" | "running" | "unknown";
  duration?: number; // seconds from last run
  fileCoverage?: number;
  packageCoverage?: number;
  subTests?: SubTestInfo[];
}

export interface TestFileInfo {
  file: string;
  packagePath: string;
  coverage?: number;
  tests: TestInfo[];
}

export interface TestPackageInfo {
  packagePath: string;
  /** Relative import path from module root e.g. "internal/utils".
   *  For root packages: the actual Go `package` declaration (e.g. "main"). */
  packageName: string;
  coverage?: number;
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
  output?: string;
  packageCoverage?: number;
  fileCoverage?: number;
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

// ─── JSON Test Output Format (go test -json) ────────────────────────────────

export interface TestEventJSON {
  Time?: string; // RFC3339 format
  Action:
    | "start"
    | "run"
    | "pause"
    | "cont"
    | "pass"
    | "fail"
    | "output"
    | "skip"
    | "bench";
  Package: string;
  Test?: string;
  Elapsed?: number; // seconds
  Output?: string;
  FailedBuild?: string;
}

// ─── Test Results (with logs and coverage) ──────────────────────────────────

export interface TestOutputLog {
  testName: string;
  packagePath: string;
  output: string[]; // lines of output captured
  startTime?: Date;
  endTime?: Date;
  duration?: number; // seconds
  coverage?: number; // coverage percentage for this package
}

export interface TestResult {
  testName: string;
  packagePath: string;
  file: string;
  status: "pass" | "fail" | "skip" | "unknown";
  duration: number; // seconds
  output: TestOutputLog;
  subTestResults?: TestResult[];
}

// ─── Profiling mode ───────────────────────────────────────────────────────

export type ProfilingMode = "cpu" | "memory" | "blocking" | "mutex";

export const PROFILING_MODES: {
  id: ProfilingMode;
  label: string;
  flag: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "cpu",
    label: "CPU",
    flag: "-cpuprofile",
    description: "Record CPU usage",
    icon: "$(graph)",
  },
  {
    id: "memory",
    label: "Memory",
    flag: "-memprofile",
    description: "Record memory allocations",
    icon: "$(database)",
  },
  {
    id: "blocking",
    label: "Blocking",
    flag: "-blockprofile",
    description: "Record goroutine blocking",
    icon: "$(lock)",
  },
  {
    id: "mutex",
    label: "Mutex",
    flag: "-mutexprofile",
    description: "Record mutex contention",
    icon: "$(sync)",
  },
];

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
    activeByDefault: false,
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
    id: "parallel",
    flag: "-parallel",
    label: "Parallel (-parallel)",
    description: "Maximum number of tests to run in parallel",
    activeByDefault: false,
    promptForValue: true,
    valuePlaceholder: "2-4",
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
    flag: "-coverpkg",
    label: "Coverage Path (-coverpkg)",
    description:
      "Measure coverage for a specific set of packages (e.g. ./... for all)",
    activeByDefault: false,
    promptForValue: true,
    valuePlaceholder: "./...",
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
  | "historyPackage"
  | "historyFile"
  | "historyTest"
  | "resultsRoot"
  | "resultsPackage"
  | "resultTest";

function testLeafCount(test: TestInfo): number {
  if (test.subTests && test.subTests.length > 0) {
    return test.subTests.length;
  }
  return 1;
}

function testsLeafCount(tests: TestInfo[]): number {
  return tests.reduce((sum, test) => sum + testLeafCount(test), 0);
}

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
    public readonly resultPackagePath?: string,
    public readonly resultTest?: TestResult,
    public readonly historyPackagePath?: string,
    public readonly historyFilePath?: string,
  ) {
    super(label, collapsibleState);

    switch (itemType) {
      case "module":
        this.iconPath = new vscode.ThemeIcon("package");
        if (moduleInfo) {
          const totalTests = moduleInfo.packages.reduce(
            (s, p) =>
              s + p.files.reduce((fs, f) => fs + testsLeafCount(f.tests), 0),
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
            (s, f) => s + testsLeafCount(f.tests),
            0,
          );
          const totalDuration = packageInfo.files.reduce((s, f) => {
            return s + f.tests.reduce((ts, t) => ts + (t.duration ?? 0), 0);
          }, 0);
          const hasDuration = packageInfo.files.some((f) =>
            f.tests.some((t) => t.duration !== undefined),
          );
          const coveragePart =
            packageInfo.coverage !== undefined
              ? ` · ${packageInfo.coverage.toFixed(1)}%`
              : "";
          this.description = hasDuration
            ? `${totalTests} test${totalTests !== 1 ? "s" : ""} · ${totalDuration.toFixed(2)}s`
            : `${totalTests} test${totalTests !== 1 ? "s" : ""}`;
          this.description += coveragePart;
          this.tooltip = packageInfo.packagePath;
        }
        break;

      case "file":
        if (fileInfo?.file) {
          this.resourceUri = vscode.Uri.file(fileInfo.file);
          this.iconPath = vscode.ThemeIcon.File;
        }
        if (fileInfo) {
          const count = testsLeafCount(fileInfo.tests);
          const totalDuration = fileInfo.tests.reduce(
            (s, t) => s + (t.duration ?? 0),
            0,
          );
          const hasDuration = fileInfo.tests.some(
            (t) => t.duration !== undefined,
          );
          const coveragePart =
            fileInfo.coverage !== undefined
              ? ` · ${fileInfo.coverage.toFixed(1)}%`
              : "";
          this.description = hasDuration
            ? `${count} test${count !== 1 ? "s" : ""} · ${totalDuration.toFixed(2)}s`
            : `${count} test${count !== 1 ? "s" : ""}`;
          this.description += coveragePart;
          this.tooltip = fileInfo.file;
        }
        break;

      case "test":
        this._applyTestStatusIcon(testInfo?.status);
        if (testInfo) {
          const nestedCount = testLeafCount(testInfo);
          const coverageParts: string[] = [];
          if (testInfo.fileCoverage !== undefined) {
            coverageParts.push(`${testInfo.fileCoverage.toFixed(1)}%`);
          }
          if (testInfo.packageCoverage !== undefined) {
            coverageParts.push(`${testInfo.packageCoverage.toFixed(1)}%`);
          }
          this.description =
            testInfo.duration !== undefined
              ? `${testInfo.duration.toFixed(2)}s`
              : undefined;
          if (testInfo.subTests && testInfo.subTests.length > 0) {
            this.description = this.description
              ? `${nestedCount} tests · ${this.description}`
              : `${nestedCount} tests`;
          }
          if (coverageParts.length > 0) {
            this.description = this.description
              ? `${this.description} · ${coverageParts.join(" · ")}`
              : coverageParts.join(" · ");
          }
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
          const coverageParts: string[] = [];
          if (subTestInfo.fileCoverage !== undefined) {
            coverageParts.push(`${subTestInfo.fileCoverage.toFixed(1)}%`);
          }
          if (subTestInfo.packageCoverage !== undefined) {
            coverageParts.push(`${subTestInfo.packageCoverage.toFixed(1)}%`);
          }
          this.description =
            subTestInfo.duration !== undefined
              ? `${subTestInfo.duration.toFixed(2)}s`
              : undefined;
          if (coverageParts.length > 0) {
            this.description = this.description
              ? `${this.description} · ${coverageParts.join(" · ")}`
              : coverageParts.join(" · ");
          }
          this.tooltip = subTestInfo.fullName;
          if (testInfo?.line !== undefined) {
            this.command = {
              command: "vscode.open",
              title: "Go to Sub-test",
              arguments: [
                vscode.Uri.file(subTestInfo.file),
                {
                  selection: new vscode.Range(
                    new vscode.Position(testInfo.line, 0),
                    new vscode.Position(testInfo.line, 0),
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

      case "historyPackage":
        this.iconPath = new vscode.ThemeIcon("symbol-namespace");
        if (historyPackagePath) {
          this.tooltip = historyPackagePath;
        }
        break;

      case "historyFile":
        this.iconPath = vscode.ThemeIcon.File;
        if (historyFilePath) {
          this.tooltip = historyFilePath;
          if (path.isAbsolute(historyFilePath)) {
            this.resourceUri = vscode.Uri.file(historyFilePath);
          }
        }
        break;

      case "historyTest":
        this._applyTestStatusIcon(
          historyEntry?.status as TestInfo["status"] | undefined,
        );
        if (historyEntry) {
          const coverageParts: string[] = [];
          if (historyEntry.fileCoverage !== undefined) {
            coverageParts.push(`${historyEntry.fileCoverage.toFixed(1)}%`);
          }
          if (historyEntry.packageCoverage !== undefined) {
            coverageParts.push(`${historyEntry.packageCoverage.toFixed(1)}%`);
          }
          this.description =
            historyEntry.duration !== undefined
              ? `${historyEntry.duration.toFixed(2)}s`
              : undefined;
          if (coverageParts.length > 0) {
            this.description = this.description
              ? `${this.description} · ${coverageParts.join(" · ")}`
              : coverageParts.join(" · ");
          }
          if (
            this.collapsibleState === vscode.TreeItemCollapsibleState.None &&
            historyEntry.output &&
            historyEntry.output.trim().length > 0
          ) {
            this.command = {
              command: "go-assistant.openTestLog",
              title: "View Test Log",
              arguments: [this],
            };
          }
        }
        break;

      case "resultsRoot":
        this.iconPath = new vscode.ThemeIcon("output");
        this.tooltip = "Latest test logs and results";
        break;

      case "resultsPackage":
        this.iconPath = new vscode.ThemeIcon("symbol-namespace");
        if (resultPackagePath) {
          this.tooltip = resultPackagePath;
        }
        break;

      case "resultTest":
        this._applyTestStatusIcon(
          (resultTest?.status as TestInfo["status"] | undefined) ?? "unknown",
        );
        if (resultTest) {
          const coverageParts: string[] = [];
          if (resultTest.output.coverage !== undefined) {
            coverageParts.push(`p ${resultTest.output.coverage.toFixed(1)}%`);
          }
          const durationPart =
            resultTest.duration > 0
              ? `(${resultTest.duration.toFixed(2)}s)`
              : "";
          this.description = [durationPart, ...coverageParts]
            .filter(Boolean)
            .join(" · ");
          this.tooltip = `${resultTest.packagePath}\nClick to open log`;
          this.command = {
            command: "go-assistant.openTestLog",
            title: "Open Test Log",
            arguments: [resultTest.testName, resultTest.packagePath],
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
  private activeProfile: ProfilingMode | undefined;
  // ─── New: Test results with JSON parsing and coverage ────────────────────
  private testResults: Map<string, TestResult> = new Map(); // key: "packagePath::testName"
  private packageCoverage: Map<string, number> = new Map(); // key: PackagePath, value: coverage %
  private fileCoverage: Map<string, number> = new Map(); // key: file path, value: coverage %
  private packageAliases: Map<string, string> = new Map(); // key: import path, value: absolute package path
  private runningTestsByPackage: Map<string, Set<string>> = new Map();
  private searchQuery = "";

  private isVerboseLoggingEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("goAssistant.logging")
      .get<boolean>("verbose", false);
  }

  private debugLog(message: string): void {
    if (this.isVerboseLoggingEnabled()) {
      console.log(`[go-assistant:test-results] ${message}`);
    }
  }

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
    this.activeProfile = undefined;
    // Restore context key so when-clauses are correct after extension restart
    vscode.commands.executeCommand(
      "setContext",
      "goAssistant.profileActive",
      !!this.activeProfile,
    );
    vscode.commands.executeCommand(
      "setContext",
      "goAssistant.testsSearchActive",
      false,
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getSearchQuery(): string {
    return this.searchQuery;
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query.trim();
    vscode.commands.executeCommand(
      "setContext",
      "goAssistant.testsSearchActive",
      this.searchQuery.length > 0,
    );
    this.refresh();
  }

  clearSearchQuery(): void {
    this.setSearchQuery("");
  }

  private normalizedSearchQuery(): string {
    return this.searchQuery.toLowerCase();
  }

  private matchesSearch(value?: string): boolean {
    const q = this.normalizedSearchQuery();
    if (!q) {
      return true;
    }
    return (value ?? "").toLowerCase().includes(q);
  }

  private testMatchesSearch(test: TestInfo): boolean {
    if (this.matchesSearch(test.name)) {
      return true;
    }
    if (this.matchesSearch(path.basename(test.file))) {
      return true;
    }
    if (this.matchesSearch(test.file)) {
      return true;
    }
    return (
      test.subTests?.some(
        (sub) =>
          this.matchesSearch(sub.name) || this.matchesSearch(sub.fullName),
      ) ?? false
    );
  }

  private fileMatchesSearch(file: TestFileInfo): boolean {
    if (
      this.matchesSearch(path.basename(file.file)) ||
      this.matchesSearch(file.file)
    ) {
      return true;
    }
    return file.tests.some((test) => this.testMatchesSearch(test));
  }

  private packageMatchesSearch(pkg: TestPackageInfo): boolean {
    if (
      this.matchesSearch(pkg.packageName) ||
      this.matchesSearch(pkg.packagePath)
    ) {
      return true;
    }
    return pkg.files.some((file) => this.fileMatchesSearch(file));
  }

  private moduleMatchesSearch(mod: TestModuleInfo): boolean {
    if (
      this.matchesSearch(mod.moduleName) ||
      this.matchesSearch(mod.moduleRoot)
    ) {
      return true;
    }
    return mod.packages.some((pkg) => this.packageMatchesSearch(pkg));
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

  getActiveProfile(): ProfilingMode | undefined {
    return this.activeProfile;
  }

  setActiveProfile(profile: ProfilingMode | undefined): void {
    this.activeProfile = profile;
    // Context key lets package.json when-clauses react to profile state
    vscode.commands.executeCommand(
      "setContext",
      "goAssistant.profileActive",
      !!profile,
    );
    this.refresh();
  }

  /**
   * Build the extra flags string for a `go test` invocation.
   * @param skipRun Skip the global `-run` filter (use when the command provides its own -run).
   * @param coverageFile If provided and the "coverprofile" flag is active, appends
   *                     `-coverprofile=<path>` to the output.
   */
  buildExtraFlags(skipRun = false, coverageFile?: string): string {
    const parts: string[] = [];
    for (const f of AVAILABLE_TEST_FLAGS) {
      if (!this.activeFlags.has(f.id)) {
        continue;
      }
      if (f.external) {
        continue;
      } // handled below or externally
      if (f.id === "run" && skipRun) {
        continue;
      }
      if (f.promptForValue) {
        const val = this.flagValues[f.id] ?? f.defaultValue ?? "";
        if (val) {
          parts.push(`${f.flag}=${val}`);
        }
      } else {
        parts.push(f.flag);
      }
    }
    // Append coverprofile after other flags
    if (coverageFile && this.activeFlags.has("coverprofile")) {
      parts.push(`-coverprofile=${coverageFile}`);
      // Coverage profiles are not generated for cached runs, so bypass the cache.
      if (!this.activeFlags.has("count")) {
        parts.push("-count=1");
      }
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
    this.rebuildPackageAliases();
    this.refresh();
  }

  private rebuildPackageAliases(): void {
    this.packageAliases.clear();
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        this.packageAliases.set(pkg.packagePath, pkg.packagePath);
        const rel = path
          .relative(mod.moduleRoot, pkg.packagePath)
          .replace(/\\/g, "/");
        const importPath =
          !rel || rel === "." ? mod.moduleName : `${mod.moduleName}/${rel}`;
        this.packageAliases.set(importPath, pkg.packagePath);
      }
    }
  }

  private resolvePackagePath(packageRef: string): string {
    const mapped = this.packageAliases.get(packageRef);
    if (mapped) {
      return mapped;
    }

    if (packageRef === "command-line-arguments" || packageRef === ".") {
      if (this.runningTestsByPackage.size === 1) {
        return [...this.runningTestsByPackage.keys()][0];
      }
      if (this.getPackages().length === 1) {
        return this.getPackages()[0].packagePath;
      }
    }

    return packageRef;
  }

  private makeResultKey(packagePath: string, testName: string): string {
    return `${packagePath}::${testName}`;
  }

  private markTestRunning(packagePath: string, testName: string): void {
    if (!testName) {
      return;
    }
    const running = this.runningTestsByPackage.get(packagePath) ?? new Set();
    running.add(testName);
    this.runningTestsByPackage.set(packagePath, running);
  }

  private markTestFinished(packagePath: string, testName: string): void {
    if (!testName) {
      return;
    }
    const running = this.runningTestsByPackage.get(packagePath);
    if (!running) {
      return;
    }
    running.delete(testName);
    if (running.size === 0) {
      this.runningTestsByPackage.delete(packagePath);
    }
  }

  private getAllRunningTests(): Array<{
    packagePath: string;
    testName: string;
  }> {
    const running: Array<{ packagePath: string; testName: string }> = [];
    for (const [pkgPath, tests] of this.runningTestsByPackage.entries()) {
      for (const testName of tests) {
        running.push({ packagePath: pkgPath, testName });
      }
    }
    return running;
  }

  private extractTestFromOutput(output: string): {
    testName: string;
    action?: "run" | "pass" | "fail" | "skip";
  } | null {
    const line = output.trim();
    if (!line) {
      return null;
    }

    const runMatch = line.match(/^=== RUN\s+(\S+)/);
    if (runMatch) {
      const testName = this.sanitizeTestName(runMatch[1]);
      return testName ? { testName, action: "run" } : null;
    }

    const passMatch = line.match(/^--- PASS:\s+(\S+)/);
    if (passMatch) {
      const testName = this.sanitizeTestName(passMatch[1]);
      return testName ? { testName, action: "pass" } : null;
    }

    const failMatch = line.match(/^--- FAIL:\s+(\S+)/);
    if (failMatch) {
      const testName = this.sanitizeTestName(failMatch[1]);
      return testName ? { testName, action: "fail" } : null;
    }

    const skipMatch = line.match(/^--- SKIP:\s+(\S+)/);
    if (skipMatch) {
      const testName = this.sanitizeTestName(skipMatch[1]);
      return testName ? { testName, action: "skip" } : null;
    }

    return null;
  }

  private sanitizeTestName(rawName: string): string {
    let testName = rawName.trim();
    testName = testName.replace(/\\n\"?\}?$/g, "");
    testName = testName.replace(/\"\}?$/g, "");
    testName = testName.replace(/\(\d+(?:\.\d+)?s\)$/g, "");
    testName = testName.replace(/[\s,;:]+$/g, "");
    testName = testName.replace(/^["']+|["']+$/g, "");
    return /^[-\w./]+$/.test(testName) ? testName : "";
  }

  private filterTestsByLastRunSpec(
    packagePath: string,
    tests: string[],
  ): string[] {
    const spec = this.lastRunSpec;
    if (!spec) {
      return tests;
    }

    if (spec.packagePath && spec.packagePath !== packagePath) {
      return [];
    }

    if (!spec.testPattern) {
      return tests;
    }

    try {
      const regex = new RegExp(spec.testPattern);
      return tests.filter((testName) => regex.test(testName));
    } catch {
      return tests;
    }
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
        if (trimmed.startsWith("//")) {
          continue;
        }

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
            if (ch === "{") {
              braceDepth++;
            } else if (ch === "}") {
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
        // Captures the actual field name from t.Run(tt.fieldName, ...) or t.Run(tc.fieldName, ...)
        // Group 1 = loop variable (tt/tc/...), group 2 = field name (name/title/desc/...)
        const varRunRegex = /[tb]\.Run\(\s*[a-zA-Z_]\w*\.([a-zA-Z_]\w*)\s*,/;

        let hasVarRun = false;
        let nameField = "name"; // default, overridden once t.Run(xx.field) is detected

        for (let i = tf.startIdx + 1; i <= tf.endIdx; i++) {
          const line = lines[i];
          if (line.trim().startsWith("//")) {
            continue;
          }

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

          // Variable-based t.Run(tt.fieldName, ...) — capture the actual field name
          if (!hasVarRun) {
            const vrm = varRunRegex.exec(line);
            if (vrm) {
              hasVarRun = true;
              nameField = vrm[1]; // e.g. "name", "title", "desc", etc.
            }
          }
        }

        // Table-driven pattern: if no literal runs but a variable-based t.Run was found,
        // use the dynamically discovered nameField (not hardcoded "name").
        // If that also fails, leave subTests as empty array [] so the tree shows the
        // node as expandable — subtests will be populated from run output.
        if (subTests.length === 0 && hasVarRun) {
          const funcBody = lines
            .slice(tf.startIdx + 1, tf.endIdx + 1)
            .join("\n");

          const namedFieldRegex = new RegExp(
            `\\b${nameField}\\s*:\\s*"([^"]+)"`,
            "g",
          );
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

  private summarizeHistoryStatus(
    entries: TestRunEntry[],
  ): "pass" | "fail" | "unknown" {
    if (entries.some((entry) => entry.status === "fail")) {
      return "fail";
    }
    if (entries.some((entry) => entry.status === "pass")) {
      return "pass";
    }
    return "unknown";
  }

  private hasMeaningfulLog(output?: string): boolean {
    if (!output) {
      return false;
    }
    const ignored =
      /^(=== RUN\s+|--- (PASS|FAIL|SKIP):\s+|PASS$|FAIL$|ok\s+|\?\s+|RUN\s*$)/;
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => line.length > 0 && !ignored.test(line));
  }

  private historyLeafEntries(entries: TestRunEntry[]): TestRunEntry[] {
    const byName = new Map<string, TestRunEntry>();
    for (const entry of entries) {
      byName.set(entry.testName, entry);
    }

    return [...byName.values()].filter(
      (entry) =>
        !entries.some(
          (other) =>
            other.testName !== entry.testName &&
            other.testName.startsWith(`${entry.testName}/`),
        ),
    );
  }

  private createHistoryTestNode(
    run: TestRunHistory,
    packagePath: string,
    filePath: string,
    testName: string,
  ): TestTreeItem {
    const entriesForTest = run.entries.filter(
      (entry) =>
        entry.packagePath === packagePath &&
        entry.file === filePath &&
        (entry.testName === testName ||
          entry.testName.startsWith(`${testName}/`)),
    );

    const exactEntry = entriesForTest.find(
      (entry) => entry.testName === testName,
    );
    const hasChildren = entriesForTest.some((entry) =>
      entry.testName.startsWith(`${testName}/`),
    );
    const status = this.summarizeHistoryStatus(entriesForTest);
    const duration = exactEntry?.duration;
    const label = testName.split("/").pop() ?? testName;
    const output = exactEntry?.output;
    const hasLog = this.hasMeaningfulLog(output);

    const nodeEntry: TestRunEntry = {
      testName,
      packagePath,
      file: filePath,
      status,
      duration,
      output,
      packageCoverage: exactEntry?.packageCoverage,
      fileCoverage: exactEntry?.fileCoverage,
    };

    return new TestTreeItem(
      label,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      "historyTest",
      hasLog ? "historyTest" : "historyTestNoLog",
      undefined,
      undefined,
      undefined,
      undefined,
      run,
      nodeEntry,
      undefined,
      undefined,
      undefined,
      packagePath,
      filePath,
    );
  }

  async getChildren(element?: TestTreeItem): Promise<TestTreeItem[]> {
    // Root level
    if (!element) {
      const items: TestTreeItem[] = [];
      const filteredModules = this.modules.filter((mod) =>
        this.moduleMatchesSearch(mod),
      );

      if (this.modules.length === 0) {
        items.push(
          new TestTreeItem(
            "No tests found",
            vscode.TreeItemCollapsibleState.None,
            "root",
          ),
        );
      } else if (filteredModules.length === 0) {
        items.push(
          new TestTreeItem(
            `No matches for "${this.searchQuery}"`,
            vscode.TreeItemCollapsibleState.None,
            "root",
          ),
        );
      } else {
        const singleModule = filteredModules.length === 1;
        for (const mod of filteredModules) {
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
      return element.moduleInfo.packages
        .filter((pkg) => this.packageMatchesSearch(pkg))
        .map(
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
      return element.packageInfo.files
        .filter((file) => this.fileMatchesSearch(file))
        .map(
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
      return element.fileInfo.tests
        .filter((test) => this.testMatchesSearch(test))
        .map((test) => {
          if (
            test.packageCoverage === undefined &&
            element.packageInfo?.coverage !== undefined
          ) {
            test.packageCoverage = element.packageInfo.coverage;
          }
          if (
            test.fileCoverage === undefined &&
            element.fileInfo?.coverage !== undefined
          ) {
            test.fileCoverage = element.fileInfo.coverage;
          }
          return new TestTreeItem(
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
          );
        });
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
      return element.testInfo.subTests
        .filter(
          (sub) =>
            this.matchesSearch(sub.name) || this.matchesSearch(sub.fullName),
        )
        .map(
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
        .map((run) => {
          const leaves = this.historyLeafEntries(run.entries);
          const pass = leaves.filter((entry) => entry.status === "pass").length;
          const fail = leaves.filter((entry) => entry.status === "fail").length;
          const item = new TestTreeItem(
            run.label,
            vscode.TreeItemCollapsibleState.Collapsed,
            "historyRun",
            "historyRun",
            undefined,
            undefined,
            undefined,
            undefined,
            run,
          );
          item.description = `${leaves.length} test${leaves.length !== 1 ? "s" : ""}${pass > 0 ? ` · ${pass} pass` : ""}${fail > 0 ? ` · ${fail} fail` : ""}`;
          return item;
        });
    }

    // History run → test results
    if (element.itemType === "historyRun" && element.historyRun) {
      const byPackage = new Map<string, TestRunEntry[]>();
      for (const entry of element.historyRun.entries) {
        if (!byPackage.has(entry.packagePath)) {
          byPackage.set(entry.packagePath, []);
        }
        byPackage.get(entry.packagePath)!.push(entry);
      }

      return [...byPackage.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([packagePath, entries]) => {
          const packageLabel =
            this.getPackages().find((pkg) => pkg.packagePath === packagePath)
              ?.packageName ?? packagePath;
          const status = this.summarizeHistoryStatus(entries);
          const item = new TestTreeItem(
            packageLabel,
            vscode.TreeItemCollapsibleState.Collapsed,
            "historyPackage",
            "historyPackage",
            undefined,
            undefined,
            undefined,
            undefined,
            element.historyRun,
            {
              testName: packageLabel,
              packagePath,
              file: "",
              status,
            },
            undefined,
            undefined,
            undefined,
            packagePath,
          );
          const leaves = this.historyLeafEntries(entries);
          item.description = `${leaves.length} test${leaves.length !== 1 ? "s" : ""}`;
          return item;
        });
    }

    if (
      element.itemType === "historyPackage" &&
      element.historyRun &&
      element.historyPackagePath
    ) {
      const byFile = new Map<string, TestRunEntry[]>();
      for (const entry of element.historyRun.entries) {
        if (entry.packagePath !== element.historyPackagePath) {
          continue;
        }
        if (!byFile.has(entry.file)) {
          byFile.set(entry.file, []);
        }
        byFile.get(entry.file)!.push(entry);
      }

      return [...byFile.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([filePath, entries]) => {
          const status = this.summarizeHistoryStatus(entries);
          const item = new TestTreeItem(
            path.basename(filePath),
            vscode.TreeItemCollapsibleState.Collapsed,
            "historyFile",
            "historyFile",
            undefined,
            undefined,
            undefined,
            undefined,
            element.historyRun,
            {
              testName: path.basename(filePath),
              packagePath: element.historyPackagePath!,
              file: filePath,
              status,
            },
            undefined,
            undefined,
            undefined,
            element.historyPackagePath,
            filePath,
          );
          const leaves = this.historyLeafEntries(entries);
          item.description = `${leaves.length} test${leaves.length !== 1 ? "s" : ""}`;
          return item;
        });
    }

    if (
      element.itemType === "historyFile" &&
      element.historyRun &&
      element.historyPackagePath &&
      element.historyFilePath
    ) {
      const entries = element.historyRun.entries.filter(
        (entry) =>
          entry.packagePath === element.historyPackagePath &&
          entry.file === element.historyFilePath,
      );
      const topLevel = Array.from(
        new Set(entries.map((entry) => entry.testName.split("/")[0])),
      ).sort((a, b) => a.localeCompare(b));

      return topLevel.map((testName) =>
        this.createHistoryTestNode(
          element.historyRun!,
          element.historyPackagePath!,
          element.historyFilePath!,
          testName,
        ),
      );
    }

    if (
      element.itemType === "historyTest" &&
      element.historyRun &&
      element.historyPackagePath &&
      element.historyFilePath &&
      element.historyEntry
    ) {
      const parentName = element.historyEntry.testName;
      const parentDepth = parentName.split("/").length;
      const prefix = `${parentName}/`;
      const directChildren = Array.from(
        new Set(
          element.historyRun.entries
            .filter(
              (entry) =>
                entry.packagePath === element.historyPackagePath &&
                entry.file === element.historyFilePath &&
                entry.testName.startsWith(prefix) &&
                entry.testName.split("/").length === parentDepth + 1,
            )
            .map((entry) => entry.testName),
        ),
      ).sort((a, b) => a.localeCompare(b));

      return directChildren.map((childName) =>
        this.createHistoryTestNode(
          element.historyRun!,
          element.historyPackagePath!,
          element.historyFilePath!,
          childName,
        ),
      );
    }

    if (element.itemType === "resultsRoot") {
      const byPackage = new Map<string, TestResult[]>();
      for (const result of this.testResults.values()) {
        if (!byPackage.has(result.packagePath)) {
          byPackage.set(result.packagePath, []);
        }
        byPackage.get(result.packagePath)!.push(result);
      }

      return [...byPackage.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([packagePath, results]) => {
          const name = this.getPackages().find(
            (p) => p.packagePath === packagePath,
          )?.packageName;
          const item = new TestTreeItem(
            name ?? packagePath,
            vscode.TreeItemCollapsibleState.Collapsed,
            "resultsPackage",
            "resultsPackage",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            packagePath,
          );
          const pkgCov = this.getPackageCoverage(packagePath);
          item.description = `${results.length} test${results.length !== 1 ? "s" : ""}${pkgCov !== null ? ` · ${pkgCov.toFixed(1)}%` : ""}`;
          return item;
        });
    }

    if (element.itemType === "resultsPackage" && element.resultPackagePath) {
      const tests = [...this.testResults.values()]
        .filter((r) => r.packagePath === element.resultPackagePath)
        .sort((a, b) => {
          const order: Record<string, number> = {
            fail: 0,
            unknown: 1,
            skip: 2,
            pass: 3,
          };
          return (order[a.status] ?? 1) - (order[b.status] ?? 1);
        });

      return tests.map(
        (result) =>
          new TestTreeItem(
            result.testName,
            vscode.TreeItemCollapsibleState.None,
            "resultTest",
            "resultTest",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            element.resultPackagePath,
            result,
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
    const normalizedOutput = this.normalizeOutputForSubTests(output);

    // Collect all subtest names per parent from RUN lines
    const discovered = new Map<
      string,
      Map<string, { status: "pass" | "fail" | "unknown"; duration?: number }>
    >();

    // Parse === RUN   TestFoo/sub_name
    const runRegex = /=== RUN\s+(\w+)\/(\S+)/gm;
    let m: RegExpExecArray | null;
    while ((m = runRegex.exec(normalizedOutput)) !== null) {
      const parent = m[1];
      const fullName = this.sanitizeTestName(`${parent}/${m[2]}`);
      const rawSub = fullName.split("/")[1];
      if (!rawSub) {
        continue;
      }
      if (!discovered.has(parent)) {
        discovered.set(parent, new Map());
      }
      if (!discovered.get(parent)!.has(rawSub)) {
        discovered.get(parent)!.set(rawSub, { status: "unknown" });
      }
    }

    // Parse --- PASS/FAIL: TestFoo/sub_name (0.01s)
    const resultRegex = /--- (PASS|FAIL):\s+(\w+)\/(\S+)\s+\(([\d.]+)s\)/gm;
    while ((m = resultRegex.exec(normalizedOutput)) !== null) {
      const parent = m[2];
      const fullName = this.sanitizeTestName(`${parent}/${m[3]}`);
      const rawSub = fullName.split("/")[1];
      if (!rawSub) {
        continue;
      }
      const status = m[1] === "PASS" ? "pass" : "fail";
      const duration = parseFloat(m[4]);
      if (!discovered.has(parent)) {
        discovered.set(parent, new Map());
      }
      discovered.get(parent)!.set(rawSub, { status, duration });
    }

    if (discovered.size === 0) {
      return;
    }

    let changed = false;
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (packagePath && pkg.packagePath !== packagePath) {
          continue;
        }
        for (const file of pkg.files) {
          for (const test of file.tests) {
            const subs = discovered.get(test.name);
            if (!subs) {
              continue;
            }
            // Merge discovered subtests with existing ones so running a single
            // subtest does not make siblings disappear from the tree.
            const existing = test.subTests ?? [];
            const merged = new Map<string, SubTestInfo>();

            const normalizeSubKey = (value: string): string =>
              value.replace(/ /g, "_").trim();

            for (const sub of existing) {
              const raw = sub.fullName.startsWith(`${test.name}/`)
                ? sub.fullName.slice(test.name.length + 1)
                : sub.name;
              merged.set(normalizeSubKey(raw), { ...sub });
            }

            for (const [rawSub, info] of subs) {
              const key = normalizeSubKey(rawSub);
              const prev = merged.get(key);
              const displayName = prev?.name ?? rawSub.replace(/_/g, " ");
              merged.set(key, {
                name: displayName,
                fullName: `${test.name}/${rawSub}`,
                parentName: test.name,
                file: test.file,
                packagePath: pkg.packagePath,
                line: prev?.line,
                status: info.status,
                duration: info.duration,
                fileCoverage: prev?.fileCoverage,
                packageCoverage: prev?.packageCoverage,
              });
            }

            test.subTests = Array.from(merged.values());
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.refresh();
    }
  }

  // ── Status updates ────────────────────────────────────────────────────────

  updateTestStatus(
    testName: string,
    packagePath: string,
    status: "pass" | "fail" | "running" | "unknown",
    duration?: number,
  ): void {
    if (testName.includes("/")) {
      const parentTestName = testName.split("/")[0];
      this.updateSubTestStatus(
        parentTestName,
        testName,
        packagePath,
        status,
        duration,
      );
      this.syncResultFromStatus(testName, packagePath, status, duration);
      return;
    }

    let matched = false;
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (pkg.packagePath === packagePath) {
          for (const file of pkg.files) {
            for (const test of file.tests) {
              if (test.name === testName) {
                matched = true;
                test.status = status;
                if (duration !== undefined && status !== "running") {
                  test.duration = duration;
                }
                this.syncResultFromStatus(
                  testName,
                  packagePath,
                  status,
                  duration,
                );
                this.refresh();
                return;
              }
            }
          }
        }
      }
    }

    if (!matched) {
      this.syncResultFromStatus(testName, packagePath, status, duration);
      this.refresh();
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

                    const subStates = test.subTests
                      .map((s) => s.status)
                      .filter((s): s is NonNullable<typeof s> => !!s);
                    if (subStates.includes("fail")) {
                      test.status = "fail";
                    } else if (subStates.includes("running")) {
                      test.status = "running";
                    } else if (
                      subStates.length > 0 &&
                      subStates.every((s) => s === "pass")
                    ) {
                      test.status = "pass";
                    } else if (subStates.length > 0) {
                      test.status = "unknown";
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

  finalizeRunningStatuses(status: "pass" | "fail" | "unknown"): void {
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        for (const file of pkg.files) {
          for (const test of file.tests) {
            if (test.status === "running") {
              test.status = status;
            }
            if (test.subTests) {
              for (const sub of test.subTests) {
                if (sub.status === "running") {
                  sub.status = status;
                }
              }
            }
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

  /**
   * Resets every test and sub-test status/duration back to their initial
   * (not-yet-run) state without re-discovering the tree structure.
   */
  resetResults(): void {
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        for (const file of pkg.files) {
          for (const test of file.tests) {
            test.status = undefined;
            test.duration = undefined;
            if (test.subTests) {
              for (const sub of test.subTests) {
                sub.status = undefined;
                sub.duration = undefined;
              }
            }
          }
        }
      }
    }
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

  findTestLocation(
    testName: string,
    packagePath: string,
  ): { file: string; line: number } | null {
    const parentTestName = testName.includes("/")
      ? testName.split("/")[0]
      : testName;

    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (pkg.packagePath !== packagePath) {
          continue;
        }

        for (const file of pkg.files) {
          for (const test of file.tests) {
            if (test.name !== parentTestName) {
              continue;
            }

            if (!testName.includes("/")) {
              return { file: test.file, line: test.line };
            }
            return { file: test.file, line: test.line };
          }
        }
      }
    }

    return null;
  }

  // ─── JSON Parsing and Results Storage ──────────────────────────────────────

  /**
   * Parse a JSON event from `go test -json` output.
   * Each line is a separate JSON object.
   */
  parseTestEventJSON(jsonLine: string): TestEventJSON | null {
    try {
      return JSON.parse(jsonLine) as TestEventJSON;
    } catch {
      return null;
    }
  }

  /**
   * Process incoming test event and update test status/results.
   * Called as events come in from `go test -json`.
   */
  processTestEvent(event: TestEventJSON): void {
    if (!event.Package) {
      return;
    }

    const packagePath = this.resolvePackagePath(event.Package);
    const testName = event.Test || "";
    const resultKey = testName
      ? this.makeResultKey(packagePath, testName)
      : this.makeResultKey(packagePath, "");

    this.debugLog(
      `event action=${event.Action} package=${packagePath} test=${testName || "<none>"} hasOutput=${!!event.Output}`,
    );

    switch (event.Action) {
      case "run":
        // Test started
        if (testName) {
          this.markTestRunning(packagePath, testName);
          this.updateTestStatus(testName, packagePath, "running");
        }
        break;

      case "pass":
        if (testName) {
          this.updateTestStatus(testName, packagePath, "pass", event.Elapsed);
          this.storeTestOutput(testName, packagePath, "pass", event.Elapsed);
          this.markTestFinished(packagePath, testName);
        } else {
          this.markRunningTestsInPackage(packagePath, "pass");
          this.runningTestsByPackage.delete(packagePath);
        }
        break;

      case "fail":
        if (testName) {
          this.updateTestStatus(testName, packagePath, "fail", event.Elapsed);
          this.storeTestOutput(testName, packagePath, "fail", event.Elapsed);
          this.markTestFinished(packagePath, testName);
        } else {
          this.markRunningTestsInPackage(packagePath, "fail");
          this.runningTestsByPackage.delete(packagePath);
        }
        break;

      case "skip":
        if (testName) {
          this.updateTestStatus(testName, packagePath, "unknown");
          this.storeTestOutput(testName, packagePath, "unknown", 0);
          this.markTestFinished(packagePath, testName);
        }
        break;

      case "output":
        if (event.Output) {
          const inferred = this.extractTestFromOutput(event.Output);

          this.debugLog(
            `output received package=${packagePath} explicitTest=${testName || "<none>"} inferred=${inferred?.testName || "<none>"}`,
          );

          if (inferred?.action === "run") {
            this.markTestRunning(packagePath, inferred.testName);
          } else if (
            inferred?.action === "pass" ||
            inferred?.action === "fail" ||
            inferred?.action === "skip"
          ) {
            this.markTestFinished(packagePath, inferred.testName);
          }

          const targetTests = new Set<string>();
          if (testName) {
            targetTests.add(testName);
          }
          if (inferred?.testName) {
            targetTests.add(inferred.testName);
          }

          if (targetTests.size === 0) {
            const running = this.runningTestsByPackage.get(packagePath);
            if (running) {
              for (const runningTest of running) {
                targetTests.add(runningTest);
              }
            }
          }

          if (targetTests.size > 0) {
            this.debugLog(
              `output mapped to ${targetTests.size} test(s) in package=${packagePath}`,
            );
            for (const targetTest of targetTests) {
              const safeTestName = this.sanitizeTestName(targetTest);
              if (!safeTestName) {
                continue;
              }
              this.syncResultFromStatus(safeTestName, packagePath, "unknown");
              this.appendTestOutput(
                this.makeResultKey(packagePath, safeTestName),
                event.Output,
              );
            }
          } else if (testName) {
            const safeTestName = this.sanitizeTestName(testName);
            if (safeTestName) {
              this.syncResultFromStatus(safeTestName, packagePath, "unknown");
              this.appendTestOutput(
                this.makeResultKey(packagePath, safeTestName),
                event.Output,
              );
            }
          } else {
            const discovered = this.getDiscoveredTestsInPackage(packagePath);
            const filteredDiscovered = this.filterTestsByLastRunSpec(
              packagePath,
              discovered,
            );
            if (filteredDiscovered.length > 0) {
              this.debugLog(
                `output mapped by discovery to ${filteredDiscovered.length} test(s) in package=${packagePath}`,
              );
              for (const discoveredTest of filteredDiscovered) {
                this.syncResultFromStatus(
                  discoveredTest,
                  packagePath,
                  "unknown",
                );
                this.appendTestOutput(
                  this.makeResultKey(packagePath, discoveredTest),
                  event.Output,
                );
              }
            } else {
              const runningGlobal = this.getAllRunningTests();
              if (runningGlobal.length > 0) {
                this.debugLog(
                  `output mapped by global running fallback to ${runningGlobal.length} test(s)`,
                );
                for (const current of runningGlobal) {
                  this.syncResultFromStatus(
                    current.testName,
                    current.packagePath,
                    "unknown",
                  );
                  this.appendTestOutput(
                    this.makeResultKey(current.packagePath, current.testName),
                    event.Output,
                  );
                }
              } else {
                this.debugLog(
                  `output dropped (no target tests) package=${packagePath} line=${event.Output.trim().slice(0, 120)}`,
                );
                this.appendRunnerOutput(event.Output, packagePath);
              }
            }
          }

          const coverageMatch = event.Output.match(
            /coverage:\s*([\d.]+)%\s+of statements/i,
          );
          if (coverageMatch) {
            this.setPackageCoverage(packagePath, parseFloat(coverageMatch[1]));
          }
        }
        break;
    }

    this.refresh();
  }

  private markRunningTestsInPackage(
    packagePath: string,
    status: "pass" | "fail" | "unknown",
  ): void {
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (pkg.packagePath !== packagePath) {
          continue;
        }
        for (const file of pkg.files) {
          for (const test of file.tests) {
            if (test.status === "running") {
              test.status = status;
              this.syncResultFromStatus(
                test.name,
                packagePath,
                status,
                test.duration,
              );
            }
          }
        }
      }
    }
  }

  /**
   * Store test output log.
   */
  private storeTestOutput(
    testName: string,
    packagePath: string,
    status: "pass" | "fail" | "unknown",
    duration?: number,
  ): void {
    const resultKey = this.makeResultKey(packagePath, testName);

    let result = this.testResults.get(resultKey);
    if (!result) {
      const file = this.findTestFile(testName, packagePath);
      result = {
        testName,
        packagePath,
        file,
        status,
        duration: duration || 0,
        output: {
          testName,
          packagePath,
          output: [],
          duration,
          coverage: this.packageCoverage.get(packagePath),
        },
      };
    }

    result.status = status;
    result.duration = duration || 0;
    result.output.endTime = new Date();
    result.output.duration = duration;
    result.output.coverage = this.packageCoverage.get(packagePath);

    this.testResults.set(resultKey, result);
  }

  private findTestFile(testName: string, packagePath: string): string {
    const parentTestName = testName.includes("/")
      ? testName.split("/")[0]
      : testName;
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (pkg.packagePath !== packagePath) {
          continue;
        }
        for (const file of pkg.files) {
          for (const test of file.tests) {
            if (test.name === parentTestName) {
              return test.file;
            }
          }
        }
      }
    }
    return "";
  }

  private getDiscoveredTestsInPackage(packagePath: string): string[] {
    const names: string[] = [];
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (pkg.packagePath !== packagePath) {
          continue;
        }
        for (const file of pkg.files) {
          for (const test of file.tests) {
            names.push(test.name);
          }
        }
      }
    }
    return names;
  }

  private syncResultFromStatus(
    testName: string,
    packagePath: string,
    status: "pass" | "fail" | "running" | "unknown",
    duration?: number,
  ): void {
    if (!testName) {
      return;
    }

    const resultKey = this.makeResultKey(packagePath, testName);
    const resultStatus: TestResult["status"] =
      status === "running" ? "unknown" : status;
    const file = this.findTestFile(testName, packagePath);

    const existing = this.testResults.get(resultKey);
    if (existing) {
      existing.status = resultStatus;
      if (duration !== undefined) {
        existing.duration = duration;
        existing.output.duration = duration;
      }
      if (!existing.file && file) {
        existing.file = file;
      }
      existing.output.coverage = this.packageCoverage.get(packagePath);
      this.testResults.set(resultKey, existing);
      return;
    }

    this.testResults.set(resultKey, {
      testName,
      packagePath,
      file,
      status: resultStatus,
      duration: duration ?? 0,
      output: {
        testName,
        packagePath,
        output: [],
        duration,
        coverage: this.packageCoverage.get(packagePath),
      },
    });
  }

  /**
   * Append output to a test's log.
   */
  private appendTestOutput(resultKey: string, output: string): void {
    let result = this.testResults.get(resultKey);
    if (!result) {
      const [packagePath = "", testName = ""] = resultKey.split("::");
      result = {
        testName,
        packagePath,
        file: "",
        status: "unknown",
        duration: 0,
        output: {
          testName,
          packagePath,
          output: [],
          coverage: this.packageCoverage.get(packagePath),
        },
      };
    }

    result.output.output.push(output);
    this.testResults.set(resultKey, result);

    this.debugLog(
      `append output key=${resultKey} totalLines=${result.output.output.length}`,
    );
  }

  /**
   * Get stored test output/logs for a specific test.
   */
  getTestOutput(testName: string, packagePath: string): TestOutputLog | null {
    const resultKey = this.makeResultKey(packagePath, testName);
    const result = this.testResults.get(resultKey);
    return result ? result.output : null;
  }

  getTestResult(testName: string, packagePath: string): TestResult | null {
    return (
      this.testResults.get(this.makeResultKey(packagePath, testName)) ?? null
    );
  }

  getAllTestResults(): TestResult[] {
    return [...this.testResults.values()];
  }

  /**
   * Set coverage percentage for a package.
   */
  setPackageCoverage(packagePath: string, coverage: number): void {
    this.packageCoverage.set(packagePath, coverage);
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        if (pkg.packagePath !== packagePath) {
          continue;
        }
        pkg.coverage = coverage;
        for (const file of pkg.files) {
          for (const test of file.tests) {
            test.packageCoverage = coverage;
            if (test.subTests) {
              for (const sub of test.subTests) {
                sub.packageCoverage = coverage;
              }
            }
          }
        }
      }
    }
  }

  setFileCoverage(filePath: string, coverage: number): void {
    this.fileCoverage.set(filePath, coverage);
    for (const mod of this.modules) {
      for (const pkg of mod.packages) {
        for (const file of pkg.files) {
          if (file.file !== filePath) {
            continue;
          }
          file.coverage = coverage;
          for (const test of file.tests) {
            test.fileCoverage = coverage;
            if (test.subTests) {
              for (const sub of test.subTests) {
                sub.fileCoverage = coverage;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Get coverage percentage for a package.
   */
  getPackageCoverage(packagePath: string): number | null {
    return this.packageCoverage.get(packagePath) || null;
  }

  getFileCoverage(filePath: string): number | null {
    return this.fileCoverage.get(filePath) || null;
  }

  /**
   * Clear all stored results (call before running new tests).
   */
  clearTestResults(): void {
    this.testResults.clear();
    this.packageCoverage.clear();
    this.fileCoverage.clear();
    this.runningTestsByPackage.clear();
  }

  appendRunnerOutput(output: string, packagePath?: string): void {
    const text = output.trim();
    if (!text) {
      return;
    }

    const fallbackPackage =
      packagePath ??
      this.getPackages()[0]?.packagePath ??
      this.workspacePath ??
      "<workspace>";
    const runnerTestName = "(go test runner output)";
    const runnerFileName = "(runner output)";
    const key = this.makeResultKey(fallbackPackage, runnerTestName);

    this.syncResultFromStatus(runnerTestName, fallbackPackage, "unknown");
    const existing = this.testResults.get(key);
    if (existing && !existing.file) {
      existing.file = runnerFileName;
      this.testResults.set(key, existing);
    }
    this.appendTestOutput(key, `${text}\n`);
    this.refresh();
  }

  private normalizeOutputForSubTests(rawOutput: string): string {
    const lines = rawOutput.split(/\r?\n/);
    const extracted: string[] = [];

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const event = this.parseTestEventJSON(line);
      if (event?.Output) {
        extracted.push(event.Output);
      }
    }

    if (extracted.length > 0) {
      return extracted.join("");
    }

    return rawOutput;
  }
}
