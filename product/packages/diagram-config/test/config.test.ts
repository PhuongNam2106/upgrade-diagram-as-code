import assert from "node:assert/strict";
import test from "node:test";

import { parseDiagramConfig } from "../src/index.ts";

test("applies the MVP defaults to a minimal project config", () => {
  const config = parseDiagramConfig(`
version: 1
server:
  url: http://localhost:9000
`);

  assert.deepEqual(config.sources.include, [
    "**/*.mmd",
    "**/*.puml",
    "**/*.dot",
    "**/*.d2",
  ]);
  assert.equal(config.sources.directory, "docs/diagrams");
  assert.equal(config.output.directory, "docs/generated");
  assert.equal(config.output.format, "svg");
  assert.equal(config.preview.debounceMs, 600);
  assert.equal(config.render.onSave, "changed");
  assert.equal(config.render.exportOnSave, false);
});

test("rejects non-SVG canonical output in the MVP", () => {
  assert.throws(
    () =>
      parseDiagramConfig(`
version: 1
server:
  url: http://localhost:9000
output:
  format: png
`),
    /Invalid diagram configuration/,
  );
});

test("rejects unsupported configuration versions", () => {
  assert.throws(
    () =>
      parseDiagramConfig(`
version: 2
server:
  url: http://localhost:9000
`),
    /Invalid diagram configuration/,
  );
});
