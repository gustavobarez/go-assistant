import * as assert from "assert";
import * as vscode from "vscode";
import {
  createResultsState,
  GoTestResultsLogProvider,
  ResultLeafPayload,
} from "../goTestResultsNativeViews";

suite("GoTestResultsLogProvider Test Suite", () => {
  test("createResultsState manages selection state and events", (done) => {
    const state = createResultsState();
    assert.strictEqual(state.get(), undefined);

    const samplePayload: ResultLeafPayload = {
      key: "pkg::TestSample",
      source: "current",
      testName: "TestSample",
      packagePath: "example.com/pkg",
      filePath: "/path/to/sample_test.go",
      status: "pass",
      duration: 0.12,
      coverage: 85.0,
      output: "=== RUN   TestSample\n--- PASS: TestSample (0.12s)\nPASS\n",
    };

    const disposable = state.onDidChange(() => {
      disposable.dispose();
      assert.strictEqual(state.get(), samplePayload);
      assert.strictEqual(state.get()?.testName, "TestSample");
      done();
    });

    state.set(samplePayload);
  });

  test("Instantiates GoTestResultsLogProvider with extensionUri and selectionState", () => {
    const state = createResultsState();
    const extensionUri = vscode.Uri.file("/dummy/extension");
    const provider = new GoTestResultsLogProvider(extensionUri, state);

    assert.ok(provider);
    assert.strictEqual(provider.getCurrentPayload(), undefined);

    state.set({
      key: "pkg::TestFoo",
      source: "current",
      testName: "TestFoo",
      packagePath: "pkg",
      filePath: "foo_test.go",
      status: "fail",
      duration: 0.05,
      coverage: null,
      output: "=== RUN TestFoo\n--- FAIL: TestFoo (0.05s)\n",
    });

    assert.strictEqual(provider.getCurrentPayload()?.testName, "TestFoo");
  });
});
