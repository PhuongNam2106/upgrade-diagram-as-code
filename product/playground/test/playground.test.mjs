import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

test("ships the playground source files expected by the gateway", async () => {
  assert.equal(existsSync(path.join(root, "src", "index.html")), true);
  assert.equal(existsSync(path.join(root, "src", "app.js")), true);
  assert.equal(existsSync(path.join(root, "src", "styles.css")), true);
});

test("builds static playground assets", async () => {
  await rm(dist, { recursive: true, force: true });
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = await readFile(path.join(dist, "index.html"), "utf8");
  const app = await readFile(path.join(dist, "app.js"), "utf8");
  const styles = await readFile(path.join(dist, "styles.css"), "utf8");

  assert.match(html, /Diagram as Code Playground/);
  assert.match(html, /\/playground\/app\.js/);
  assert.match(html, /\/playground\/styles\.css/);
  assert.match(app, /\/v1\/render/);
  assert.match(styles, /preview-shell/);
});
