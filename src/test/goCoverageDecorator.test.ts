import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GoCoverageDecorator } from "../goCoverageDecorator";

suite("GoCoverageDecorator Test Suite", () => {
  let tempDir: string;
  let decorator: GoCoverageDecorator;

  setup(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "go-assistant-test-coverage-"),
    );
    decorator = new GoCoverageDecorator();
  });

  teardown(async () => {
    decorator.dispose();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("Instantiates decorator successfully", () => {
    assert.ok(decorator);
    assert.strictEqual(decorator.getLastLoadedFilePath(), undefined);
  });

  test("loadCoverageFromFile successfully parses coverage data", async () => {
    const coverageFilePath = path.join(tempDir, "coverage.out");
    const coverageContent = `mode: set
example.com/project/main.go:10.1,12.2 1 1
example.com/project/main.go:14.1,16.2 1 0
example.com/project/utils.go:5.1,8.10 2 5
`;
    await fs.promises.writeFile(coverageFilePath, coverageContent, "utf8");

    const success = await decorator.loadCoverageFromFile(coverageFilePath);
    assert.strictEqual(success, true);
    assert.strictEqual(decorator.getLastLoadedFilePath(), coverageFilePath);
  });

  test("loadCoverageFromFile returns false for non-existent file", async () => {
    const nonExistent = path.join(tempDir, "does-not-exist.out");
    const success = await decorator.loadCoverageFromFile(nonExistent);
    assert.strictEqual(success, false);
  });

  test("clearDecorations and dispose execute without error", () => {
    decorator.clearDecorations();
    decorator.dispose();
  });
});
