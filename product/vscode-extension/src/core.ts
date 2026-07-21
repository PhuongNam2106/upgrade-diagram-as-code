import { createHash } from "node:crypto";
import path from "node:path";

import type { RenderError, RenderRequest } from "@diagram-as-code/contracts";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class GatewayError extends Error {
  readonly code: string;
  readonly line: number | undefined;
  readonly column: number | undefined;
  readonly requestId: string | undefined;

  constructor(error: Partial<RenderError> & Pick<RenderError, "message">) {
    super(error.message);
    this.name = "GatewayError";
    this.code = error.code ?? "GATEWAY_ERROR";
    this.line = error.line;
    this.column = error.column;
    this.requestId = error.requestId;
  }
}

export class GatewayClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async render(request: RenderRequest, signal?: AbortSignal): Promise<string> {
    const headers = new Headers({ "content-type": "application/json" });
    if (this.apiKey) headers.set("authorization", `Bearer ${this.apiKey}`);

    const response = await this.fetcher(`${this.baseUrl}/v1/render`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      ...(signal === undefined ? {} : { signal }),
    });
    const body = await response.text();
    if (!response.ok) {
      let detail: Partial<RenderError> & Pick<RenderError, "message"> = {
        message: body || `Gateway returned HTTP ${response.status}`,
      };
      try {
        detail = JSON.parse(body) as RenderError;
      } catch {
        // Non-JSON proxy errors still produce a useful message.
      }
      throw new GatewayError(detail);
    }
    if (!body.includes("<svg")) {
      throw new GatewayError({ code: "INVALID_RESPONSE", message: "Gateway did not return an SVG" });
    }
    return body;
  }
}

interface ActiveRender {
  controller: AbortController;
  generation: number;
  hash: string;
  promise: Promise<string>;
}

export class RenderCoordinator {
  private readonly cache = new Map<string, { hash: string; svg: string }>();
  private readonly active = new Map<string, ActiveRender>();
  private generation = 0;

  constructor(
    private readonly renderFn: (request: RenderRequest, signal: AbortSignal) => Promise<string>,
  ) {}

  render(resource: string, request: RenderRequest): Promise<string> {
    const hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const cached = this.cache.get(resource);
    if (cached?.hash === hash) return Promise.resolve(cached.svg);

    const pending = this.active.get(resource);
    if (pending?.hash === hash) return pending.promise;
    pending?.controller.abort();
    const current: ActiveRender = {
      controller: new AbortController(),
      generation: ++this.generation,
      hash,
      promise: Promise.resolve(""),
    };
    this.active.set(resource, current);
    current.promise = this.execute(resource, request, hash, current);
    return current.promise;
  }

  private async execute(
    resource: string,
    request: RenderRequest,
    hash: string,
    current: ActiveRender,
  ): Promise<string> {
    try {
      const svg = await this.renderFn(request, current.controller.signal);
      if (current.controller.signal.aborted || this.active.get(resource)?.generation !== current.generation) {
        throw new Error("Render was superseded by newer source");
      }
      this.cache.set(resource, { hash, svg });
      return svg;
    } finally {
      if (this.active.get(resource)?.generation === current.generation) {
        this.active.delete(resource);
      }
    }
  }
}

export function resolveOutputPath(
  workspacePath: string,
  sourcePath: string,
  sourceDirectory: string,
  outputDirectory: string,
): string {
  const pathApi = /^[A-Za-z]:[\\/]/.test(workspacePath) ? path.win32 : path;
  const sourceRoot = pathApi.resolve(workspacePath, sourceDirectory);
  const absoluteSource = pathApi.resolve(sourcePath);
  const relative = pathApi.relative(sourceRoot, absoluteSource);
  if (relative === "" || relative.startsWith(`..${pathApi.sep}`) || relative === ".." || pathApi.isAbsolute(relative)) {
    throw new Error("Diagram source is outside the configured source directory");
  }

  const output = pathApi.resolve(
    workspacePath,
    outputDirectory,
    relative.slice(0, -pathApi.extname(relative).length) + ".svg",
  );
  return pathApi === path.win32 ? output.replaceAll("\\", "/") : output;
}
