import * as vscode from "vscode";

type ResultSource = "current" | "history";

export interface ResultSelectionRequest {
  source: ResultSource;
  testName: string;
  packagePath: string;
  runId?: string;
  scope?: "test" | "file" | "package" | "module";
  filePath?: string;
  moduleRoot?: string;
  label?: string;
}

interface ResultLeafPayload {
  key: string;
  source: ResultSource;
  testName: string;
  packagePath: string;
  filePath: string;
  status: string;
  duration: number;
  coverage: number | null;
  output: string;
  runId?: string;
}

class SelectionState {
  private readonly emitter = new vscode.EventEmitter<void>();
  private current?: ResultLeafPayload;

  readonly onDidChange = this.emitter.event;

  set(payload?: ResultLeafPayload): void {
    this.current = payload;
    this.emitter.fire();
  }

  get(): ResultLeafPayload | undefined {
    return this.current;
  }
}

class LogNode extends vscode.TreeItem {
  constructor(
    id: string,
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly children: LogNode[] = [],
    description?: string,
  ) {
    super(label, collapsible);
    this.id = id;
    this.description = description;
  }
}

export class GoTestResultsLogProvider implements vscode.TreeDataProvider<LogNode> {
  private readonly emitter = new vscode.EventEmitter<LogNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly selectionState: SelectionState) {
    this.selectionState.onDidChange(() => this.emitter.fire(undefined));
  }

  getTreeItem(element: LogNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: LogNode): Thenable<LogNode[]> {
    if (!element) {
      const selected = this.selectionState.get();
      if (!selected) {
        return Promise.resolve([
          new LogNode(
            "results-log-empty",
            "No test selected",
            vscode.TreeItemCollapsibleState.None,
            [],
            "Select a test in Tests view",
          ),
        ]);
      }

      return Promise.resolve(this.makeConsoleNodes(selected));
    }

    return Promise.resolve(element.children);
  }

  private makeConsoleNodes(selected: ResultLeafPayload): LogNode[] {
    const duration = Number.isFinite(selected.duration)
      ? `${selected.duration.toFixed(2)}s`
      : "0.00s";
    const coverage =
      selected.coverage !== null && selected.coverage !== undefined
        ? `${selected.coverage.toFixed(1)}%`
        : "n/a";

    const header = new LogNode(
      `results-log-header|${selected.key}`,
      `${selected.testName} (${duration}, ${coverage})`,
      vscode.TreeItemCollapsibleState.None,
    );
    header.iconPath = new vscode.ThemeIcon("terminal");

    const lines = this.makeLineNodes(selected.output, selected.key);
    return [header, ...lines];
  }

  private makeLineNodes(output: string, key: string): LogNode[] {
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return [
        new LogNode(
          `results-log-line|${key}|0`,
          "(no output)",
          vscode.TreeItemCollapsibleState.None,
        ),
      ];
    }

    return lines.map((line, index) => {
      const lineNode = new LogNode(
        `results-log-line|${key}|${index}`,
        line,
        vscode.TreeItemCollapsibleState.None,
      );
      lineNode.description = `${index + 1}`;
      return lineNode;
    });
  }
}

export function createResultsState(): SelectionState {
  return new SelectionState();
}
