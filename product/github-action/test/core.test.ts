import assert from "node:assert/strict";
import test from "node:test";

import type { DiagramConfig } from "@diagram-as-code/diagram-config";

import {
  buildVerificationPlan,
  deterministicRequest,
  type FileChange,
} from "../src/core.ts";

const config: DiagramConfig = {
  version: 1,
  server: { url: "http://localhost:9000", apiKeyEnv: "DIAGRAM_API_KEY" },
  sources: {
    directory: "docs/diagrams",
    include: ["**/*.mmd", "**/*.puml", "**/*.dot", "**/*.d2"],
  },
  output: { directory: "docs/generated", format: "svg" },
  preview: { debounceMs: 600 },
  render: { onSave: "changed", exportOnSave: false },
};

test("plans only changed supported diagrams in normal PRs", () => {
  const changes: FileChange[] = [
    { status: "M", path: "docs/diagrams/checkout.mmd" },
    { status: "M", path: "src/app.ts" },
  ];

  assert.deepEqual(buildVerificationPlan(changes, [], config, false), [
    {
      sourcePath: "docs/diagrams/checkout.mmd",
      outputPath: "docs/generated/checkout.svg",
      operation: "verify",
    },
  ]);
});

test("checks all sources when configuration changes", () => {
  const changes: FileChange[] = [{ status: "M", path: ".diagramrc.yml" }];
  const allSources = ["docs/diagrams/z.d2", "docs/diagrams/a.puml"];

  assert.deepEqual(buildVerificationPlan(changes, allSources, config, true), [
    { sourcePath: "docs/diagrams/a.puml", outputPath: "docs/generated/a.svg", operation: "verify" },
    { sourcePath: "docs/diagrams/z.d2", outputPath: "docs/generated/z.svg", operation: "verify" },
  ]);
});

test("requires the old generated SVG to be removed with a deleted source", () => {
  const changes: FileChange[] = [{ status: "D", path: "docs/diagrams/old.dot" }];

  assert.deepEqual(buildVerificationPlan(changes, [], config, false), [
    { sourcePath: "docs/diagrams/old.dot", outputPath: "docs/generated/old.svg", operation: "remove" },
  ]);
});

test("verifies the source when a generated SVG is changed directly", () => {
  const changes: FileChange[] = [{ status: "M", path: "docs/generated/checkout.svg" }];

  assert.deepEqual(
    buildVerificationPlan(changes, ["docs/diagrams/checkout.mmd"], config, false),
    [{ sourcePath: "docs/diagrams/checkout.mmd", outputPath: "docs/generated/checkout.svg", operation: "verify" }],
  );
});

test("applies stable renderer options by diagram type", () => {
  assert.deepEqual(deterministicRequest("docs/diagrams/a.mmd", "flowchart LR\nA-->B"), {
    type: "mermaid",
    format: "svg",
    source: "flowchart LR\nA-->B",
    options: { "deterministic-ids": true, "deterministic-id-seed": "docs/diagrams/a.mmd" },
  });
  assert.deepEqual(deterministicRequest("docs/diagrams/a.puml", "@startuml\n@enduml"), {
    type: "plantuml",
    format: "svg",
    source: "@startuml\n@enduml",
    options: { "no-metadata": true },
  });
});
