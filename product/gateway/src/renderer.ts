import type { RenderRequest } from "@diagram-as-code/contracts";

export interface RendererClient {
  render(request: RenderRequest): Promise<string>;
  ready(): Promise<boolean>;
}

export class RendererFailure extends Error {
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(message: string, location: { line?: number; column?: number } = {}) {
    super(message);
    this.name = "RendererFailure";
    this.line = location.line;
    this.column = location.column;
  }
}

export class KrokiRenderer implements RendererClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async render(request: RenderRequest): Promise<string> {
    const query = new URLSearchParams();
    if (request.theme) {
      query.set("theme", request.theme);
    }
    for (const [key, value] of Object.entries(request.options ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (value !== undefined) {
        query.set(key, String(value));
      }
    }

    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${request.type}/svg${suffix}`, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: request.source,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error("Kroki renderer is unavailable", { cause: error });
    }

    const body = await response.text();
    if (!response.ok) {
      throw new RendererFailure(body.trim() || `Kroki returned HTTP ${response.status}`);
    }
    return body;
  }

  async ready(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
