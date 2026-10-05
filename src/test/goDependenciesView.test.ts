import * as assert from "assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  escapeModuleValue,
  GoDependenciesViewProvider,
  longestCommonDirectory,
  ModuleDependency,
  parseConcatenatedJson,
} from "../goDependenciesView";

suite("GoDependenciesViewProvider Test Suite", () => {
  let tempDir: string;

  setup(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "go-assistant-test-deps-"),
    );
  });

  teardown(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  test("Root getChildren returns Go Modules and Go SDK sections", async () => {
    const provider = new GoDependenciesViewProvider();
    const roots = await provider.getChildren();

    assert.strictEqual(roots.length, 2);
    assert.strictEqual(roots[0].kind, "section");
    assert.strictEqual(roots[1].kind, "section");

    if (roots[0].kind === "section") {
      assert.strictEqual(roots[0].section, "modules");
      assert.strictEqual(roots[0].label, "Go Modules");
    }
    if (roots[1].kind === "section") {
      assert.strictEqual(roots[1].section, "sdk");
      assert.ok(roots[1].label.includes("SDK"));
    }
  });

  test("Search query filtering works correctly", () => {
    const provider = new GoDependenciesViewProvider();

    assert.strictEqual(provider.getSearchQuery(), "");

    provider.setSearchQuery("  UUID  ");
    assert.strictEqual(provider.getSearchQuery(), "uuid");

    provider.clearSearchQuery();
    assert.strictEqual(provider.getSearchQuery(), "");
  });

  test("readDependencyDirectness correctly parses direct and indirect dependencies", async () => {
    const provider = new GoDependenciesViewProvider();
    const goModPath = path.join(tempDir, "go.mod");

    const sampleGoMod = `module example.com/myproject

go 1.22

require (
\tgithub.com/google/uuid v1.6.0
\tgithub.com/stretchr/testify v1.9.0 // indirect
\tgolang.org/x/sync v0.6.0 // indirect; transitive dependency
)

require github.com/pkg/errors v0.9.1

require github.com/davecgh/go-spew v1.1.1 // indirect
`;

    await fs.promises.writeFile(goModPath, sampleGoMod, "utf8");

    const directness = await provider.readDependencyDirectness(goModPath);

    assert.strictEqual(directness.get("github.com/google/uuid"), true);
    assert.strictEqual(directness.get("github.com/stretchr/testify"), false);
    assert.strictEqual(directness.get("golang.org/x/sync"), false);
    assert.strictEqual(directness.get("github.com/pkg/errors"), true);
    assert.strictEqual(directness.get("github.com/davecgh/go-spew"), false);
  });

  test("CRITICAL: Viewing external dependencies MUST NOT modify go.sum", async () => {
    const provider = new GoDependenciesViewProvider();

    // Create a realistic Go module with a go.sum
    const goModPath = path.join(tempDir, "go.mod");
    const goSumPath = path.join(tempDir, "go.sum");

    const goModContent = `module testproject

go 1.22

require github.com/google/uuid v1.6.0
`;

    // Only /go.mod hash exists in go.sum (which previously triggered go list -mod=mod to add the full hash)
    const initialGoSumContent =
      "github.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=\n";

    await fs.promises.writeFile(goModPath, goModContent, "utf8");
    await fs.promises.writeFile(goSumPath, initialGoSumContent, "utf8");

    const initialSumHash = crypto
      .createHash("sha256")
      .update(initialGoSumContent)
      .digest("hex");

    // Stub workspace folder to tempDir
    const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      value: [{ uri: vscode.Uri.file(tempDir), name: "test", index: 0 }],
      configurable: true,
    });

    try {
      // 1. Fetch root sections
      const rootSections = await provider.getChildren();
      assert.strictEqual(rootSections.length, 2);

      // 2. Fetch children of "Go Modules" section
      const modulesSection = rootSections[0];
      const moduleChildren = await provider.getChildren(modulesSection);
      assert.ok(Array.isArray(moduleChildren));

      // 3. If dependency nodes were loaded, expand dependency to test package resolution
      const depNode = moduleChildren.find(
        (node) => node.kind === "dependency",
      );
      if (depNode && depNode.kind === "dependency") {
        await provider.getChildren(depNode);
      }

      // Check go.sum on disk
      const currentGoSumContent = await fs.promises.readFile(
        goSumPath,
        "utf8",
      );
      const currentSumHash = crypto
        .createHash("sha256")
        .update(currentGoSumContent)
        .digest("hex");

      assert.strictEqual(
        currentSumHash,
        initialSumHash,
        `go.sum was modified! Original:\n${initialGoSumContent}\nCurrent:\n${currentGoSumContent}`,
      );
      assert.strictEqual(currentGoSumContent, initialGoSumContent);
    } finally {
      Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: originalWorkspaceFolders,
        configurable: true,
      });
    }
  });

  test("getTreeItem produces expected TreeItem for each node kind", () => {
    const provider = new GoDependenciesViewProvider();

    // Section item
    const sectionItem = provider.getTreeItem({
      kind: "section",
      section: "modules",
      label: "Go Modules",
    });
    assert.strictEqual(sectionItem.label, "Go Modules");
    assert.strictEqual(
      sectionItem.collapsibleState,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    assert.strictEqual(sectionItem.contextValue, "dependencyModulesSection");

    // Info item
    const infoItem = provider.getTreeItem({
      kind: "info",
      label: "No dependencies found",
    });
    assert.strictEqual(infoItem.label, "No dependencies found");
    assert.strictEqual(
      infoItem.collapsibleState,
      vscode.TreeItemCollapsibleState.None,
    );
    assert.strictEqual(infoItem.contextValue, "dependencyInfo");

    // Dependency item (direct)
    const directDep: ModuleDependency = {
      modulePath: "github.com/google/uuid",
      version: "v1.6.0",
      direct: true,
      packages: [],
    };
    const directItem = provider.getTreeItem({
      kind: "dependency",
      dependency: directDep,
    });
    assert.strictEqual(directItem.label, "github.com/google/uuid");
    assert.strictEqual(directItem.description, "v1.6.0 · direct");
    assert.strictEqual(directItem.contextValue, "dependency");

    // Dependency item (indirect with replacement)
    const indirectDep: ModuleDependency = {
      modulePath: "github.com/old/repo",
      version: "v1.0.0",
      replacedBy: "github.com/new/repo@v1.1.0",
      direct: false,
      packages: [],
    };
    const indirectItem = provider.getTreeItem({
      kind: "dependency",
      dependency: indirectDep,
    });
    assert.strictEqual(
      indirectItem.description,
      "v1.0.0 → github.com/new/repo@v1.1.0 · indirect",
    );

    // Folder item
    const folderItem = provider.getTreeItem({
      kind: "folder",
      folderPath: "/path/to/myfolder",
      rootPath: "/path/to",
    });
    assert.strictEqual(folderItem.label, "myfolder");
    assert.strictEqual(folderItem.contextValue, "dependencyFolder");
    assert.strictEqual(
      folderItem.collapsibleState,
      vscode.TreeItemCollapsibleState.Collapsed,
    );

    // File item
    const fileItem = provider.getTreeItem({
      kind: "file",
      filePath: "/path/to/myfolder/file.go",
    });
    assert.strictEqual(fileItem.label, "file.go");
    assert.strictEqual(fileItem.contextValue, "dependencyFile");
    assert.strictEqual(
      fileItem.collapsibleState,
      vscode.TreeItemCollapsibleState.None,
    );
    assert.strictEqual(
      fileItem.command?.command,
      "go-assistant.openDependencyFile",
    );
    assert.deepStrictEqual(fileItem.command?.arguments, [
      "/path/to/myfolder/file.go",
    ]);
  });

  test("parseConcatenatedJson parses multiple concatenated JSON objects", () => {
    const rawJson = `{"Path": "modA", "Version": "v1.0.0"}{"Path": "modB", "Version": "v2.0.0"}`;
    const parsed = parseConcatenatedJson<{ Path: string; Version: string }>(
      rawJson,
    );

    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].Path, "modA");
    assert.strictEqual(parsed[0].Version, "v1.0.0");
    assert.strictEqual(parsed[1].Path, "modB");
    assert.strictEqual(parsed[1].Version, "v2.0.0");
  });

  test("longestCommonDirectory finds longest shared directory path", () => {
    const common = longestCommonDirectory(
      "/home/user/go/pkg/mod/github.com/foo/bar@v1.0.0/sub1",
      "/home/user/go/pkg/mod/github.com/foo/bar@v1.0.0/sub2/file",
    );

    assert.strictEqual(
      common,
      "/home/user/go/pkg/mod/github.com/foo/bar@v1.0.0",
    );
  });

  test("escapeModuleValue escapes uppercase letters with exclamation mark", () => {
    assert.strictEqual(
      escapeModuleValue("github.com/Azure/azure-sdk-for-go"),
      "github.com/!azure/azure-sdk-for-go",
    );
    assert.strictEqual(escapeModuleValue("standard"), "standard");
  });

  test("refresh resets loading state and fires event", (done) => {
    const provider = new GoDependenciesViewProvider();
    const disposable = provider.onDidChangeTreeData(() => {
      disposable.dispose();
      done();
    });
    provider.refresh();
  });
});
