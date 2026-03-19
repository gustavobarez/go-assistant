import * as vscode from "vscode";
import { GoTestsViewProvider } from "./goTestsView";

/**
 * Embedded webview view (not editor tab) to display test logs and results.
 */
export class GoTestResultsPanel implements vscode.WebviewViewProvider {
  public static readonly viewId = "goAssistantTestResults";

  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private selectedId?: string;

  constructor(private testsViewProvider: GoTestsViewProvider) {
    this.disposables.push(
      this.testsViewProvider.onDidChangeTreeData(() => this.update()),
    );
  }

  public async reveal(selected?: {
    source: "current" | "history";
    testName: string;
    packagePath: string;
    runId?: string;
  }) {
    if (selected) {
      this.selectedId = this.makeSelectedId(selected);
    }

    if (
      !selected &&
      this.testsViewProvider.getAllTestResults().length === 0 &&
      this.testsViewProvider.getRunHistory().length === 0
    ) {
      return;
    }

    await vscode.commands.executeCommand(
      "workbench.view.extension.go-assistant-test-results",
    );
    await vscode.commands.executeCommand(`${GoTestResultsPanel.viewId}.focus`);
    this.view?.show(true);
    this.update();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView;
    webviewView.title = "Test Results (Go Assistant)";
    webviewView.description = "Latest logs and statuses";
    webviewView.webview.options = { enableScripts: true };
    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
    this.update();
  }

  public dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private update() {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.getHtml(this.view.webview);
  }

  private makeSelectedId(selected: {
    source: "current" | "history";
    testName: string;
    packagePath: string;
    runId?: string;
  }): string {
    if (selected.source === "history") {
      return `history|${selected.runId ?? ""}|${selected.packagePath}|${selected.testName}`;
    }
    return `current|${selected.packagePath}|${selected.testName}`;
  }

  private moduleMap(): Map<string, { moduleName: string; moduleRoot: string }> {
    const map = new Map<string, { moduleName: string; moduleRoot: string }>();
    for (const mod of this.testsViewProvider.getModules()) {
      for (const pkg of mod.packages) {
        map.set(pkg.packagePath, {
          moduleName: mod.moduleName,
          moduleRoot: mod.moduleRoot,
        });
      }
    }
    return map;
  }

