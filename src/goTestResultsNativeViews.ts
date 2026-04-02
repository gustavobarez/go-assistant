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
  private static readonly MAX_LOG_LINE_LENGTH = 120;
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
    const normalizedOutput = output
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n");

    const lines = normalizedOutput
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

    const wrappedLines = lines.flatMap((line) => this.wrapLine(line));

    return wrappedLines.map(
      (line, index) =>
        new LogNode(
          `results-log-line|${key}|${index}`,
          line,
          vscode.TreeItemCollapsibleState.None,
        ),
    );
  }

  private wrapLine(line: string): string[] {
    if (line.length <= GoTestResultsLogProvider.MAX_LOG_LINE_LENGTH) {
      return [line];
    }

    const chunks: string[] = [];
    let remaining = line;

    while (remaining.length > GoTestResultsLogProvider.MAX_LOG_LINE_LENGTH) {
      const slice = remaining.slice(
        0,
        GoTestResultsLogProvider.MAX_LOG_LINE_LENGTH,
      );
      const breakAt = slice.lastIndexOf(" ");

      if (breakAt > 0) {
        chunks.push(slice.slice(0, breakAt));
        remaining = remaining.slice(breakAt + 1);
      } else {
        chunks.push(slice);
        remaining = remaining.slice(
          GoTestResultsLogProvider.MAX_LOG_LINE_LENGTH,
        );
      }
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }
}

export function createResultsState(): SelectionState {
  return new SelectionState();
}
