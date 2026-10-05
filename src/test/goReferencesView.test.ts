import * as assert from "assert";
import * as vscode from "vscode";
import { GoReferencesViewProvider } from "../goReferencesView";

suite("GoReferencesViewProvider Test Suite", () => {
  test("Instantiates and returns 'No references found' item initially", async () => {
    const provider = new GoReferencesViewProvider();
    const children = await provider.getChildren();
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, "No references found");
  });

  test("clear resets references and fires change event", (done) => {
    const provider = new GoReferencesViewProvider();
    const disposable = provider.onDidChangeTreeData(() => {
      disposable.dispose();
      done();
    });
    provider.clear();
  });

  test("refresh fires change event", (done) => {
    const provider = new GoReferencesViewProvider();
    const disposable = provider.onDidChangeTreeData(() => {
      disposable.dispose();
      done();
    });
    provider.refresh();
  });

  test("getTreeItem returns tree item with proper properties", () => {
    const provider = new GoReferencesViewProvider();
    const location = new vscode.Location(
      vscode.Uri.file("/test/file.go"),
      new vscode.Position(10, 5),
    );

    // Create a tree item using provider's internal group representation
    const item = (provider as any).getTreeItem({
      label: "MySymbol",
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      location,
      contextValue: "reference",
    });

    assert.ok(item);
    assert.strictEqual(item.label, "MySymbol");
  });
});
