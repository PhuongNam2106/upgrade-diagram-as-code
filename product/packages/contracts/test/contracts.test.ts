import assert from "node:assert/strict";
import test from "node:test";

import {
  createRenderRequest,
  DEFAULT_RENDER_FORMAT,
  detectDiagramType,
  isDiagramType,
  outputContentType,
} from "../src/index.ts";

test("maps supported source extensions to Kroki diagram types", () => {
  assert.equal(detectDiagramType("payment-flow.mmd"), "mermaid");
  assert.equal(detectDiagramType("architecture.puml"), "plantuml");
  assert.equal(detectDiagramType("dependencies.dot"), "graphviz");
  assert.equal(detectDiagramType("system.d2"), "d2");
  assert.equal(detectDiagramType("README.md"), undefined);
});

test("recognizes only MVP diagram types", () => {
  assert.equal(isDiagramType("mermaid"), true);
  assert.equal(isDiagramType("plantuml"), true);
  assert.equal(isDiagramType("graphviz"), true);
  assert.equal(isDiagramType("d2"), true);
  assert.equal(isDiagramType("bpmn"), false);
});

test("uses SVG as the canonical MVP output", () => {
  assert.equal(DEFAULT_RENDER_FORMAT, "svg");
  assert.equal(outputContentType("svg"), "image/svg+xml");
});

test("creates one canonical request for interactive export and CI verification", () => {
  assert.deepEqual(createRenderRequest("docs/diagrams/architecture.puml", "@startuml\n@enduml"), {
    type: "plantuml",
    format: "svg",
    source: "@startuml\n@enduml",
  });
  assert.throws(() => createRenderRequest("README.md", "text"), /Unsupported diagram source/);
});
