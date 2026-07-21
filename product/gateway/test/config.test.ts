import assert from "node:assert/strict";
import test from "node:test";

import { loadGatewayConfig } from "../dist/config.js";

test("requires at least one API key when authentication is required", () => {
  assert.throws(
    () => loadGatewayConfig({ AUTH_MODE: "required", DIAGRAM_API_KEYS: "" }),
    /DIAGRAM_API_KEYS must contain at least one key/,
  );
});

test("allows an explicit local authentication opt-out", () => {
  const config = loadGatewayConfig({ AUTH_MODE: "disabled" });

  assert.equal(config.authMode, "disabled");
  assert.deepEqual(config.apiKeys, []);
  assert.equal(config.port, 9000);
  assert.equal(config.krokiBaseUrl, "http://kroki:8000");
});

test("parses operational limits from the environment", () => {
  const config = loadGatewayConfig({
    AUTH_MODE: "required",
    DIAGRAM_API_KEYS: " first,second , first ",
    PORT: "9100",
    MAX_SOURCE_BYTES: "2048",
    RENDER_TIMEOUT_MS: "3000",
    CACHE_MAX_ENTRIES: "10",
  });

  assert.deepEqual(config.apiKeys, ["first", "second"]);
  assert.equal(config.port, 9100);
  assert.equal(config.maxSourceBytes, 2048);
  assert.equal(config.renderTimeoutMs, 3000);
  assert.equal(config.cacheMaxEntries, 10);
});
