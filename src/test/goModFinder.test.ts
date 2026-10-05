import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  findAllGoModsInWorkspace,
  findGoMod,
  getGoModuleRoot,
} from "../goModFinder";

suite("GoModFinder Test Suite", () => {
  let tempDir: string;

  setup(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "go-assistant-test-modfinder-"),
    );
  });

  teardown(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("findGoMod finds go.mod in current directory", async () => {
    const goModPath = path.join(tempDir, "go.mod");
    await fs.promises.writeFile(goModPath, "module example.com/test\n\ngo 1.22\n");

    const found = await findGoMod(tempDir);
    assert.strictEqual(found, goModPath);
  });

  test("findGoMod searches upward to find go.mod in parent directory", async () => {
    const goModPath = path.join(tempDir, "go.mod");
    await fs.promises.writeFile(goModPath, "module example.com/test\n\ngo 1.22\n");

    const subDir = path.join(tempDir, "pkg", "subpkg", "internal");
    await fs.promises.mkdir(subDir, { recursive: true });

    const found = await findGoMod(subDir);
    assert.strictEqual(found, goModPath);
  });

  test("findGoMod returns undefined when no go.mod exists", async () => {
    const emptySubDir = path.join(tempDir, "empty", "nested");
    await fs.promises.mkdir(emptySubDir, { recursive: true });

    const found = await findGoMod(emptySubDir);
    assert.strictEqual(found, undefined);
  });

  test("getGoModuleRoot returns directory containing go.mod", async () => {
    const goModPath = path.join(tempDir, "go.mod");
    await fs.promises.writeFile(goModPath, "module example.com/test\n\ngo 1.22\n");

    const goFile = path.join(tempDir, "services", "handler.go");
    await fs.promises.mkdir(path.dirname(goFile), { recursive: true });
    await fs.promises.writeFile(goFile, "package services\n");

    const root = await getGoModuleRoot(goFile);
    assert.strictEqual(root, tempDir);
  });

  test("findAllGoModsInWorkspace returns an array", async () => {
    const found = await findAllGoModsInWorkspace();
    assert.ok(Array.isArray(found));
  });
});
