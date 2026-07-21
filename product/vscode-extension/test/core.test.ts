import assert from "node:assert/strict";
import test from "node:test";

import { GatewayClient, RenderCoordinator, resolveOutputPath } from "../src/core.ts";

test("maps a source file to one stable SVG path while preserving subdirectories", () => {
  assert.equal(
    resolveOutputPath(
      "C:/repo",
      "C:/repo/docs/diagrams/payments/refund.mmd",
      "docs/diagrams",
      "docs/generated",
    ),
    "C:/repo/docs/generated/payments/refund.svg",
  );
});

test("rejects source files outside the configured source directory", () => {
  assert.throws(
    () => resolveOutputPath("C:/repo", "C:/repo/README.mmd", "docs/diagrams", "docs/generated"),
    /outside the configured source directory/,
  );
});

test("Gateway client sends auth and returns SVG", async () => {
  let received: { url: string; init: RequestInit } | undefined;
  const client = new GatewayClient("http://localhost:9000/", "secret", async (input, init) => {
    received = { url: String(input), init: init ?? {} };
    return new Response("<svg>ok</svg>", {
      status: 200,
      headers: { "content-type": "image/svg+xml" },
    });
  });

  const svg = await client.render({ type: "mermaid", format: "svg", source: "A-->B" });

  assert.equal(svg, "<svg>ok</svg>");
  assert.equal(received?.url, "http://localhost:9000/v1/render");
  assert.equal(new Headers(received?.init.headers).get("authorization"), "Bearer secret");
});

test("Gateway client exposes structured render errors", async () => {
  const client = new GatewayClient("http://localhost:9000", "secret", async () =>
    new Response(JSON.stringify({ code: "RENDER_FAILED", message: "bad arrow", line: 2, requestId: "r1" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    }),
  );

  await assert.rejects(
    client.render({ type: "d2", format: "svg", source: "bad" }),
    (error: Error & { line?: number; requestId?: string }) =>
      error.message === "bad arrow" && error.line === 2 && error.requestId === "r1",
  );
});

test("coordinator reuses a matching preview and aborts an older render", async () => {
  const signals: AbortSignal[] = [];
  const resolvers: Array<(svg: string) => void> = [];
  const coordinator = new RenderCoordinator(async (_request, signal) => {
    signals.push(signal);
    return new Promise<string>((resolve) => resolvers.push(resolve));
  });

  const first = coordinator.render("file:///a.mmd", { type: "mermaid", format: "svg", source: "A" });
  const second = coordinator.render("file:///a.mmd", { type: "mermaid", format: "svg", source: "B" });
  assert.equal(signals[0]?.aborted, true);
  resolvers[0]?.("<svg>A</svg>");
  resolvers[1]?.("<svg>B</svg>");
  await assert.rejects(first, /superseded/);
  assert.equal(await second, "<svg>B</svg>");

  const cached = await coordinator.render("file:///a.mmd", { type: "mermaid", format: "svg", source: "B" });
  assert.equal(cached, "<svg>B</svg>");
  assert.equal(signals.length, 2);
});

test("coordinator shares an in-flight render for identical source", async () => {
  let calls = 0;
  let release: ((svg: string) => void) | undefined;
  const coordinator = new RenderCoordinator(async () => {
    calls += 1;
    return new Promise<string>((resolve) => { release = resolve; });
  });
  const request = { type: "graphviz" as const, format: "svg" as const, source: "digraph { A -> B }" };

  const preview = coordinator.render("file:///a.dot", request);
  const exportRender = coordinator.render("file:///a.dot", request);
  release?.("<svg>shared</svg>");

  assert.equal(await preview, "<svg>shared</svg>");
  assert.equal(await exportRender, "<svg>shared</svg>");
  assert.equal(calls, 1);
});
