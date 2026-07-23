import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const changelog = readFileSync(
  new URL("../CHANGELOG.md", import.meta.url),
  "utf8",
);

test("Marketplace README documents installation and the complete user flow", () => {
  for (const heading of [
    "## Install",
    "## Connect to the Gateway",
    "## Preview and export",
    "## Project configuration",
    "## Upgrade from the test VSIX",
    "## Data and privacy",
  ]) {
    assert.match(readme, new RegExp(`^${heading}$`, "m"));
  }

  assert.match(readme, /Diagram: Set Gateway API Key/);
  assert.match(readme, /Saving never writes an SVG/);
  assert.match(readme, /http:\/\/localhost:9000/);
  assert.match(readme, /diagram-as-code\.diagram-as-code-vscode/);
  assert.match(readme, /enter the Gateway API key again/i);
  assert.doesNotMatch(readme, /file:\/\//);
  assert.doesNotMatch(readme, /!\[[^\]]*\]\([^)]*\.svg\)/i);
});

test("changelog contains the 0.2.1 Marketplace patch release", () => {
  assert.match(changelog, /^## 0\.2\.1$/m);
  assert.match(changelog, /Visual Studio Marketplace/);
  assert.match(changelog, /phuongnam\.diagram-as-code-vscode/);
});
