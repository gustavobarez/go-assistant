import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Find go.mod file by searching upward from the given directory
 */
export async function findGoMod(
  startPath: string,
): Promise<string | undefined> {
  let currentPath = startPath;
  const root = path.parse(currentPath).root;

  while (currentPath !== root) {
    const goModPath = path.join(currentPath, "go.mod");

    try {
      await fs.promises.access(goModPath, fs.constants.F_OK);
      return goModPath;
    } catch {
      // File doesn't exist, continue searching
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  return undefined;
}

/**
 * Find all go.mod files in workspace by searching recursively
 */
export async function findAllGoModsInWorkspace(): Promise<string[]> {
  const goMods: string[] = [];

  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      const found = await findGoModsRecursively(folder.uri.fsPath);
      goMods.push(...found);
    }
  }

  return goMods;
}

/**
 * Recursively search for go.mod files in a directory
 */
async function findGoModsRecursively(
  dirPath: string,
  maxDepth: number = 10,
  currentDepth: number = 0,
): Promise<string[]> {
  if (currentDepth >= maxDepth) {
    return [];
  }

  const goMods: string[] = [];

  try {
    const goModPath = path.join(dirPath, "go.mod");
    try {
      await fs.promises.access(goModPath, fs.constants.F_OK);
      goMods.push(goModPath);
      // If we found go.mod, don't search deeper in this tree
      return goMods;
    } catch {
      // go.mod not found, continue searching
    }

    // Search subdirectories
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules" &&
        entry.name !== "vendor"
      ) {
        const subDirPath = path.join(dirPath, entry.name);
        const found = await findGoModsRecursively(
          subDirPath,
          maxDepth,
          currentDepth + 1,
        );
        goMods.push(...found);
      }
    }
  } catch (error) {
    // Ignore errors (permission denied, etc.)
  }

  return goMods;
}

/**
 * Find go.mod for the current workspace or file
 * First tries to search upward from active file, then searches entire workspace
 */
export async function findGoModForWorkspace(): Promise<string | undefined> {
  // Try active file's directory first (most specific)
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document.languageId === "go") {
    const fileDir = path.dirname(activeEditor.document.uri.fsPath);
    const goMod = await findGoMod(fileDir);
    if (goMod) {
      return goMod;
    }
  }

  // Try workspace folders
  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      const goMod = await findGoMod(folder.uri.fsPath);
      if (goMod) {
        return goMod;
      }
    }
  }

  // Last resort: search recursively in workspace
  const allGoMods = await findAllGoModsInWorkspace();
  if (allGoMods.length > 0) {
    return allGoMods[0]; // Return the first one found
  }

  return undefined;
}

/**
 * Get the Go module root directory for a specific file
 */
export async function getGoModuleRoot(
  filePath: string,
): Promise<string | undefined> {
  // First try searching upward from the file
  const goModPath = await findGoMod(path.dirname(filePath));
  if (goModPath) {
    return path.dirname(goModPath);
  }

  // If not found upward, search in workspace
  if (vscode.workspace.workspaceFolders) {
    const allGoMods = await findAllGoModsInWorkspace();

    // Find the go.mod that is closest to the file
    let closestGoMod: string | undefined;
    let closestDistance = Infinity;

    for (const goMod of allGoMods) {
      const goModDir = path.dirname(goMod);
      const relativePath = path.relative(goModDir, filePath);

      // Check if file is inside this module
      if (!relativePath.startsWith("..")) {
        const distance = relativePath.split(path.sep).length;
        if (distance < closestDistance) {
          closestDistance = distance;
          closestGoMod = goMod;
        }
      }
    }

    if (closestGoMod) {
      return path.dirname(closestGoMod);
    }
  }

  return undefined;
}
