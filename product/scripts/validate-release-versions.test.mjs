import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseVersions } from "./validate-release-versions.mjs";

test("returns the shared version when workspace and internal dependencies match", () => {
  const manifests = [
    { name: "root", version: "0.2.0" },
    { name: "contracts", version: "0.2.0" },
    {
      name: "gateway",
      version: "0.2.0",
      dependencies: { "@diagram-as-code/contracts": "0.2.0" },
    },
  ];

  assert.equal(validateReleaseVersions(manifests), "0.2.0");
});

test("rejects a stale internal dependency", () => {
  const manifests = [
    { name: "root", version: "0.2.0" },
    {
      name: "extension",
      version: "0.2.0",
      dependencies: { "@diagram-as-code/contracts": "0.1.0" },
    },
  ];

  assert.throws(
    () => validateReleaseVersions(manifests),
    /extension depends on @diagram-as-code\/contracts@0\.1\.0; expected 0\.2\.0/,
  );
});
