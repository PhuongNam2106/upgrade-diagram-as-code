import assert from "node:assert/strict";
import test from "node:test";

import type { DiagramConfig } from "@diagram-as-code/diagram-config";

import {
  buildDiagramReviewRows,
  buildVerificationPlan,
  deterministicRequest,
  pullRequestContextFromEvent,
  type FileChange,
  type PullRequestContext,
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

test("uses the same canonical render requests as VS Code export", () => {
  assert.deepEqual(deterministicRequest("docs/diagrams/a.mmd", "flowchart LR\nA-->B"), {
    type: "mermaid",
    format: "svg",
    source: "flowchart LR\nA-->B",
  });
  assert.deepEqual(deterministicRequest("docs/diagrams/a.puml", "@startuml\n@enduml"), {
    type: "plantuml",
    format: "svg",
    source: "@startuml\n@enduml",
  });
});

test("builds pull request visual review links for changed diagrams", () => {
  const context: PullRequestContext = {
    repository: "owner/repo",
    serverUrl: "https://github.com",
    number: 17,
    baseSha: "base123",
    headSha: "head456",
  };
  const changes: FileChange[] = [{ status: "M", path: "docs/diagrams/checkout.mmd" }];
  const plan = buildVerificationPlan(changes, ["docs/diagrams/checkout.mmd"], config, false);

  assert.deepEqual(buildDiagramReviewRows(plan, changes, context), [
    {
      status: "modified",
      source: "[docs/diagrams/checkout.mmd](https://github.com/owner/repo/blob/head456/docs/diagrams/checkout.mmd)",
      generatedSvg: "[docs/generated/checkout.svg](https://github.com/owner/repo/blob/head456/docs/generated/checkout.svg)",
      before: "[base](https://github.com/owner/repo/blob/base123/docs/generated/checkout.svg)",
      after: "[head](https://github.com/owner/repo/blob/head456/docs/generated/checkout.svg)",
      visualDiff:
        "[open](https://github.com/owner/repo/pull/17/files#diff-02b63e782bba99cda5128100e4f294f98327a40ea9e05827d4764c54cb7125c6)",
    },
  ]);
});

test("builds review links for deleted and renamed diagrams", () => {
  const context: PullRequestContext = {
    repository: "owner/repo",
    serverUrl: "https://github.example.com",
    number: 18,
    baseSha: "base123",
    headSha: "head456",
  };
  const changes: FileChange[] = [
    { status: "D", path: "docs/diagrams/old name.puml" },
    { status: "R", oldPath: "docs/diagrams/before.mmd", path: "docs/diagrams/after.mmd" },
  ];
  const plan = buildVerificationPlan(changes, ["docs/diagrams/after.mmd"], config, false);

  assert.deepEqual(buildDiagramReviewRows(plan, changes, context), [
    {
      status: "renamed",
      source: "[docs/diagrams/after.mmd](https://github.example.com/owner/repo/blob/head456/docs/diagrams/after.mmd)",
      generatedSvg: "[docs/generated/after.svg](https://github.example.com/owner/repo/blob/head456/docs/generated/after.svg)",
      before: "[base](https://github.example.com/owner/repo/blob/base123/docs/generated/before.svg)",
      after: "[head](https://github.example.com/owner/repo/blob/head456/docs/generated/after.svg)",
      visualDiff:
        "[open](https://github.example.com/owner/repo/pull/18/files#diff-46b5264ed0933aa1757b428c20d95f4faf9bfdb22f1bf79d4f48a7578ec9387e)",
    },
    {
      status: "deleted",
      source: "[docs/diagrams/old name.puml](https://github.example.com/owner/repo/blob/base123/docs/diagrams/old%20name.puml)",
      generatedSvg: "[docs/generated/old name.svg](https://github.example.com/owner/repo/blob/base123/docs/generated/old%20name.svg)",
      before: "[base](https://github.example.com/owner/repo/blob/base123/docs/generated/old%20name.svg)",
      after: "",
      visualDiff:
        "[open](https://github.example.com/owner/repo/pull/18/files#diff-f01735402b3f0a928fd5b1e71546e566974a996e84544ef8d475adfd4aeedd35)",
    },
  ]);
});

test("extracts pull request context from the GitHub event payload", () => {
  assert.deepEqual(
    pullRequestContextFromEvent(
      {
        pull_request: {
          number: 22,
          base: { sha: "base-sha" },
          head: { sha: "head-sha" },
        },
      },
      "owner/repo",
      "https://github.example.com",
    ),
    {
      repository: "owner/repo",
      serverUrl: "https://github.example.com",
      number: 22,
      baseSha: "base-sha",
      headSha: "head-sha",
    },
  );
  assert.equal(pullRequestContextFromEvent({}, "owner/repo", "https://github.com"), undefined);
});
