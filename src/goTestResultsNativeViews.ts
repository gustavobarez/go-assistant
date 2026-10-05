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

export interface ResultLeafPayload {
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

export class SelectionState {
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

export class GoTestResultsLogProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "goAssistantTestsLog";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly selectionState: SelectionState,
  ) {
    this.selectionState.onDidChange(() => {
      this.updateView();
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case "ready": {
          this.updateView();
          break;
        }
        case "copy": {
          if (message.text) {
            void vscode.env.clipboard.writeText(message.text);
            void vscode.window.showInformationMessage(
              "Test log copied to clipboard",
            );
          }
          break;
        }
        case "clear": {
          this.selectionState.set(undefined);
          break;
        }
      }
    });

    this.updateView();
  }

  public show(): void {
    if (this._view) {
      this._view.show(true);
    }
  }

  public getCurrentPayload(): ResultLeafPayload | undefined {
    return this.selectionState.get();
  }

  public updateView(): void {
    if (!this._view) {
      return;
    }

    const payload = this.selectionState.get();
    void this._view.webview.postMessage({
      type: "setLog",
      payload: payload ?? null,
    });
  }

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Log</title>
  <style>
    :root {
      --term-font: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
      --term-size: var(--vscode-editor-font-size, 12px);
      --term-bg: var(--vscode-terminal-background, var(--vscode-editor-background, #181818));
      --term-fg: var(--vscode-terminal-foreground, var(--vscode-editor-foreground, #cccccc));
      --ansi-green: var(--vscode-terminal-ansiGreen, #4ec9b0);
      --ansi-red: var(--vscode-terminal-ansiRed, #f14c4c);
      --ansi-yellow: var(--vscode-terminal-ansiYellow, #cca700);
      --ansi-cyan: var(--vscode-terminal-ansiCyan, #56b6c2);
      --ansi-blue: var(--vscode-terminal-ansiBlue, #2472c8);
      --ansi-gray: var(--vscode-descriptionForeground, #858585);
      --border-color: var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background-color: var(--term-bg);
      color: var(--term-fg);
      font-family: var(--term-font);
      font-size: var(--term-size);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      user-select: text;
      -webkit-user-select: text;
    }

    .terminal-header {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background-color: var(--vscode-editorGroupHeader-tabsBackground, rgba(0, 0, 0, 0.15));
      border-bottom: 1px solid var(--border-color);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 11px;
      flex-shrink: 0;
      gap: 8px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .test-title {
      font-weight: 600;
      color: var(--vscode-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .badge-pass {
      background-color: rgba(78, 201, 176, 0.2);
      color: var(--ansi-green);
      border: 1px solid rgba(78, 201, 176, 0.4);
    }

    .badge-fail {
      background-color: rgba(241, 76, 76, 0.2);
      color: var(--ansi-red);
      border: 1px solid rgba(241, 76, 76, 0.4);
    }

    .badge-running {
      background-color: rgba(36, 114, 200, 0.2);
      color: var(--ansi-blue);
      border: 1px solid rgba(36, 114, 200, 0.4);
    }

    .meta-info {
      color: var(--ansi-gray);
      font-size: 11px;
      flex-shrink: 0;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .action-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--vscode-foreground);
      opacity: 0.85;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-family: var(--vscode-font-family, sans-serif);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      user-select: none;
    }

    .action-btn:hover {
      opacity: 1;
      background-color: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
    }

    .action-btn.active {
      opacity: 1;
      background-color: var(--vscode-toolbar-activeBackground, rgba(128, 128, 128, 0.25));
      border-color: var(--border-color);
    }

    .terminal-scroll-area {
      flex: 1;
      overflow: auto;
      padding: 8px 12px;
      font-family: var(--term-font);
      font-size: var(--term-size);
      line-height: 1.45;
    }

    .terminal-output {
      margin: 0;
      padding: 0;
      white-space: pre-wrap;
      word-break: break-all;
      tab-size: 4;
      font-family: inherit;
      color: var(--term-fg);
    }

    .terminal-output.nowrap {
      white-space: pre;
      word-break: normal;
    }

    /* Go Test Output Highlights */
    .line-run {
      color: var(--ansi-cyan);
      font-weight: 600;
    }

    .line-pass {
      color: var(--ansi-green);
      font-weight: 600;
    }

    .line-fail {
      color: var(--ansi-red);
      font-weight: 600;
    }

    .line-error {
      color: var(--ansi-red);
    }

    .line-file-loc {
      color: var(--ansi-yellow);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--ansi-gray);
      text-align: center;
      padding: 24px;
      user-select: none;
    }

    .terminal-prompt {
      font-family: var(--term-font);
      font-size: 13px;
      color: var(--ansi-green);
      margin-bottom: 12px;
      opacity: 0.9;
    }

    .empty-title {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--vscode-foreground);
    }

    .empty-subtitle {
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 11px;
      max-width: 320px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="terminal-header" id="header">
    <div class="header-left">
      <span class="badge" id="statusBadge">PASS</span>
      <span class="test-title" id="testTitle">Test</span>
      <span class="meta-info" id="metaInfo"></span>
    </div>
    <div class="header-actions">
      <button class="action-btn active" id="btnWrap" title="Toggle line wrapping">Wrap</button>
      <button class="action-btn" id="btnCopy" title="Copy output to clipboard">Copy</button>
      <button class="action-btn" id="btnClear" title="Clear log">Clear</button>
    </div>
  </div>

  <div class="terminal-scroll-area" id="scrollArea">
    <div class="empty-state" id="emptyState">
      <div class="terminal-prompt">$ go test</div>
      <div class="empty-title">No test output to display</div>
      <div class="empty-subtitle">Run a test or select an item in the Tests tree on the left to inspect its terminal output.</div>
    </div>
    <pre class="terminal-output" id="terminalOutput" style="display: none;"></pre>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const headerEl = document.getElementById('header');
    const titleEl = document.getElementById('testTitle');
    const badgeEl = document.getElementById('statusBadge');
    const metaEl = document.getElementById('metaInfo');
    const outputEl = document.getElementById('terminalOutput');
    const scrollArea = document.getElementById('scrollArea');
    const emptyEl = document.getElementById('emptyState');
    const btnWrap = document.getElementById('btnWrap');
    const btnCopy = document.getElementById('btnCopy');
    const btnClear = document.getElementById('btnClear');

    let currentRawOutput = '';
    let isWrapped = true;

    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function colorizeGoTestLine(escapedLine) {
      if (escapedLine.startsWith('=== RUN') || escapedLine.startsWith('=== CONT')) {
        return '<span class="line-run">' + escapedLine + '</span>';
      }
      if (escapedLine.startsWith('--- PASS:')) {
        return '<span class="line-pass">' + escapedLine + '</span>';
      }
      if (escapedLine.startsWith('--- FAIL:')) {
        return '<span class="line-fail">' + escapedLine + '</span>';
      }
      if (escapedLine === 'PASS' || escapedLine.startsWith('ok  \\t') || escapedLine.startsWith('ok\\t')) {
        return '<span class="line-pass">' + escapedLine + '</span>';
      }
      if (escapedLine === 'FAIL' || escapedLine.startsWith('FAIL\\t')) {
        return '<span class="line-fail">' + escapedLine + '</span>';
      }
      if (/^\\s*([a-zA-Z0-9_\\-\\.\\/]+_test\\.go:\\d+:)/.test(escapedLine)) {
        return escapedLine.replace(/^(\\s*)([a-zA-Z0-9_\\-\\.\\/]+_test\\.go:\\d+:)/, '$1<span class="line-file-loc">$2</span>');
      }
      if (escapedLine.includes('panic:') || escapedLine.includes('FAIL:')) {
        return '<span class="line-error">' + escapedLine + '</span>';
      }
      return escapedLine;
    }

    function renderLog(payload) {
      if (!payload || !payload.output) {
        headerEl.style.display = 'none';
        outputEl.style.display = 'none';
        outputEl.innerHTML = '';
        emptyEl.style.display = 'flex';
        currentRawOutput = '';
        return;
      }

      emptyEl.style.display = 'none';
      outputEl.style.display = 'block';
      headerEl.style.display = 'flex';

      titleEl.textContent = payload.testName;
      titleEl.title = payload.testName;

      const status = (payload.status || 'unknown').toLowerCase();
      badgeEl.className = 'badge ' + (status === 'pass' ? 'badge-pass' : status === 'fail' ? 'badge-fail' : 'badge-running');
      badgeEl.textContent = status.toUpperCase();

      const durationStr = typeof payload.duration === 'number' && Number.isFinite(payload.duration)
        ? payload.duration.toFixed(2) + 's'
        : '';
      const coverageStr = payload.coverage !== null && payload.coverage !== undefined
        ? payload.coverage.toFixed(1) + '%'
        : '';

      const metaParts = [durationStr, coverageStr].filter(Boolean);
      metaEl.textContent = metaParts.length > 0 ? metaParts.join(' · ') : '';

      currentRawOutput = payload.output;

      const rawLines = payload.output
        .replace(/\\r\\n/g, '\\n')
        .replace(/\\n/g, '\\n')
        .split(/\\r?\\n/);

      const formattedLines = rawLines.map(line => colorizeGoTestLine(escapeHtml(line)));
      outputEl.innerHTML = formattedLines.join('\\n');

      scrollArea.scrollTop = scrollArea.scrollHeight;
    }

    btnWrap.addEventListener('click', () => {
      isWrapped = !isWrapped;
      outputEl.classList.toggle('nowrap', !isWrapped);
      btnWrap.classList.toggle('active', isWrapped);
    });

    btnCopy.addEventListener('click', () => {
      if (!currentRawOutput) return;
      vscode.postMessage({ type: 'copy', text: currentRawOutput });
    });

    btnClear.addEventListener('click', () => {
      vscode.postMessage({ type: 'clear' });
    });

    window.addEventListener('message', event => {
      if (event.data?.type === 'setLog') {
        renderLog(event.data.payload);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

export function createResultsState(): SelectionState {
  return new SelectionState();
}
