import * as path from "path";
import * as vscode from "vscode";

export interface ReferenceGroup {
  label: string;
  locations: vscode.Location[];
  type: "file" | "group" | "reference";
  uri?: vscode.Uri;
}

export interface SymbolInfo {
  name: string;
  kind: vscode.SymbolKind;
  location: vscode.Location;
}

class ReferenceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly location?: vscode.Location,
    public readonly contextValue?: string,
  ) {
    super(label, collapsibleState);

    if (location) {
      this.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [
          location.uri,
          {
            selection: location.range,
            preview: true,
          },
        ],
      };

      this.tooltip = `${vscode.workspace.asRelativePath(location.uri)}\nLine ${location.range.start.line + 1}`;
      this.description = `Line ${location.range.start.line + 1}`;
    }

    // Set appropriate icon
    if (contextValue === "reference") {
      this.iconPath = new vscode.ThemeIcon("symbol-reference");
    } else if (contextValue === "file") {
      this.iconPath = new vscode.ThemeIcon("file");
    } else if (contextValue === "group") {
      this.iconPath = new vscode.ThemeIcon("folder");
    }
  }
}

export class GoReferencesViewProvider implements vscode.TreeDataProvider<ReferenceTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    ReferenceTreeItem | undefined | null | void
  > = new vscode.EventEmitter<ReferenceTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ReferenceTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private locations: vscode.Location[] = [];
  private title: string = "References";
  private groupedByFile: Map<string, vscode.Location[]> = new Map();
  private symbolInfo?: SymbolInfo;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.locations = [];
    this.title = "References";
    this.groupedByFile.clear();
    this.symbolInfo = undefined;
    this.refresh();
  }

  /**
   * Show references in the tree view
   */
  showReferences(
    title: string,
    locations: vscode.Location[],
    symbolInfo?: SymbolInfo,
  ): void {
    this.title = title;
    this.locations = locations;
    this.symbolInfo = symbolInfo;
    this.groupedByFile.clear();

    // Group locations by file
    for (const location of locations) {
      const filePath = location.uri.fsPath;
      if (!this.groupedByFile.has(filePath)) {
        this.groupedByFile.set(filePath, []);
      }
      this.groupedByFile.get(filePath)!.push(location);
    }

    // Sort locations within each file by line number
    for (const [, locs] of this.groupedByFile) {
      locs.sort((a, b) => a.range.start.line - b.range.start.line);
    }

    this.refresh();
  }

  /**
   * Get appropriate icon for a symbol kind
   */
  private getSymbolIcon(kind: vscode.SymbolKind): vscode.ThemeIcon {
    switch (kind) {
      case vscode.SymbolKind.Struct:
        return new vscode.ThemeIcon("symbol-struct");
      case vscode.SymbolKind.Interface:
        return new vscode.ThemeIcon("symbol-interface");
      case vscode.SymbolKind.Method:
        return new vscode.ThemeIcon("symbol-method");
      case vscode.SymbolKind.Function:
        return new vscode.ThemeIcon("symbol-function");
      case vscode.SymbolKind.Variable:
        return new vscode.ThemeIcon("symbol-variable");
      case vscode.SymbolKind.Constant:
        return new vscode.ThemeIcon("symbol-constant");
      case vscode.SymbolKind.Field:
        return new vscode.ThemeIcon("symbol-field");
      case vscode.SymbolKind.Property:
        return new vscode.ThemeIcon("symbol-property");
      case vscode.SymbolKind.Class:
        return new vscode.ThemeIcon("symbol-class");
      case vscode.SymbolKind.Enum:
        return new vscode.ThemeIcon("symbol-enum");
      default:
        return new vscode.ThemeIcon("symbol-misc");
    }
  }

  /**
   * Get symbol kind label
   */
  private getSymbolKindLabel(kind: vscode.SymbolKind): string {
    switch (kind) {
      case vscode.SymbolKind.Struct:
        return "struct";
      case vscode.SymbolKind.Interface:
        return "interface";
      case vscode.SymbolKind.Method:
        return "method";
      case vscode.SymbolKind.Function:
        return "function";
      case vscode.SymbolKind.Variable:
        return "variable";
      case vscode.SymbolKind.Constant:
        return "constant";
      case vscode.SymbolKind.Field:
        return "field";
      case vscode.SymbolKind.Property:
        return "property";
      case vscode.SymbolKind.Class:
        return "class";
      case vscode.SymbolKind.Enum:
        return "enum";
      default:
        return "symbol";
    }
  }

  /**
   * Detect the context of a reference by analyzing surrounding code
   */
  private async detectReferenceContext(
    document: vscode.TextDocument,
    location: vscode.Location,
  ): Promise<vscode.SymbolKind> {
    try {
      const lineText = document.lineAt(location.range.start.line).text;
      const trimmed = lineText.trim();

      // Check for struct definition
      if (trimmed.startsWith("type ") && trimmed.includes(" struct")) {
        return vscode.SymbolKind.Struct;
      }

      // Check for interface definition
      if (trimmed.startsWith("type ") && trimmed.includes(" interface")) {
        return vscode.SymbolKind.Interface;
      }

      // Check for function/method definition
      if (trimmed.startsWith("func ")) {
        if (
          trimmed.includes("(") &&
          trimmed.indexOf("(") < trimmed.indexOf(")")
        ) {
          // Has receiver - it's a method
          return vscode.SymbolKind.Method;
        }
        return vscode.SymbolKind.Function;
      }

      // Check for variable/constant declaration
      if (trimmed.startsWith("var ")) {
        return vscode.SymbolKind.Variable;
      }
      if (trimmed.startsWith("const ")) {
        return vscode.SymbolKind.Constant;
      }

      // Try to get symbols at this location from document
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      if (symbols) {
        const symbol = this.findSymbolAtPosition(symbols, location.range.start);
        if (symbol) {
          return symbol.kind;
        }
      }

      // Default to method if we can't determine
      return vscode.SymbolKind.Method;
    } catch (error) {
      return vscode.SymbolKind.Method;
    }
  }

  /**
   * Find symbol at a specific position in the symbol tree
   */
  private findSymbolAtPosition(
    symbols: vscode.DocumentSymbol[],
    position: vscode.Position,
  ): vscode.DocumentSymbol | undefined {
    for (const symbol of symbols) {
      if (symbol.range.contains(position)) {
        // Check children first (more specific)
        if (symbol.children) {
          const child = this.findSymbolAtPosition(symbol.children, position);
          if (child) {
            return child;
          }
        }
        return symbol;
      }
    }
    return undefined;
  }

  getTreeItem(element: ReferenceTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ReferenceTreeItem): Promise<ReferenceTreeItem[]> {
    if (!element) {
      // Root level - show summary and files
      const items: ReferenceTreeItem[] = [];

      if (this.locations.length === 0) {
        return [
          new ReferenceTreeItem(
            "No references found",
            vscode.TreeItemCollapsibleState.None,
          ),
        ];
      }

      // Add symbol header if available
      if (this.symbolInfo) {
        const kindLabel = this.getSymbolKindLabel(this.symbolInfo.kind);
        const headerItem = new ReferenceTreeItem(
          `${this.symbolInfo.name}`,
          vscode.TreeItemCollapsibleState.None,
          this.symbolInfo.location,
        );
        headerItem.description = kindLabel;
        headerItem.iconPath = this.getSymbolIcon(this.symbolInfo.kind);
        headerItem.tooltip = `Go to ${kindLabel} definition`;
        items.push(headerItem);
      }

      // Add summary
      const summary = `${this.groupedByFile.size} file${this.groupedByFile.size !== 1 ? "s" : ""}, ${this.locations.length} reference${this.locations.length !== 1 ? "s" : ""}`;
      const summaryItem = new ReferenceTreeItem(
        summary,
        vscode.TreeItemCollapsibleState.None,
      );
      summaryItem.iconPath = new vscode.ThemeIcon("info");
      items.push(summaryItem);

      // Add files
      const sortedFiles = Array.from(this.groupedByFile.keys()).sort();
      for (const filePath of sortedFiles) {
        const locs = this.groupedByFile.get(filePath)!;
        const relativePath = vscode.workspace.asRelativePath(filePath);
        const fileName = path.basename(filePath);
        const dirName = path.dirname(relativePath);

        const label = dirName === "." ? fileName : `${fileName} (${dirName})`;

        const fileItem = new ReferenceTreeItem(
          label,
          vscode.TreeItemCollapsibleState.Expanded,
          undefined,
          "file",
        );
        fileItem.tooltip = relativePath;
        fileItem.description = `${locs.length} reference${locs.length !== 1 ? "s" : ""}`;
        fileItem.resourceUri = vscode.Uri.file(filePath);

        items.push(fileItem);

        // Store locations for getChildren
        (fileItem as any).__locations = locs;
      }

      return items;
    } else {
      // File level - show references
      const locs = (element as any).__locations as vscode.Location[];
      if (!locs) {
        return [];
      }

      const items: ReferenceTreeItem[] = [];

      for (const location of locs) {
        // Read the line text
        const document = await vscode.workspace.openTextDocument(location.uri);
        const line = document.lineAt(location.range.start.line);
        const lineText = line.text.trim();

        // Detect context to get appropriate icon
        const contextKind = await this.detectReferenceContext(
          document,
          location,
        );

        const refItem = new ReferenceTreeItem(
          lineText,
          vscode.TreeItemCollapsibleState.None,
          location,
          "reference",
        );
        refItem.iconPath = this.getSymbolIcon(contextKind);

        items.push(refItem);
      }

      return items;
    }
  }

  getTitle(): string {
    return this.title;
  }

  getLocationCount(): number {
    return this.locations.length;
  }
}
