import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DIAGRAM_TYPES, type RenderRequest } from "@diagram-as-code/contracts";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import type { GatewayConfig } from "./config.js";
import { RenderService } from "./render-service.js";
import { RendererFailure, type RendererClient } from "./renderer.js";

const renderRequestSchema = z.object({
  type: z.enum(DIAGRAM_TYPES),
  format: z.literal("svg"),
  source: z.string().min(1),
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  theme: z.string().min(1).optional(),
}).strict();

interface CreateGatewayOptions {
  config: GatewayConfig;
  renderer: RendererClient;
  playgroundDirectory?: string | false;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function defaultPlaygroundDirectory(): string | undefined {
  if (process.env.DIAGRAM_PLAYGROUND_DIR) return process.env.DIAGRAM_PLAYGROUND_DIR;
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "playground/dist"),
    path.resolve(process.cwd(), "../playground/dist"),
    path.resolve(moduleDirectory, "../../playground/dist"),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html")));
}

function keyMatches(candidate: string, expected: string): boolean {
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function errorBody(
  request: FastifyRequest,
  code: string,
  message: string,
  location: { line?: number | undefined; column?: number | undefined } = {},
): Record<string, unknown> {
  return {
    code,
    message,
    ...(location.line === undefined ? {} : { line: location.line }),
    ...(location.column === undefined ? {} : { column: location.column }),
    requestId: request.id,
  };
}

export function createGateway(options: CreateGatewayOptions) {
  const { config, renderer } = options;
  const app = Fastify({
    logger: false,
    bodyLimit: config.maxSourceBytes + 65_536,
    requestIdHeader: "x-request-id",
  });
  const renderService = new RenderService(renderer, config.cacheMaxEntries);
  const playgroundDirectory = options.playgroundDirectory === false
    ? undefined
    : options.playgroundDirectory ?? defaultPlaygroundDirectory();

  app.addHook("onRequest", async (request, reply) => {
    void reply.header("X-Request-Id", request.id);
  });

  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (config.authMode === "disabled") return;
    const authorization = request.headers.authorization ?? "";
    const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!candidate || !config.apiKeys.some((key) => keyMatches(candidate, key))) {
      await reply.code(401).send(errorBody(request, "UNAUTHORIZED", "A valid bearer API key is required"));
    }
  }

  function parseRequest(request: FastifyRequest, reply: FastifyReply): RenderRequest | undefined {
    const parsed = renderRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      void reply.code(400).send(errorBody(request, "INVALID_REQUEST", "Render request is invalid"));
      return undefined;
    }
    if (Buffer.byteLength(parsed.data.source, "utf8") > config.maxSourceBytes) {
      void reply.code(413).send(errorBody(request, "SOURCE_TOO_LARGE", "Diagram source exceeds MAX_SOURCE_BYTES"));
      return undefined;
    }
    return {
      type: parsed.data.type,
      format: parsed.data.format,
      source: parsed.data.source,
      ...(parsed.data.options === undefined ? {} : { options: parsed.data.options }),
      ...(parsed.data.theme === undefined ? {} : { theme: parsed.data.theme }),
    };
  }

  async function renderOrReply(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = parseRequest(request, reply);
    if (!body) return;

    try {
      const result = await renderService.render(body);
      const etag = `"${createHash("sha256").update(result.svg).digest("hex")}"`;
      await reply
        .header("ETag", etag)
        .header("X-Cache", result.cache)
        .header("X-Renderer-Version", config.rendererVersion)
        .type("image/svg+xml")
        .send(result.svg);
    } catch (error) {
      if (error instanceof RendererFailure) {
        await reply.code(422).send(errorBody(request, "RENDER_FAILED", error.message, error));
        return;
      }
      request.log.error(error);
      await reply.code(502).send(errorBody(request, "RENDERER_UNAVAILABLE", "The renderer is unavailable"));
    }
  }

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    const ready = await renderer.ready();
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready" });
  });
  app.get("/v1/capabilities", async () => ({ types: [...DIAGRAM_TYPES], formats: ["svg"] }));

  async function servePlayground(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!playgroundDirectory) {
      await reply.code(404).send(errorBody(request, "PLAYGROUND_NOT_FOUND", "The playground build is not available"));
      return;
    }

    const wildcard = (request.params as Record<string, string | undefined>)["*"] ?? "";
    let requestedPath: string;
    try {
      requestedPath = decodeURIComponent(wildcard) || "index.html";
    } catch {
      await reply.code(404).send();
      return;
    }

    const root = path.resolve(playgroundDirectory);
    const absolutePath = path.resolve(root, requestedPath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
      await reply.code(404).send();
      return;
    }

    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        await reply.code(404).send();
        return;
      }
      const extension = path.extname(absolutePath).toLowerCase();
      await reply
        .header("Cache-Control", extension === ".html" ? "no-store" : "no-cache")
        .type(MIME_TYPES[extension] ?? "application/octet-stream")
        .send(await readFile(absolutePath));
    } catch {
      await reply.code(404).send();
    }
  }

  app.get("/playground", servePlayground);
  app.get("/playground/", servePlayground);
  app.get("/playground/*", servePlayground);

  app.post("/v1/render", { preHandler: authenticate }, renderOrReply);
  app.post("/v1/validate", { preHandler: authenticate }, async (request, reply) => {
    const body = parseRequest(request, reply);
    if (!body) return;
    try {
      const result = await renderService.render(body);
      await reply
        .header("X-Cache", result.cache)
        .header("X-Renderer-Version", config.rendererVersion)
        .send({ valid: true });
    } catch (error) {
      if (error instanceof RendererFailure) {
        await reply.code(422).send(errorBody(request, "RENDER_FAILED", error.message, error));
        return;
      }
      request.log.error(error);
      await reply.code(502).send(errorBody(request, "RENDERER_UNAVAILABLE", "The renderer is unavailable"));
    }
  });

  return app;
}
