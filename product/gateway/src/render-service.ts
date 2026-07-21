import { createHash } from "node:crypto";

import type { RenderRequest } from "@diagram-as-code/contracts";

import type { RendererClient } from "./renderer.js";

export interface RenderResult {
  svg: string;
  cache: "HIT" | "MISS";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function renderKey(request: RenderRequest): string {
  return createHash("sha256").update(JSON.stringify(stableValue(request))).digest("hex");
}

export class RenderService {
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly renderer: RendererClient,
    private readonly maxEntries: number,
  ) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    const key = renderKey(request);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { svg: cached, cache: "HIT" };
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      return { svg: await pending, cache: "HIT" };
    }

    const renderPromise = this.renderer.render(request);
    this.inFlight.set(key, renderPromise);
    try {
      const svg = await renderPromise;
      this.cache.set(key, svg);
      while (this.cache.size > this.maxEntries) {
        const oldest = this.cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      return { svg, cache: "MISS" };
    } finally {
      this.inFlight.delete(key);
    }
  }
}
