import assert from "node:assert/strict";
import test from "node:test";

import { createGateway } from "../dist/app.js";
import type { GatewayConfig } from "../dist/config.js";
import { RendererFailure, type RendererClient } from "../dist/renderer.js";

const config: GatewayConfig = {
  authMode: "required",
  apiKeys: ["secret"],
  port: 9000,
  host: "0.0.0.0",
  krokiBaseUrl: "http://kroki:8000",
  maxSourceBytes: 1024,
  renderTimeoutMs: 1000,
  cacheMaxEntries: 10,
  rendererVersion: "kroki-0.31.1",
};

function renderer(overrides: Partial<RendererClient> = {}): RendererClient {
  return {
    render: async () => "<svg>ok</svg>",
    ready: async () => true,
    ...overrides,
  };
}

test("health is public while rendering requires a valid bearer token", async () => {
  const app = createGateway({ config, renderer: renderer() });

  const health = await app.inject({ method: "GET", url: "/health" });
  const unauthorized = await app.inject({
    method: "POST",
    url: "/v1/render",
    payload: { type: "mermaid", format: "svg", source: "flowchart LR; A-->B" },
  });

  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ok" });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.json().code, "UNAUTHORIZED");
  assert.ok(unauthorized.json().requestId);
  await app.close();
});

test("renders an SVG with observable response headers", async () => {
  const app = createGateway({ config, renderer: renderer() });
  const response = await app.inject({
    method: "POST",
    url: "/v1/render",
    headers: { authorization: "Bearer secret" },
    payload: { type: "mermaid", format: "svg", source: "flowchart LR; A-->B" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "<svg>ok</svg>");
  assert.match(response.headers["content-type"] ?? "", /^image\/svg\+xml/);
  assert.equal(response.headers["x-cache"], "MISS");
  assert.equal(response.headers["x-renderer-version"], "kroki-0.31.1");
  assert.ok(response.headers.etag);
  assert.ok(response.headers["x-request-id"]);
  await app.close();
});

test("rejects unsupported types and oversized sources before calling Kroki", async () => {
  let calls = 0;
  const app = createGateway({
    config: { ...config, maxSourceBytes: 8 },
    renderer: renderer({ render: async () => { calls += 1; return "<svg/>"; } }),
  });
  const headers = { authorization: "Bearer secret" };

  const unsupported = await app.inject({
    method: "POST",
    url: "/v1/render",
    headers,
    payload: { type: "bpmn", format: "svg", source: "x" },
  });
  const oversized = await app.inject({
    method: "POST",
    url: "/v1/render",
    headers,
    payload: { type: "d2", format: "svg", source: "123456789" },
  });

  assert.equal(unsupported.statusCode, 400);
  assert.equal(oversized.statusCode, 413);
  assert.equal(calls, 0);
  await app.close();
});

test("caches identical renders and coalesces concurrent misses", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const app = createGateway({
    config,
    renderer: renderer({
      render: async () => {
        calls += 1;
        await gate;
        return "<svg>same</svg>";
      },
    }),
  });
  const request = {
    method: "POST" as const,
    url: "/v1/render",
    headers: { authorization: "Bearer secret" },
    payload: { type: "d2", format: "svg", source: "a -> b" },
  };

  const firstPromise = app.inject(request);
  const secondPromise = app.inject(request);
  await new Promise((resolve) => setTimeout(resolve, 10));
  release?.();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  const third = await app.inject(request);

  assert.equal(calls, 1);
  assert.equal(first.body, second.body);
  assert.deepEqual([first.headers["x-cache"], second.headers["x-cache"]].sort(), ["HIT", "MISS"]);
  assert.equal(third.headers["x-cache"], "HIT");
  await app.close();
});

test("validate returns structured renderer diagnostics without SVG", async () => {
  const app = createGateway({
    config,
    renderer: renderer({
      render: async () => {
        throw new RendererFailure("Syntax error", { line: 3, column: 7 });
      },
    }),
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/validate",
    headers: { authorization: "Bearer secret" },
    payload: { type: "plantuml", format: "svg", source: "@startuml\nA ->\n@enduml" },
  });

  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.json(), {
    code: "RENDER_FAILED",
    message: "Syntax error",
    line: 3,
    column: 7,
    requestId: response.headers["x-request-id"],
  });
  await app.close();
});

test("reports capabilities and renderer readiness", async () => {
  const app = createGateway({ config, renderer: renderer({ ready: async () => false }) });

  const capabilities = await app.inject({ method: "GET", url: "/v1/capabilities" });
  const readiness = await app.inject({ method: "GET", url: "/ready" });

  assert.equal(capabilities.statusCode, 200);
  assert.deepEqual(capabilities.json(), {
    types: ["mermaid", "plantuml", "graphviz", "d2"],
    formats: ["svg"],
  });
  assert.equal(readiness.statusCode, 503);
  assert.deepEqual(readiness.json(), { status: "not_ready" });
  await app.close();
});
