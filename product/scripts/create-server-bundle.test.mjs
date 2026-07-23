import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import AdmZip from "adm-zip";
import { createServerBundle } from "./create-server-bundle.mjs";

const productRoot = path.resolve(import.meta.dirname, "..");

test("creates a self-contained versioned Windows server ZIP", async () => {
  const releaseDirectory = await mkdtemp(
    path.join(os.tmpdir(), "diagram-server-release-"),
  );
  try {
    const result = await createServerBundle({
      productRoot,
      releaseDirectory,
      version: "9.8.7",
      dockerImage: "ghcr.io/example/diagram-as-code-gateway:product-v9.8.7",
      rendererLock: { kroki: "0.31.1", mermaid: "0.31.1" },
    });

    assert.equal(result.fileName, "diagram-as-code-server-9.8.7.zip");
    const zip = new AdmZip(result.outputPath);
    assert.deepEqual(
      zip
        .getEntries()
        .map((entry) => entry.entryName)
        .sort(),
      [
        "DiagramServer.psm1",
        "LICENSE",
        "README.md",
        "SHA256SUMS",
        "diagram-server.ps1",
        "docker-compose.yml",
        "server-manifest.json",
      ],
    );

    const manifest = JSON.parse(zip.readAsText("server-manifest.json"));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.productVersion, "9.8.7");
    assert.equal(manifest.gatewayUrl, "http://localhost:9000");
    assert.equal(
      manifest.images.gateway,
      "ghcr.io/example/diagram-as-code-gateway:product-v9.8.7",
    );
    assert.equal(manifest.images.kroki, "yuzutech/kroki:0.31.1");
    assert.equal(manifest.images.mermaid, "yuzutech/kroki-mermaid:0.31.1");

    for (const line of zip.readAsText("SHA256SUMS").trim().split("\n")) {
      const [expected, name] = line.split(/\s+/, 2);
      const content = zip.readFile(name);
      assert.ok(content, `missing checksummed entry: ${name}`);
      assert.equal(
        createHash("sha256").update(content).digest("hex"),
        expected,
      );
    }
    assert.equal((await readFile(result.outputPath)).length > 0, true);
  } finally {
    await rm(releaseDirectory, { recursive: true, force: true });
  }
});

test("release orchestration creates the server ZIP before describing artifacts", async () => {
  const source = await readFile(
    path.join(productRoot, "scripts", "prepare-release.mjs"),
    "utf8",
  );
  const importIndex = source.indexOf(
    'import { createServerBundle } from "./create-server-bundle.mjs";',
  );
  const bundleIndex = source.indexOf("await createServerBundle({");
  const artifactScanIndex = source.indexOf(
    "const artifactNames = (await readdir(releaseDirectory)).sort();",
  );

  assert.notEqual(importIndex, -1);
  assert.notEqual(bundleIndex, -1);
  assert.notEqual(artifactScanIndex, -1);
  assert.equal(bundleIndex < artifactScanIndex, true);
});
