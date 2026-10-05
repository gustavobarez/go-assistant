import * as assert from "assert";
import * as vscode from "vscode";

suite("Go Assistant Extension Integration Suite", () => {
  test("Extension activates successfully and is present", async () => {
    const ext = vscode.extensions.getExtension("gustavobarez.go-assistant");
    assert.ok(ext, "Extension should be found in extensions list");

    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true, "Extension should be active");
  });

  test("All essential commands are registered in VS Code", async () => {
    const commands = await vscode.commands.getCommands(true);

    const expectedCommands = [
      "go-assistant.showReferences",
      "go-assistant.showImplementations",
      "go-assistant.showImplementers",
      "go-assistant.clearReferencesView",
      "go-assistant.refreshReferencesView",
      "go-assistant.discoverTests",
      "go-assistant.rerunLastTests",
      "go-assistant.clearTestHistory",
      "go-assistant.resetTests",
      "go-assistant.runAllTests",
      "go-assistant.debugAllTests",
      "go-assistant.runMain",
      "go-assistant.debugMain",
      "go-assistant.refreshDependenciesView",
      "go-assistant.searchDependencies",
      "go-assistant.openDependencyFile",
      "go-assistant.goModWhyDependency",
      "go-assistant.goModUpdateDependency",
      "go-assistant.clearCoverage",
    ];

    for (const cmd of expectedCommands) {
      assert.ok(
        commands.includes(cmd),
        `Expected command ${cmd} to be registered`,
      );
    }
  });

  test("Happy case: refreshDependenciesView executes without error", async () => {
    await vscode.commands.executeCommand(
      "go-assistant.refreshDependenciesView",
    );
  });

  test("Happy case: clearCoverage executes without error", async () => {
    await vscode.commands.executeCommand("go-assistant.clearCoverage");
  });

  test("Happy case: clearReferencesView executes without error", async () => {
    await vscode.commands.executeCommand("go-assistant.clearReferencesView");
  });

  test("Happy case: clearTestHistory executes without error", async () => {
    await vscode.commands.executeCommand("go-assistant.clearTestHistory");
  });

  test("Happy case: resetTests executes without error", async () => {
    await vscode.commands.executeCommand("go-assistant.resetTests");
  });
});
