import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

interface ProtoElement {
  name: string;
  type: "message" | "enum" | "service" | "rpc";
  line: number;
  serviceName?: string; // For RPC methods
}

/**
 * CodeLens provider for Protocol Buffer files
 * Provides navigation and reference counts for proto definitions
 */
export class GoProtoCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> =
    this._onDidChangeCodeLenses.event;

  constructor() {
    // Watch for file changes to refresh CodeLens
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{proto,go}");
    watcher.onDidChange(() => this._onDidChangeCodeLenses.fire());
    watcher.onDidCreate(() => this._onDidChangeCodeLenses.fire());
    watcher.onDidDelete(() => this._onDidChangeCodeLenses.fire());
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    // Only process .proto files
    if (!document.fileName.endsWith(".proto")) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];
    const elements = this.parseProtoFile(document);

    for (const element of elements) {
      const range = new vscode.Range(element.line, 0, element.line, 0);

      switch (element.type) {
        case "message":
          codeLenses.push(
            ...(await this.createMessageLenses(document, element, range)),
          );
          break;
        case "enum":
          codeLenses.push(
            ...(await this.createEnumLenses(document, element, range)),
          );
          break;
        case "service":
          codeLenses.push(
            ...(await this.createServiceLenses(document, element, range)),
          );
          break;
        case "rpc":
          codeLenses.push(
            ...(await this.createRpcLenses(document, element, range)),
          );
          break;
      }
    }

    return codeLenses;
  }

  /**
   * Parse proto file to extract messages, enums, services, and RPC methods
   */
  private parseProtoFile(document: vscode.TextDocument): ProtoElement[] {
    const elements: ProtoElement[] = [];
    const text = document.getText();
    const lines = text.split("\n");

    let currentService: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Match message definitions: message MessageName {
      const messageMatch = line.match(/^message\s+(\w+)\s*\{/);
      if (messageMatch) {
        elements.push({
          name: messageMatch[1],
          type: "message",
          line: i,
        });
        continue;
      }

      // Match enum definitions: enum EnumName {
      const enumMatch = line.match(/^enum\s+(\w+)\s*\{/);
      if (enumMatch) {
        elements.push({
          name: enumMatch[1],
          type: "enum",
          line: i,
        });
        continue;
      }

      // Match service definitions: service ServiceName {
      const serviceMatch = line.match(/^service\s+(\w+)\s*\{/);
      if (serviceMatch) {
        currentService = serviceMatch[1];
        elements.push({
          name: serviceMatch[1],
          type: "service",
          line: i,
        });
        continue;
      }

      // Match RPC method definitions: rpc MethodName(Request) returns (Response);
      const rpcMatch = line.match(
        /^rpc\s+(\w+)\s*\(\s*\w+\s*\)\s*returns\s*\(/,
      );
      if (rpcMatch && currentService) {
        elements.push({
          name: rpcMatch[1],
          type: "rpc",
          line: i,
          serviceName: currentService,
        });
        continue;
      }

      // Reset service context when leaving service block
      if (line === "}" && currentService) {
        currentService = undefined;
      }
    }

    return elements;
  }

  /**
   * Create CodeLens for message definitions
   */
  private async createMessageLenses(
    document: vscode.TextDocument,
    element: ProtoElement,
    range: vscode.Range,
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    // Find generated Go files
    const generatedFiles = await this.findGeneratedGoFiles(document);
    if (generatedFiles.length > 0) {
      // Navigation to generated Go struct
      const goLocation = await this.findInAnyGeneratedFile(
        generatedFiles,
        `type ${element.name} struct`,
      );
      if (goLocation) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `Go struct`,
            command: "vscode.open",
            arguments: [goLocation.uri, { selection: goLocation.range }],
          }),
        );
      }
    }

    return lenses;
  }

  /**
   * Create CodeLens for enum definitions
   */
  private async createEnumLenses(
    document: vscode.TextDocument,
    element: ProtoElement,
    range: vscode.Range,
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const generatedFiles = await this.findGeneratedGoFiles(document);
    if (generatedFiles.length > 0) {
      // Navigation to generated Go enum const
      const goLocation = await this.findInAnyGeneratedFile(
        generatedFiles,
        `${element.name}_`,
      );
      if (goLocation) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `Go enum`,
            command: "vscode.open",
            arguments: [goLocation.uri, { selection: goLocation.range }],
          }),
        );
      }
    }

    return lenses;
  }

  /**
   * Create CodeLens for service definitions
   */
  private async createServiceLenses(
    document: vscode.TextDocument,
    element: ProtoElement,
    range: vscode.Range,
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const generatedFiles = await this.findGeneratedGoFiles(document);
    if (generatedFiles.length > 0) {
      // Navigation to generated gRPC interfaces
      const clientInterface = await this.findInAnyGeneratedFile(
        generatedFiles,
        `type ${element.name}Client interface`,
      );
      const serverInterface = await this.findInAnyGeneratedFile(
        generatedFiles,
        `type ${element.name}Server interface`,
      );

      if (clientInterface) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `Go client interface`,
            command: "vscode.open",
            arguments: [
              clientInterface.uri,
              { selection: clientInterface.range },
            ],
          }),
        );
      }

      if (serverInterface) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `Go server interface`,
            command: "vscode.open",
            arguments: [
              serverInterface.uri,
              { selection: serverInterface.range },
            ],
          }),
        );
      }
    }

    return lenses;
  }

  /**
   * Create CodeLens for RPC method definitions
   */
  private async createRpcLenses(
    document: vscode.TextDocument,
    element: ProtoElement,
    range: vscode.Range,
  ): Promise<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];

    const generatedFiles = await this.findGeneratedGoFiles(document);
    if (generatedFiles.length > 0 && element.serviceName) {
      // Navigation to generated interface method
      const methodLocation = await this.findInAnyGeneratedFile(
        generatedFiles,
        `${element.name}(`,
      );
      if (methodLocation) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `Go interface method`,
            command: "vscode.open",
            arguments: [
              methodLocation.uri,
              { selection: methodLocation.range },
            ],
          }),
        );
      }
    }

    return lenses;
  }

  /**
   * Find all generated .pb.go and _grpc.pb.go files for a .proto file.
   * Returns an array of file paths (may contain both variants).
   */
  private async findGeneratedGoFiles(
    protoDocument: vscode.TextDocument,
  ): Promise<string[]> {
    const protoPath = protoDocument.uri.fsPath;
    const protoDir = path.dirname(protoPath);
    const protoBasename = path.basename(protoPath, ".proto");
    const results: string[] = [];

    // Fast path: same directory
    for (const name of [
      `${protoBasename}.pb.go`,
      `${protoBasename}_grpc.pb.go`,
    ]) {
      try {
        await fs.access(path.join(protoDir, name));
        results.push(path.join(protoDir, name));
      } catch {
        // not found
      }
    }
    if (results.length > 0) return results;

    // Workspace-wide search for both variants
    for (const pattern of [
      `**/${protoBasename}.pb.go`,
      `**/${protoBasename}_grpc.pb.go`,
    ]) {
      const found = await vscode.workspace.findFiles(
        pattern,
        "**/vendor/**",
        5,
      );
      results.push(...found.map((f) => f.fsPath));
    }
    return results;
  }

  /**
   * Find a specific string in any of the provided generated Go files.
   * Returns the first location found.
   */
  private async findInAnyGeneratedFile(
    goFilePaths: string[],
    searchString: string,
  ): Promise<vscode.Location | undefined> {
    for (const p of goFilePaths) {
      const loc = await this.findInGeneratedFile(p, searchString);
      if (loc) return loc;
    }
    return undefined;
  }

  /**
   * Find the generated .pb.go file for a .proto file.
   * Checks the proto's own directory first (fast path), then searches workspace-wide
   * so that generated files in sub-directories are also found.
   */
  private async findGeneratedGoFile(
    protoDocument: vscode.TextDocument,
  ): Promise<string | undefined> {
    const protoPath = protoDocument.uri.fsPath;
    const protoDir = path.dirname(protoPath);
    const protoBasename = path.basename(protoPath, ".proto");

    // Fast path: same directory
    const fastPaths = [
      path.join(protoDir, `${protoBasename}.pb.go`),
      path.join(protoDir, `${protoBasename}_grpc.pb.go`),
    ];
    for (const filePath of fastPaths) {
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // not found
      }
    }

    // Workspace-wide search for generated pb.go files
    const pbGoFiles = await vscode.workspace.findFiles(
      `**/${protoBasename}.pb.go`,
      "**/vendor/**",
      5,
    );
    if (pbGoFiles.length > 0) {
      return pbGoFiles[0].fsPath;
    }

    const grpcGoFiles = await vscode.workspace.findFiles(
      `**/${protoBasename}_grpc.pb.go`,
      "**/vendor/**",
      5,
    );
    if (grpcGoFiles.length > 0) {
      return grpcGoFiles[0].fsPath;
    }

    return undefined;
  }

  /**
   * Find a specific string in generated Go file and return its location
   */
  private async findInGeneratedFile(
    goFilePath: string,
    searchString: string,
  ): Promise<vscode.Location | undefined> {
    try {
      const content = await fs.readFile(goFilePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(searchString)) {
          const uri = vscode.Uri.file(goFilePath);
          const range = new vscode.Range(i, 0, i, lines[i].length);
          return new vscode.Location(uri, range);
        }
      }
    } catch (error) {
      // File read error
    }

    return undefined;
  }

  /**
   * Count Go references to a proto element
   */
  private async countGoReferences(
    generatedFile: string,
    elementName: string,
  ): Promise<number> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return 0;
      }

      // Use VS Code's search API to count references
      const files = await vscode.workspace.findFiles(
        "**/*.go",
        "**/vendor/**",
        1000,
      );

      let count = 0;
      for (const file of files) {
        // Skip the generated file itself
        if (file.fsPath === generatedFile) {
          continue;
        }

        const content = await fs.readFile(file.fsPath, "utf-8");
        // Simple regex to count occurrences (not perfect, but good enough)
        const regex = new RegExp(`\\b${elementName}\\b`, "g");
        const matches = content.match(regex);
        if (matches) {
          count += matches.length;
        }
      }

      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Count gRPC server implementations
   */
  private async countServerImplementations(
    serviceName: string,
    serverInterfaceUri?: vscode.Uri,
  ): Promise<number> {
    if (!serverInterfaceUri) {
      return 0;
    }

    try {
      // Find implementations of the server interface
      const doc = await vscode.workspace.openTextDocument(serverInterfaceUri);
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", doc.uri);

      if (!symbols) {
        return 0;
      }

      // Find the server interface symbol
      const serverInterface = symbols.find(
        (s) =>
          s.kind === vscode.SymbolKind.Interface &&
          s.name === `${serviceName}Server`,
      );

      if (!serverInterface) {
        return 0;
      }

      // Use workspace symbol search to find implementations
      const implementations = await vscode.commands.executeCommand<
        vscode.Location[]
      >(
        "vscode.executeImplementationProvider",
        doc.uri,
        serverInterface.range.start,
      );

      return implementations?.length || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Count client calls to an RPC method
   */
  private async countClientCalls(
    methodName: string,
    serviceName: string,
  ): Promise<number> {
    return (await this.findClientCallLocations(methodName, serviceName)).length;
  }

  /**
   * Find Go file locations where an RPC method is called via a client stub.
   */
  private async findClientCallLocations(
    methodName: string,
    serviceName: string,
  ): Promise<vscode.Location[]> {
    const locations: vscode.Location[] = [];
    try {
      const files = await vscode.workspace.findFiles(
        "**/*.go",
        "**/vendor/**",
        1000,
      );
      for (const file of files) {
        if (
          file.fsPath.endsWith(".pb.go") ||
          file.fsPath.endsWith("_grpc.pb.go")
        ) {
          continue;
        }
        const content = await fs.readFile(file.fsPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const lineRegex = new RegExp(`\\.${methodName}\\s*\\(`, "g");
          let m: RegExpExecArray | null;
          while ((m = lineRegex.exec(lines[i])) !== null) {
            // Point to the method name (skip the leading dot)
            const col = m.index + 1;
            locations.push(
              new vscode.Location(
                file,
                new vscode.Range(i, col, i, col + methodName.length),
              ),
            );
          }
        }
      }
    } catch {
      // ignore
    }
    return locations;
  }

  /**
   * Count RPC method implementations in server structs
   */
  private async countRpcImplementations(
    methodName: string,
    serviceName: string,
  ): Promise<number> {
    return (await this.findRpcImplementationLocations(methodName, serviceName))
      .length;
  }

  /**
   * Find Go file locations where an RPC method is implemented as a server handler.
   */
  private async findRpcImplementationLocations(
    methodName: string,
    serviceName: string,
  ): Promise<vscode.Location[]> {
    const locations: vscode.Location[] = [];
    try {
      const files = await vscode.workspace.findFiles(
        "**/*.go",
        "**/vendor/**",
        1000,
      );
      const regex = new RegExp(`func\\s+\\([^)]+\\)\\s+${methodName}\\s*\\(`);
      for (const file of files) {
        if (
          file.fsPath.endsWith(".pb.go") ||
          file.fsPath.endsWith("_grpc.pb.go")
        ) {
          continue;
        }
        const content = await fs.readFile(file.fsPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const col = lines[i].indexOf(methodName);
            locations.push(
              new vscode.Location(
                file,
                new vscode.Range(i, col, i, col + methodName.length),
              ),
            );
          }
        }
      }
    } catch {
      // ignore
    }
    return locations;
  }

  /**
   * Find actual Go locations referencing a proto message struct via gopls.
   * Filters out generated pb.go files so only user code appears.
   */
  private async findMessageReferences(
    generatedFilePath: string,
    structName: string,
  ): Promise<vscode.Location[]> {
    try {
      const uri = vscode.Uri.file(generatedFilePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const lines = doc.getText().split("\n");

      let structLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`type ${structName} struct`)) {
          structLine = i;
          break;
        }
      }
      if (structLine === -1) {
        return [];
      }

      const nameOffset = lines[structLine].indexOf(structName);
      const position = new vscode.Position(structLine, nameOffset);

      const refs = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        uri,
        position,
      );

      if (!refs) {
        return [];
      }

      // Filter out generated pb.go files
      return refs.filter(
        (loc) =>
          !loc.uri.fsPath.endsWith(".pb.go") &&
          !loc.uri.fsPath.endsWith("_grpc.pb.go"),
      );
    } catch {
      return [];
    }
  }

  /**
   * Find concrete (user-written) implementations of a gRPC server interface.
   * Uses gopls executeImplementationProvider and strips generated pb.go locations.
   */
  private async findConcreteServerImplementations(
    serviceName: string,
    serverInterfaceUri: vscode.Uri,
    serverInterfacePos: vscode.Position,
  ): Promise<vscode.Location[]> {
    try {
      const impls = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeImplementationProvider",
        serverInterfaceUri,
        serverInterfacePos,
      );

      if (!impls) {
        return [];
      }

      const seen = new Set<string>();
      return impls.filter((loc) => {
        const key = `${loc.uri.toString()}:${loc.range.start.line}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return (
          !loc.uri.fsPath.endsWith(".pb.go") &&
          !loc.uri.fsPath.endsWith("_grpc.pb.go")
        );
      });
    } catch {
      return [];
    }
  }

  /**
   * Find Go files where New${serviceName}Client() is called.
   */
  private async findClientUsageLocations(
    serviceName: string,
  ): Promise<vscode.Location[]> {
    const locations: vscode.Location[] = [];
    try {
      const files = await vscode.workspace.findFiles(
        "**/*.go",
        "**/vendor/**",
        500,
      );
      const pattern = `New${serviceName}Client`;
      for (const file of files) {
        if (
          file.fsPath.endsWith(".pb.go") ||
          file.fsPath.endsWith("_grpc.pb.go")
        ) {
          continue;
        }
        const content = await fs.readFile(file.fsPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const col = lines[i].indexOf(pattern);
          if (col !== -1) {
            locations.push(
              new vscode.Location(file, new vscode.Position(i, col)),
            );
          }
        }
      }
    } catch {
      // ignore
    }
    return locations;
  }
}
