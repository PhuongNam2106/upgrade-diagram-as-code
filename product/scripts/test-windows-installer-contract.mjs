import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import YAML from "yaml";

const composePath = path.join(
  process.cwd(),
  "deploy",
  "docker-compose.release.yml",
);
const compose = YAML.parse(await readFile(composePath, "utf8"));

assert.deepEqual(compose.services.gateway.ports, [
  "127.0.0.1:${GATEWAY_PORT:-9000}:9000",
]);
assert.equal(compose.services.gateway.restart, "unless-stopped");
assert.equal(compose.services.kroki.restart, "unless-stopped");
assert.equal(compose.services.mermaid.restart, "unless-stopped");
assert.equal(compose.services.kroki.ports, undefined);
assert.equal(compose.services.mermaid.ports, undefined);

console.log("Windows installer Compose contract is valid.");