  private matchesLastRun(packagePath: string, testName: string): boolean {
    const spec = this.testsViewProvider.getLastRunSpec();
    if (!spec) {
      return true;
    }

    if (spec.packagePath && spec.packagePath !== packagePath) {
      return false;
    }

    if (!spec.testPattern) {
      return true;
    }

    try {
      return new RegExp(spec.testPattern).test(testName);
    } catch {
      return true;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    type RawResultEntry = {
      source: "current" | "history";
      runId?: string;
      testName: string;
      packagePath: string;
      filePath: string;
      status: string;
      duration: number;
      coverage: number | null;
      fileCoverage: number | null;
      output: string;
    };

    type UiTestNode = {
      id: string;
      fullName: string;
      label: string;
      status: string;
      duration: number;
      coverage: number | null;
      output: string;
      packagePath: string;
      filePath: string;
      children: UiTestNode[];
    };

    type UiFileNode = {
      fileName: string;
      filePath: string;
      coverage: number | null;
      tests: UiTestNode[];
    };

    type UiPackageNode = {
      packageTitle: string;
      packagePath: string;
      coverage: number | null;
      files: UiFileNode[];
    };

    type UiModuleNode = {
      moduleName: string;
      moduleRoot: string;
      packages: UiPackageNode[];
    };

    type UiRunNode = {
      id: string;
      label: string;
      passCount: number;
      failCount: number;
      modules: UiModuleNode[];
    };

    const packageNameByPath = new Map<string, string>();
    for (const pkg of this.testsViewProvider.getPackages()) {
      packageNameByPath.set(pkg.packagePath, pkg.packageName);
    }

    const moduleByPackage = this.moduleMap();

    const ensureTestNode = (
      topLevel: Map<string, UiTestNode>,
      idPrefix: string,
      packagePath: string,
      filePath: string,
      fullName: string,
    ): UiTestNode | null => {
      const parts = fullName.split("/").filter(Boolean);
      if (parts.length === 0) {
        return null;
      }

      const ensure = (
        nodeFullName: string,
        label: string,
        parent?: UiTestNode,
      ): UiTestNode => {
        if (!parent) {
          const existing = topLevel.get(nodeFullName);
          if (existing) {
            return existing;
          }
          const created: UiTestNode = {
            id: `${idPrefix}|${packagePath}|${nodeFullName}`,
            fullName: nodeFullName,
            label,
            status: "unknown",
            duration: 0,
            coverage: null,
            output: "",
            packagePath,
            filePath,
            children: [],
          };
          topLevel.set(nodeFullName, created);
          return created;
        }

        const existing = parent.children.find(
          (child) => child.fullName === nodeFullName,
        );
        if (existing) {
          return existing;
        }

        const created: UiTestNode = {
          id: `${idPrefix}|${packagePath}|${nodeFullName}`,
          fullName: nodeFullName,
          label,
          status: "unknown",
          duration: 0,
          coverage: null,
          output: "",
          packagePath,
          filePath,
          children: [],
        };
        parent.children.push(created);
        return created;
      };

      let current = ensure(parts[0], parts[0]);
      let built = parts[0];
      for (let index = 1; index < parts.length; index += 1) {
        built = `${built}/${parts[index]}`;
        current = ensure(built, parts[index], current);
      }

      return current;
    };

    const toModules = (packages: UiPackageNode[]): UiModuleNode[] => {
      const grouped = new Map<string, UiModuleNode>();
      for (const pkg of packages) {
        const mod = moduleByPackage.get(pkg.packagePath) ?? {
          moduleName: "(unknown module)",
          moduleRoot: pkg.packagePath,
        };
        const key = `${mod.moduleName}::${mod.moduleRoot}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            moduleName: mod.moduleName,
            moduleRoot: mod.moduleRoot,
            packages: [],
          });
        }
        grouped.get(key)!.packages.push(pkg);
      }

      return Array.from(grouped.values())
        .map((mod) => ({
          ...mod,
          packages: mod.packages.sort((a, b) =>
            a.packagePath.localeCompare(b.packagePath),
          ),
        }))
        .sort((a, b) => a.moduleName.localeCompare(b.moduleName));
    };

    const buildPackages = (
      entries: RawResultEntry[],
      idPrefix: string,
    ): UiPackageNode[] => {
      const grouped = new Map<string, Map<string, RawResultEntry[]>>();

      for (const entry of entries) {
        if (!grouped.has(entry.packagePath)) {
          grouped.set(entry.packagePath, new Map());
        }
        const files = grouped.get(entry.packagePath)!;
        if (!files.has(entry.filePath)) {
          files.set(entry.filePath, []);
        }
        files.get(entry.filePath)!.push(entry);
      }

      return Array.from(grouped.entries())
        .map(([packagePath, fileMap]) => {
          const files: UiFileNode[] = Array.from(fileMap.entries())
            .map(([filePath, fileEntries]) => {
              const topLevel = new Map<string, UiTestNode>();

              for (const entry of fileEntries.sort((a, b) =>
                a.testName.localeCompare(b.testName),
              )) {
                const node = ensureTestNode(
                  topLevel,
                  entry.runId ? `${idPrefix}|${entry.runId}` : idPrefix,
                  entry.packagePath,
                  entry.filePath,
                  entry.testName,
                );
                if (!node) {
                  continue;
                }
                node.status = entry.status;
                node.duration = entry.duration;
                node.coverage = entry.coverage;
                node.output = entry.output;
              }

              const fileCoverage =
                fileEntries[0]?.fileCoverage ??
                this.testsViewProvider.getFileCoverage(filePath);

              return {
                fileName: filePath.split("/").pop() ?? filePath,
                filePath,
                coverage: fileCoverage,
                tests: Array.from(topLevel.values()).sort((a, b) =>
                  a.fullName.localeCompare(b.fullName),
                ),
              };
            })
            .sort((a, b) => a.filePath.localeCompare(b.filePath));

          const packageCoverage =
            files
              .flatMap((file) => file.tests)
              .find((test) => test.coverage !== null)?.coverage ??
            this.testsViewProvider.getPackageCoverage(packagePath);

          return {
            packageTitle: packageNameByPath.get(packagePath) ?? packagePath,
            packagePath,
            coverage: packageCoverage,
            files,
          };
        })
        .sort((a, b) => a.packagePath.localeCompare(b.packagePath));
    };

    const discoveredPackages = new Set(
      this.testsViewProvider.getPackages().map((pkg) => pkg.packagePath),
    );

    const currentResults = this.testsViewProvider
      .getAllTestResults()
      .slice()
      .sort((a, b) => {
        if (a.packagePath !== b.packagePath) {
          return a.packagePath.localeCompare(b.packagePath);
        }
        if (a.file !== b.file) {
          return (a.file || "").localeCompare(b.file || "");
        }
        return a.testName.localeCompare(b.testName);
      });

    const hasRealResults = currentResults.some(
      (result) => result.testName !== "(go test runner output)",
    );

    const currentEntries: RawResultEntry[] = currentResults
      .filter((result) => {
        if (result.testName !== "(go test runner output)") {
          return this.matchesLastRun(result.packagePath, result.testName);
        }
        if (!hasRealResults) {
          return true;
        }
        return discoveredPackages.has(result.packagePath);
      })
      .filter(
        (result) =>
          !(result.testName === "(go test runner output)" && hasRealResults),
      )
      .map((result) => ({
        source: "current",
        testName: result.testName,
        packagePath: result.packagePath || "<unknown package>",
        filePath:
          result.testName === "(go test runner output)"
            ? "(runner output)"
            : result.file || "(unknown file)",
        status: result.status,
        duration: result.duration,
        coverage:
          result.output.coverage ??
          this.testsViewProvider.getPackageCoverage(result.packagePath),
        fileCoverage: this.testsViewProvider.getFileCoverage(result.file),
        output: result.output.output.join("") || "(no output)",
      }));

    const currentModules = toModules(buildPackages(currentEntries, "current"));

    const historyRuns: UiRunNode[] = this.testsViewProvider
      .getRunHistory()
      .slice()
      .reverse()
      .map((run) => {
        const runEntries: RawResultEntry[] = run.entries.map((entry) => ({
          source: "history",
          runId: run.id,
          testName: entry.testName,
          packagePath: entry.packagePath || "<unknown package>",
          filePath: entry.file || "(unknown file)",
          status: entry.status,
          duration: entry.duration ?? 0,
          coverage:
            entry.packageCoverage ??
            this.testsViewProvider.getPackageCoverage(entry.packagePath),
          fileCoverage:
            entry.fileCoverage ??
            this.testsViewProvider.getFileCoverage(entry.file),
          output: entry.output || "(no output)",
        }));

        return {
          id: run.id,
          label: run.label,
          passCount: run.entries.filter((entry) => entry.status === "pass")
            .length,
          failCount: run.entries.filter((entry) => entry.status === "fail")
            .length,
          modules: toModules(buildPackages(runEntries, "history")),
        };
      });

    const allNodes: UiTestNode[] = [];
    const collectNodes = (nodes: UiTestNode[]) => {
      for (const node of nodes) {
        allNodes.push(node);
        if (node.children.length > 0) {
          collectNodes(node.children);
        }
      }
    };

    const collectModules = (modules: UiModuleNode[]) => {
      for (const mod of modules) {
        for (const pkg of mod.packages) {
          for (const file of pkg.files) {
            collectNodes(file.tests);
          }
        }
      }
    };

    collectModules(currentModules);
    for (const run of historyRuns) {
      collectModules(run.modules);
    }

    if (
      !this.selectedId ||
      !allNodes.some((node) => node.id === this.selectedId)
    ) {
      this.selectedId = allNodes[0]?.id;
    }

    const treeData = {
      currentModules,
      historyRuns,
    };
    const selectedId = this.selectedId ?? "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Go Assistant Test Results</title>
  <style>
    body {
      margin: 0;
      padding: 10px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: 12px;
      line-height: 1.45;
      height: 100vh;
      box-sizing: border-box;
    }

    .empty {
      color: var(--vscode-descriptionForeground);
      padding: 12px;
      border: 1px dashed var(--vscode-editorWidget-border);
      border-radius: 6px;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(340px, 1fr) minmax(260px, 40%);
      gap: 10px;
      height: calc(100vh - 20px);
    }

    .panel {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
      overflow: hidden;
      min-height: 0;
    }

    .panel-header {
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      background: var(--vscode-sideBar-background);
      font-weight: 600;
    }

    .log-body {
      margin: 0;
      padding: 8px;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size, 12px);
      overflow: auto;
      height: calc(100% - 31px);
      box-sizing: border-box;
    }

    .tree {
      overflow: auto;
      height: calc(100% - 31px);
      padding: 6px;
      box-sizing: border-box;
    }

    .tree ul {
      list-style: none;
      margin: 0;
      padding-left: 14px;
    }

    .tree > ul {
      padding-left: 0;
    }

    .node-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
    }

    .type-icon, .status, .expander {
      width: 16px;
      text-align: center;
      font-weight: 700;
      opacity: 0.95;
    }

    .kind-section .type-icon { color: var(--vscode-textLink-foreground); }
    .kind-run .type-icon { color: var(--vscode-testing-iconQueued, #cca700); }
    .kind-module .type-icon { color: var(--vscode-foreground); }
    .kind-package .type-icon { color: var(--vscode-charts-blue, #4FC1FF); }
    .kind-file .type-icon { color: var(--vscode-foreground); }

    .status-pass { color: var(--vscode-testing-iconPassed, #73c991); }
    .status-fail { color: var(--vscode-testing-iconFailed, #f14c4c); }
    .status-running { color: var(--vscode-testing-iconQueued, #cca700); }
    .status-skip { color: var(--vscode-testing-iconSkipped, #c5c5c5); }
    .status-unknown { color: var(--vscode-descriptionForeground); }

    details.run-details,
    details.tree-node {
      margin: 2px 0;
    }

    details.run-details > summary,
    details.tree-node > summary {
      list-style: none;
      cursor: pointer;
    }

    details.run-details[open] .expander,
    details.tree-node[open] > summary .expander {
      transform: rotate(90deg);
    }

    .expander {
      transition: transform 120ms ease;
      color: var(--vscode-descriptionForeground);
    }

    details.run-details > summary::-webkit-details-marker,
    details.tree-node > summary::-webkit-details-marker {
      display: none;
    }

    .run-content {
      padding-left: 14px;
    }

    .tree-node-content {
      padding-left: 14px;
    }

    .node-button {
      all: unset;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 6px;
      border-radius: 4px;
      flex: 1;
      min-width: 0;
    }

    .node-button:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .node-button.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .node-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node-meta {
      margin-left: auto;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  ${
    treeData.currentModules.length === 0 && treeData.historyRuns.length === 0
      ? '<div class="empty">No test results yet. Run tests to populate this view.</div>'
      : `
    <div class="layout">
      <section class="panel">
        <div class="panel-header" id="logHeader">Log</div>
        <pre class="log-body" id="logBody"></pre>
      </section>
      <section class="panel">
        <div class="panel-header">Tests</div>
        <div class="tree" id="treeRoot"></div>
      </section>
    </div>
  `
  }
  <script>
    const data = ${JSON.stringify(treeData)};
    let selectedId = ${JSON.stringify(selectedId)};

    const statusIconChar = (status) => {
      switch ((status || '').toLowerCase()) {
        case 'pass': return '✓';
        case 'fail': return '✗';
        case 'running': return '↻';
        case 'skip': return '⊘';
        default: return '•';
      }
    };

    const formatDuration = (duration) => {
      if (typeof duration === 'number' && Number.isFinite(duration)) {
        return duration.toFixed(2) + 's';
      }
      return '0.00s';
    };

    const formatMeta = (node) => {
      const parts = [];
      if (node.status && node.status !== 'unknown') {
        parts.push(node.status);
      }
      parts.push(formatDuration(node.duration));
      if (node.coverage !== null && node.coverage !== undefined) {
        parts.push(node.coverage.toFixed(1) + '%');
      }
      return parts.join(' · ');
    };

    const testIndex = new Map();

    const indexTests = (nodes) => {
      for (const node of nodes) {
        testIndex.set(node.id, node);
        if (node.children && node.children.length > 0) {
          indexTests(node.children);
        }
      }
    };

    const indexModules = (modules) => {
      for (const mod of modules) {
        for (const pkg of mod.packages) {
          for (const file of pkg.files) {
            indexTests(file.tests || []);
          }
        }
      }
    };

    indexModules(data.currentModules);
    for (const run of data.historyRuns) {
      indexModules(run.modules);
    }

    if (!selectedId && testIndex.size > 0) {
      selectedId = Array.from(testIndex.keys())[0];
    }

    const makeNodeGroup = ({
      className,
      iconClass,
      label,
      meta,
      defaultOpen,
      childrenRenderer,
    }) => {
      const details = document.createElement('details');
      details.className = 'tree-node';
      details.open = defaultOpen;

      const summary = document.createElement('summary');
      summary.className = 'node-row ' + className;

      const expander = document.createElement('span');
      expander.className = 'expander';
      expander.textContent = '▸';

      const icon = document.createElement('span');
      icon.className = 'type-icon';
      icon.textContent = iconClass;

      const rowLabel = document.createElement('span');
      rowLabel.className = 'node-label';
      rowLabel.style.fontWeight = '600';
      rowLabel.textContent = label;

      const rowMeta = document.createElement('span');
      rowMeta.className = 'node-meta';
      rowMeta.textContent = meta;

      summary.append(expander, icon, rowLabel, rowMeta);
      details.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'tree-node-content';
      childrenRenderer(content);
      details.appendChild(content);
      return details;
    };

    const renderTestNodes = (container, nodes) => {
      const list = document.createElement('ul');
      for (const node of nodes) {
        const item = document.createElement('li');

        if (node.children && node.children.length > 0) {
          const group = makeNodeGroup({
            className: 'kind-test',
            iconClass: '◉',
            label: node.label,
            meta: formatMeta(node),
            defaultOpen: false,
            childrenRenderer: (content) => {
              renderTestNodes(content, node.children || []);
            },
          });

          const summary = group.querySelector('summary');
          if (summary) {
            summary.addEventListener('click', () => {
              selectedId = node.id;
              updateSelection();
            });
          }

          item.appendChild(group);
          list.appendChild(item);
          continue;
        }

        const row = document.createElement('div');
        row.className = 'node-row';

        const button = document.createElement('button');
        button.className = 'node-button';
        button.dataset.id = node.id;

        const testTypeIcon = document.createElement('span');
        testTypeIcon.className = 'type-icon';
        testTypeIcon.textContent = '◉';

        const icon = document.createElement('span');
        icon.className = 'status status-' + (node.status || 'unknown');
        icon.textContent = statusIconChar(node.status);

        const label = document.createElement('span');
        label.className = 'node-label';
        label.textContent = node.label;

        const meta = document.createElement('span');
        meta.className = 'node-meta';
        meta.textContent = formatMeta(node);

        button.append(testTypeIcon, icon, label, meta);
        button.addEventListener('click', () => {
          selectedId = node.id;
          updateSelection();
        });

        row.appendChild(button);
        item.appendChild(row);

        list.appendChild(item);
      }
      container.appendChild(list);
    };

    const renderModules = (container, modules) => {
      const modulesList = document.createElement('ul');
      for (const mod of modules) {
        const modItem = document.createElement('li');
        const moduleGroup = makeNodeGroup({
          className: 'kind-module',
          iconClass: '{}',
          label: mod.moduleName,
          meta: mod.moduleRoot,
          defaultOpen: true,
          childrenRenderer: (moduleContent) => {
            const packagesList = document.createElement('ul');
            for (const pkg of mod.packages) {
              const pkgItem = document.createElement('li');
              const packageGroup = makeNodeGroup({
                className: 'kind-package',
                iconClass: '□',
                label: pkg.packageTitle,
                meta:
                  pkg.coverage !== null && pkg.coverage !== undefined
                    ? pkg.packagePath + ' · ' + pkg.coverage.toFixed(1) + '%'
                    : pkg.packagePath,
                defaultOpen: true,
                childrenRenderer: (packageContent) => {
                  const fileList = document.createElement('ul');
                  for (const file of pkg.files) {
                    const fileItem = document.createElement('li');
                    const fileGroup = makeNodeGroup({
                      className: 'kind-file',
                      iconClass: '≡',
                      label: file.fileName,
                      meta:
                        file.coverage !== null && file.coverage !== undefined
                          ? file.filePath + ' · ' + file.coverage.toFixed(1) + '%'
                          : file.filePath,
                      defaultOpen: true,
                      childrenRenderer: (fileContent) => {
                        renderTestNodes(fileContent, file.tests || []);
                      },
                    });
                    fileItem.appendChild(fileGroup);
                    fileList.appendChild(fileItem);
                  }
                  packageContent.appendChild(fileList);
                },
              });

              pkgItem.appendChild(packageGroup);
              packagesList.appendChild(pkgItem);
            }
            moduleContent.appendChild(packagesList);
          },
        });

        modItem.appendChild(moduleGroup);
        modulesList.appendChild(modItem);
      }
      container.appendChild(modulesList);
    };

    const treeRoot = document.getElementById('treeRoot');
    const logHeader = document.getElementById('logHeader');
    const logBody = document.getElementById('logBody');

    if (treeRoot) {
      const rootList = document.createElement('ul');
      rootList.style.paddingLeft = '0';

      const latestItem = document.createElement('li');
      renderModules(latestItem, data.currentModules);
      rootList.appendChild(latestItem);

      const historyItem = document.createElement('li');
      const historyDetails = document.createElement('details');
      historyDetails.className = 'tree-node';
      historyDetails.open = true;

      const historyRow = document.createElement('summary');
      historyRow.className = 'node-row kind-section';
      const historyExpander = document.createElement('span');
      historyExpander.className = 'expander';
      historyExpander.textContent = '▸';
      const historyIcon = document.createElement('span');
      historyIcon.className = 'type-icon';
      historyIcon.textContent = 'H';
      const historyLabel = document.createElement('span');
      historyLabel.className = 'node-label';
      historyLabel.style.fontWeight = '700';
      historyLabel.textContent = 'History';
      historyRow.append(historyExpander, historyIcon, historyLabel);
      historyDetails.appendChild(historyRow);

      const runsList = document.createElement('ul');
      for (const run of data.historyRuns) {
        const runItem = document.createElement('li');
        const runDetails = document.createElement('details');
        runDetails.className = 'run-details';
        runDetails.open = false;

        const runRow = document.createElement('summary');
        runRow.className = 'node-row kind-run';

        const runExpander = document.createElement('span');
        runExpander.className = 'expander';
        runExpander.textContent = '▸';

        const runIcon = document.createElement('span');
        runIcon.className = 'type-icon';
        runIcon.textContent = 'R';

        const runLabel = document.createElement('span');
        runLabel.className = 'node-label';
        runLabel.style.fontWeight = '600';
        runLabel.textContent = run.label;

        const runMeta = document.createElement('span');
        runMeta.className = 'node-meta';
        runMeta.textContent = run.passCount + ' pass' + (run.failCount > 0 ? ' · ' + run.failCount + ' fail' : '');

        runRow.append(runExpander, runIcon, runLabel, runMeta);
        runDetails.appendChild(runRow);

        const runContent = document.createElement('div');
        runContent.className = 'run-content';
        renderModules(runContent, run.modules);
        runDetails.appendChild(runContent);

        runItem.appendChild(runDetails);
        runsList.appendChild(runItem);
      }

      const historyContent = document.createElement('div');
      historyContent.className = 'tree-node-content';
      historyContent.appendChild(runsList);
      historyDetails.appendChild(historyContent);
      historyItem.appendChild(historyDetails);
      rootList.appendChild(historyItem);

      treeRoot.appendChild(rootList);
    }

    const updateSelection = () => {
      const selected = testIndex.get(selectedId);
      for (const button of document.querySelectorAll('.node-button')) {
        if (button.dataset.id === selectedId) {
          button.classList.add('active');
        } else {
          button.classList.remove('active');
        }
      }

      if (!selected) {
        logHeader.textContent = 'Log';
        logBody.textContent = '';
        return;
      }

      logHeader.textContent = selected.fullName + ' · ' + formatMeta(selected);
      logBody.textContent = selected.output || '(no output)';
    };

    updateSelection();
  </script>
</body>
</html>`;
  }
}
