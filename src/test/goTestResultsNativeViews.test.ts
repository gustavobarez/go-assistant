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

  test("getHtmlForWebview includes CSP meta tag, nonce, and script", () => {
    const state = createResultsState();
    const extensionUri = vscode.Uri.file("/dummy/extension");
    const provider = new GoTestResultsLogProvider(extensionUri, state);

    const mockWebview: any = {
      cspSource: "vscode-webview-test:",
    };

    const html = provider.getHtmlForWebview(mockWebview);
    assert.ok(html.includes("Content-Security-Policy"), "Should have CSP meta tag");
    assert.ok(html.includes("nonce-"), "Should have script nonce");
    assert.ok(html.includes("vscode-webview-test:"), "Should include webview.cspSource in CSP");
    assert.ok(html.includes("<script nonce="), "Script should use the nonce");
    assert.ok(html.includes("acquireVsCodeApi()"), "Should acquire VS Code API");
  });

  test("getHtmlForWebview embeds current payload directly into HTML", () => {
    const state = createResultsState();
    const extensionUri = vscode.Uri.file("/dummy/extension");
    const provider = new GoTestResultsLogProvider(extensionUri, state);

    state.set({
      key: "pkg::TestRenderDirect",
      source: "current",
      testName: "TestRenderDirect",
      packagePath: "example.com/direct",
      filePath: "/path/to/direct_test.go",
      status: "pass",
      duration: 0.42,
      coverage: 92.5,
      output: "=== RUN   TestRenderDirect\n--- PASS: TestRenderDirect (0.42s)\nPASS\n",
    });

    const html = provider.getHtmlForWebview();
    assert.ok(html.includes("TestRenderDirect"), "HTML should contain the test name in initial payload");
    assert.ok(html.includes("example.com/direct"), "HTML should contain the package path in initial payload");
    assert.ok(html.includes("renderLog(initialPayload)"), "HTML should call renderLog on initial mount");
  });

  test("resolveWebviewView sets webview options and handles messages", () => {
    const state = createResultsState();
    const extensionUri = vscode.Uri.file("/dummy/extension");
    const provider = new GoTestResultsLogProvider(extensionUri, state);

    let messageListener: ((msg: any) => void) | undefined;
    const postedMessages: any[] = [];

    const mockWebview: any = {
      options: {},
      html: "",
      cspSource: "vscode-resource:",
      onDidReceiveMessage: (cb: (msg: any) => void) => {
        messageListener = cb;
        return { dispose: () => {} };
      },
      postMessage: async (msg: any) => {
        postedMessages.push(msg);
        return true;
      },
    };

    const mockWebviewView: any = {
      webview: mockWebview,
      show: () => {},
    };

    provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    assert.strictEqual(mockWebview.options.enableScripts, true);
    assert.ok(mockWebview.html.includes("Content-Security-Policy"));

    // Simulate 'ready' message from webview script
    assert.ok(messageListener, "Message listener should have been registered");
    messageListener?.({ type: "ready" });

    // Should have posted message back
    assert.ok(postedMessages.some((m) => m.type === "setLog"));

    // Setting state should trigger updateView / postMessage
    state.set({
      key: "pkg::TestDynamic",
      source: "current",
      testName: "TestDynamic",
      packagePath: "pkg",
      filePath: "dyn_test.go",
      status: "pass",
      duration: 0.1,
      coverage: 100,
      output: "=== RUN TestDynamic\n--- PASS: TestDynamic\n",
    });

    assert.ok(
      postedMessages.some(
        (m) => m.type === "setLog" && m.payload?.testName === "TestDynamic",
      ),
    );

    // Simulate 'clear' message
    messageListener?.({ type: "clear" });
    assert.strictEqual(state.get(), undefined);
  });
});
