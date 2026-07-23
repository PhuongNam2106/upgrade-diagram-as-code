import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  files?: string[];
  scripts?: Record<string, string>;
};

test("Marketplace package uses an explicit production allowlist", () => {
  assert.deepEqual(manifest.files, [
    "dist/extension.cjs",
    "resources/icon.png",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
  ]);
  assert.equal(
    manifest.scripts?.["package:check"],
    "vsce ls --tree && vsce package --no-dependencies --out dist/diagram-as-code-vscode.vsix",
  );
});
