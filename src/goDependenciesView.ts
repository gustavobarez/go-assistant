import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { findAllGoModsInWorkspace, findGoModForWorkspace } from "./goModFinder";

type GoModule = {
  Path: string;
  Version?: string;
  Main?: boolean;
  Dir?: string;
  Replace?: {
    Path: string;
    Version?: string;
    Dir?: string;
  };
};

type ModuleDependency = {
  modulePath: string;
  version?: string;
  directory?: string;
  replacedBy?: string;
  direct?: boolean;
  packages: PackageDependency[];
  packagesLoaded?: boolean;
  packagesLoadError?: string;
};

type PackageDependency = {
  modulePath: string;
  importPath: string;
  directory: string;
};

type DependencyTreeNode =
  | { kind: "section"; section: "modules" | "sdk"; label: string }
  | { kind: "dependency"; dependency: ModuleDependency }
  | { kind: "folder"; folderPath: string; rootPath: string }
  | { kind: "info"; label: string }
  | { kind: "file"; filePath: string };

export class GoDependenciesViewProvider implements vscode.TreeDataProvider<DependencyTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    DependencyTreeNode | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private dependencies: ModuleDependency[] = [];
  private moduleRoot?: string;
  private sdkRoot?: string;
  private sdkVersion?: string;
  private goModCache?: string;
  private searchQuery = "";
  private loaded = false;
  private loading = false;
  private loadError?: string;

  refresh(): void {
    this.loaded = false;
    this.loadError = undefined;
    this._onDidChangeTreeData.fire();
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query.trim().toLowerCase();
    this._onDidChangeTreeData.fire();
  }

  clearSearchQuery(): void {
    this.searchQuery = "";
    this._onDidChangeTreeData.fire();
  }

  getSearchQuery(): string {
    return this.searchQuery;
  }

  getTreeItem(element: DependencyTreeNode): vscode.TreeItem {
    if (element.kind === "section") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue =
        element.section === "modules"
          ? "dependencyModulesSection"
          : "dependencySdkSection";
      item.iconPath = new vscode.ThemeIcon(
        element.section === "modules" ? "library" : "tools",
      );
      return item;
    }

    if (element.kind === "info") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("info");
      item.contextValue = "dependencyInfo";
      return item;
    }

    if (element.kind === "dependency") {
      const item = new vscode.TreeItem(
        element.dependency.modulePath,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.contextValue = "dependency";
      const replacement = element.dependency.replacedBy
        ? ` → ${element.dependency.replacedBy}`
        : "";
      const dependencyType =
        element.dependency.direct === true
          ? "direct"
          : element.dependency.direct === false
            ? "indirect"
            : "unknown";
      item.description = `${element.dependency.version ?? "(local)"}${replacement} · ${dependencyType}`;
      item.tooltip = [
        element.dependency.modulePath,
        element.dependency.version ?? "",
        `type: ${dependencyType}`,
        element.dependency.directory ?? "",
        element.dependency.packagesLoadError
          ? `error: ${element.dependency.packagesLoadError}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      item.iconPath = new vscode.ThemeIcon("library");
      return item;
    }

    if (element.kind === "folder") {
      const item = new vscode.TreeItem(
        path.basename(element.folderPath),
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.contextValue = "dependencyFolder";
      item.tooltip = element.folderPath;
      item.resourceUri = vscode.Uri.file(element.folderPath);
      return item;
    }

    const fileItem = new vscode.TreeItem(
      path.basename(element.filePath),
      vscode.TreeItemCollapsibleState.None,
    );
    fileItem.contextValue = "dependencyFile";
    fileItem.tooltip = element.filePath;
    fileItem.resourceUri = vscode.Uri.file(element.filePath);
    fileItem.command = {
      command: "go-assistant.openDependencyFile",
      title: "Open dependency file",
      arguments: [element.filePath],
    };

    return fileItem;
  }

  async getChildren(
    element?: DependencyTreeNode,
  ): Promise<DependencyTreeNode[]> {
    if (!this.loaded && !this.loading) {
      await this.loadDependencies();
    }

    if (!element) {
      return [
        { kind: "section", section: "modules", label: "Go Modules" },
        {
          kind: "section",
          section: "sdk",
          label: `Go ${this.sdkVersion ?? ""} SDK`.trim(),
        },
      ];
    }

    if (element.kind === "section") {
      if (element.section === "modules") {
        if (this.loadError) {
          return [
            {
              kind: "info",
              label: `Failed to load modules (${this.loadError})`,
            },
          ];
        }

        if (this.dependencies.length === 0) {
          return [{ kind: "info", label: "No module dependencies found" }];
        }

        const filteredDependencies =
          this.searchQuery.length > 0
            ? this.dependencies.filter((dependency) =>
                [
                  dependency.modulePath,
                  dependency.version,
                  dependency.replacedBy,
                ]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase()
                  .includes(this.searchQuery),
              )
            : this.dependencies;

        if (filteredDependencies.length === 0) {
          return [{ kind: "info", label: "No dependencies match your search" }];
        }

        return filteredDependencies.map((dependency) => ({
          kind: "dependency",
          dependency,
        }));
      }

      if (!this.sdkRoot || !(await this.directoryExists(this.sdkRoot))) {
        return [
          {
            kind: "info",
            label: "Go SDK root not found",
          },
        ];
      }

      const sdkChildren = await this.listDirectoryChildren(
        this.sdkRoot,
        this.sdkRoot,
      );
      if (sdkChildren.length === 0) {
        return [
          {
            kind: "info",
            label: "Go SDK directory is empty",
          },
        ];
      }
      return sdkChildren;
    }

    if (element.kind === "dependency") {
      const moduleDirectory = await this.resolveDependencyDirectory(
        element.dependency,
      );

      if (!moduleDirectory) {
        return [
          {
            kind: "info",
            label: element.dependency.packagesLoadError
              ? `Failed to locate dependency source (${element.dependency.packagesLoadError})`
              : "Dependency source directory not found",
          },
        ];
      }

      const children = await this.listDirectoryChildren(
        moduleDirectory,
        moduleDirectory,
      );
      if (children.length === 0) {
        return [
          {
            kind: "info",
            label: "No files found in this dependency directory",
          },
        ];
      }
      return children;
    }

    if (element.kind === "folder") {
      const children = await this.listDirectoryChildren(
        element.folderPath,
        element.rootPath,
      );
      if (children.length === 0) {
        return [
          {
            kind: "info",
            label: "Folder is empty",
          },
        ];
      }
      return children;
    }

    return [];
  }

  private async loadDependencies(): Promise<void> {
    this.loading = true;
    this.loadError = undefined;
    const previousDependencies = this.dependencies;

    try {
      const fallbackCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      await this.loadSdkInfo(fallbackCwd);

      const goModPath = await this.resolveWorkspaceGoModPath();
      if (!goModPath) {
        this.dependencies = [];
        this.loadError = "go.mod not found in workspace";
        return;
      }

      this.moduleRoot = path.dirname(goModPath);

      await this.loadSdkInfo(this.moduleRoot);

      const directnessMap = await this.readDependencyDirectness(goModPath);
      const usedModulePaths = await this.listUsedModulePaths(this.moduleRoot);

      const modules = await this.listModules(this.moduleRoot);

      this.dependencies = modules
        .filter((moduleItem) => {
          if (moduleItem.Main) {
            return false;
          }

          if (usedModulePaths.size === 0) {
            return true;
          }

          return (
            usedModulePaths.has(moduleItem.Path) ||
            directnessMap.has(moduleItem.Path)
          );
        })
        .map((moduleItem) => {
          return {
            modulePath: moduleItem.Path,
            version: moduleItem.Version,
            directory: moduleItem.Replace?.Dir ?? moduleItem.Dir,
            replacedBy:
              moduleItem.Replace && moduleItem.Replace.Path !== moduleItem.Path
                ? `${moduleItem.Replace.Path}${moduleItem.Replace.Version ? `@${moduleItem.Replace.Version}` : ""}`
                : undefined,
            direct: directnessMap.get(moduleItem.Path),
            packages: [],
            packagesLoaded: false,
          };
        })
        .sort((a, b) => a.modulePath.localeCompare(b.modulePath));
    } catch (error) {
      this.loadError =
        error instanceof Error ? error.message : "Failed to load dependencies";
      this.dependencies = previousDependencies;
      vscode.window.showErrorMessage(
        `Go Assistant: failed to load dependencies (${this.loadError})`,
      );
    } finally {
      this.loaded = true;
      this.loading = false;
      this._onDidChangeTreeData.fire();
    }
  }

  private async listModules(moduleRoot: string): Promise<GoModule[]> {
    const attempts: string[][] = [
      ["list", "-mod=mod", "-m", "-json", "all"],
      ["list", "-mod=readonly", "-m", "-json", "all"],
      ["list", "-m", "-json", "all"],
    ];

    let lastError: unknown;
    for (const args of attempts) {
      try {
        const stdout = await this.execGo(moduleRoot, args);
        return parseConcatenatedJson<GoModule>(stdout);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("failed to list modules");
  }

  private async listUsedModulePaths(moduleRoot: string): Promise<Set<string>> {
    const attempts: string[][] = [
      [
        "list",
        "-mod=mod",
        "-deps",
        "-f",
        "{{if .Module}}{{.Module.Path}}{{end}}",
        "./...",
      ],
      [
        "list",
        "-mod=readonly",
        "-deps",
        "-f",
        "{{if .Module}}{{.Module.Path}}{{end}}",
        "./...",
      ],
      ["list", "-deps", "-f", "{{if .Module}}{{.Module.Path}}{{end}}", "./..."],
    ];

    let stdout = "";
    for (const args of attempts) {
      try {
        stdout = await this.execGo(moduleRoot, args);
        break;
      } catch {
        // try next strategy
      }
    }

    const modules = new Set<string>();
    if (!stdout.trim()) {
      return modules;
    }

    for (const line of stdout.split(/\r?\n/)) {
      const value = line.trim();
      if (!value) {
        continue;
      }
      modules.add(value);
    }

    return modules;
  }

  private async resolveWorkspaceGoModPath(): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

    for (const folder of workspaceFolders) {
      const candidate = path.join(folder.uri.fsPath, "go.mod");
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    const inWorkspace = (filePath: string): boolean =>
      workspaceFolders.some((folder) => {
        const rel = path.relative(folder.uri.fsPath, filePath);
        return !rel.startsWith("..") && !path.isAbsolute(rel);
      });

    const workspaceGoMods = await findAllGoModsInWorkspace();
    if (workspaceGoMods.length > 0) {
      const sorted = [...workspaceGoMods].sort(
        (a, b) => a.split(path.sep).length - b.split(path.sep).length,
      );
      return sorted[0];
    }

    const fallback = await findGoModForWorkspace();
    if (fallback && inWorkspace(fallback)) {
      return fallback;
    }

    return undefined;
  }

  private async loadSdkInfo(preferredCwd?: string): Promise<void> {
    const cwd =
      preferredCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      return;
    }

    try {
      this.sdkRoot = (await this.execGo(cwd, ["env", "GOROOT"]))
        .trim()
        .replace(/\r?\n/g, "");
      this.goModCache = (await this.execGo(cwd, ["env", "GOMODCACHE"]))
        .trim()
        .replace(/\r?\n/g, "");
      this.sdkVersion = (await this.execGo(cwd, ["env", "GOVERSION"]))
        .trim()
        .replace(/^go/, "")
        .replace(/\r?\n/g, "");
    } catch (_error) {}
  }

  private async readDependencyDirectness(
    goModPath: string,
  ): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();

    try {
      const content = await fs.promises.readFile(goModPath, "utf8");
      const lines = content.split(/\r?\n/);
      let insideRequireBlock = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//")) {
          continue;
        }

        if (/^require\s*\($/.test(trimmed)) {
          insideRequireBlock = true;
          continue;
        }

        if (insideRequireBlock && trimmed === ")") {
          insideRequireBlock = false;
          continue;
        }

        const parseLine = (
          value: string,
        ): { modulePath: string; indirect: boolean } | undefined => {
          const match = value.match(/^(\S+)\s+v\S+(?:\s+\/\/\s*indirect)?$/);
          if (!match) {
            return undefined;
          }
          return {
            modulePath: match[1],
            indirect: /\/\/\s*indirect\b/.test(value),
          };
        };

        if (insideRequireBlock) {
          const parsed = parseLine(trimmed);
          if (parsed) {
            map.set(parsed.modulePath, !parsed.indirect);
          }
          continue;
        }

        if (trimmed.startsWith("require ")) {
          const inline = trimmed.replace(/^require\s+/, "");
          const parsed = parseLine(inline);
          if (parsed) {
            map.set(parsed.modulePath, !parsed.indirect);
          }
        }
      }
    } catch (_error) {}

    return map;
  }

  private async ensureDependencyPackagesLoaded(
    dependency: ModuleDependency,
  ): Promise<void> {
    if (dependency.packagesLoaded) {
      return;
    }

    if (!this.moduleRoot) {
      dependency.packagesLoaded = true;
      dependency.packagesLoadError = "module root unavailable";
      return;
    }

    const format = "{{.ImportPath}}\t{{.Dir}}";
    const dedupe = new Set<string>();
    const packages: PackageDependency[] = [];

    const parsePackages = (stdout: string) => {
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        const [importPath, directory] = line.split("\t");
        if (!importPath || !directory) {
          continue;
        }
        const key = `${dependency.modulePath}\t${importPath}`;
        if (!dedupe.has(key)) {
          dedupe.add(key);
          packages.push({
            modulePath: dependency.modulePath,
            importPath,
            directory,
          });
        }
      }
    };

    try {
      const withSubPackages = await this.execGo(this.moduleRoot, [
        "list",
        "-mod=mod",
        "-f",
        format,
        `${dependency.modulePath}/...`,
      ]);

      parsePackages(withSubPackages);

      if (packages.length === 0) {
        const rootOnly = await this.execGo(this.moduleRoot, [
          "list",
          "-mod=mod",
          "-f",
          format,
          dependency.modulePath,
        ]);
        parsePackages(rootOnly);
      }

      dependency.packages = packages.sort((a, b) =>
        a.importPath.localeCompare(b.importPath),
      );
      dependency.packagesLoaded = true;
      dependency.packagesLoadError = undefined;
    } catch (error) {
      dependency.packages = [];
      dependency.packagesLoaded = true;
      dependency.packagesLoadError =
        error instanceof Error ? error.message : String(error);
    }
  }

  private async resolveDependencyDirectory(
    dependency: ModuleDependency,
  ): Promise<string | undefined> {
    if (
      dependency.directory &&
      (await this.directoryExists(dependency.directory))
    ) {
      return dependency.directory;
    }

    const fromModCache = await this.resolveFromGoModCache(dependency);
    if (fromModCache) {
      dependency.directory = fromModCache;
      return fromModCache;
    }

    await this.ensureDependencyPackagesLoaded(dependency);

    const inferred = this.inferModuleDirectoryFromPackages(dependency.packages);
    if (inferred && (await this.directoryExists(inferred))) {
      dependency.directory = inferred;
      return inferred;
    }

    return undefined;
  }

  private async listDirectoryChildren(
    directory: string,
    rootPath: string,
  ): Promise<DependencyTreeNode[]> {
    try {
      const dirEntries = await fs.promises.readdir(directory, {
        withFileTypes: true,
      });

      const visibleEntries = dirEntries.filter(
        (entry) => !entry.name.startsWith(".") && entry.name !== "node_modules",
      );

      const folders = visibleEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          kind: "folder" as const,
          folderPath: path.join(directory, entry.name),
          rootPath,
        }))
        .sort((a, b) => a.folderPath.localeCompare(b.folderPath));

      const files = visibleEntries
        .filter((entry) => entry.isFile())
        .map((entry) => ({
          kind: "file" as const,
          filePath: path.join(directory, entry.name),
        }))
        .sort((a, b) => a.filePath.localeCompare(b.filePath));

      return [...folders, ...files];
    } catch (_error) {
      return [];
    }
  }

  private async resolveFromGoModCache(
    dependency: ModuleDependency,
  ): Promise<string | undefined> {
    if (!this.goModCache || !dependency.version) {
      return undefined;
    }

    const escapedPath = escapeModuleValue(dependency.modulePath);
    const escapedVersion = escapeModuleValue(dependency.version);
    const candidate = path.join(
      this.goModCache,
      `${escapedPath}@${escapedVersion}`,
    );

    if (await this.directoryExists(candidate)) {
      return candidate;
    }

    return undefined;
  }

  private inferModuleDirectoryFromPackages(
    packages: PackageDependency[],
  ): string | undefined {
    if (packages.length === 0) {
      return undefined;
    }

    const dirs = packages
      .map((pkg) => pkg.directory)
      .filter((dir) => dir && path.isAbsolute(dir));
    if (dirs.length === 0) {
      return undefined;
    }

    let commonPath = dirs[0];
    for (let index = 1; index < dirs.length; index++) {
      commonPath = longestCommonDirectory(commonPath, dirs[index]);
      if (!commonPath) {
        return undefined;
      }
    }

    return commonPath;
  }

  private async directoryExists(directoryPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(directoryPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private async execGo(cwd: string, args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const sanitizedGoFlags = (process.env.GOFLAGS || "")
        .split(/\s+/)
        .filter((flag) => flag && !flag.startsWith("-mod="))
        .join(" ");

      execFile(
        "go",
        args,
        {
          cwd,
          maxBuffer: 50 * 1024 * 1024,
          env: {
            ...process.env,
            GOFLAGS: sanitizedGoFlags,
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                stderr?.trim() ||
                  stdout?.trim() ||
                  error.message ||
                  "failed to run go command",
              ),
            );
            return;
          }
          resolve(stdout);
        },
      );
    });
  }
}

function parseConcatenatedJson<T>(input: string): T[] {
  const results: T[] = [];
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let start = -1;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === "\\") {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const chunk = input.slice(start, index + 1);
        results.push(JSON.parse(chunk) as T);
        start = -1;
      }
    }
  }

  return results;
}

function longestCommonDirectory(pathA: string, pathB: string): string {
  const resolvedA = path.resolve(pathA).split(path.sep).filter(Boolean);
  const resolvedB = path.resolve(pathB).split(path.sep).filter(Boolean);
  const maxLength = Math.min(resolvedA.length, resolvedB.length);
  const shared: string[] = [];

  for (let index = 0; index < maxLength; index++) {
    if (resolvedA[index] !== resolvedB[index]) {
      break;
    }
    shared.push(resolvedA[index]);
  }

  if (shared.length === 0) {
    return "";
  }

  const root = path.parse(path.resolve(pathA)).root;
  return path.join(root, ...shared);
}

function escapeModuleValue(value: string): string {
  let escaped = "";
  for (const char of value) {
    if (char >= "A" && char <= "Z") {
      escaped += `!${char.toLowerCase()}`;
      continue;
    }
    escaped += char;
  }
  return escaped;
}
