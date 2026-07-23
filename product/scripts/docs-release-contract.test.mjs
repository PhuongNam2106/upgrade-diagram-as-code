import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

test("release documentation covers Windows and Marketplace delivery", async () => {
  const releaseGuide = await readFile(
    path.join(repositoryRoot, "product", "docs", "release-guide.md"),
    "utf8",
  );
  const productReadme = await readFile(
    path.join(repositoryRoot, "product", "README.md"),
    "utf8",
  );
  const techDoc = await readFile(
    path.join(repositoryRoot, "Tech_Doc.md"),
    "utf8",
  );

  for (const marker of [
    "diagram-as-code-server-0.2.0.zip",
    "product-v0.2.0",
    "phuongnam",
    "SHA256SUMS",
    "GHCR",
  ]) {
    assert.match(releaseGuide, new RegExp(marker, "i"));
  }

  assert.match(productReadme, /Windows Server/i);
  assert.match(productReadme, /Visual Studio Marketplace/i);
  assert.match(techDoc, /Docker Desktop/i);
  assert.match(techDoc, /GHCR/i);
});
