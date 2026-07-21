export type AuthMode = "required" | "disabled";

export interface GatewayConfig {
  authMode: AuthMode;
  apiKeys: string[];
  port: number;
  host: string;
  krokiBaseUrl: string;
  maxSourceBytes: number;
  renderTimeoutMs: number;
  cacheMaxEntries: number;
  rendererVersion: string;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const authMode = env.AUTH_MODE ?? "required";
  if (authMode !== "required" && authMode !== "disabled") {
    throw new Error("AUTH_MODE must be either required or disabled");
  }

  const apiKeys = [...new Set(
    (env.DIAGRAM_API_KEYS ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  )];
  if (authMode === "required" && apiKeys.length === 0) {
    throw new Error("DIAGRAM_API_KEYS must contain at least one key when AUTH_MODE=required");
  }

  return {
    authMode,
    apiKeys,
    port: positiveInteger(env.PORT, 9000, "PORT"),
    host: env.HOST ?? "0.0.0.0",
    krokiBaseUrl: (env.KROKI_BASE_URL ?? "http://kroki:8000").replace(/\/$/, ""),
    maxSourceBytes: positiveInteger(env.MAX_SOURCE_BYTES, 1_048_576, "MAX_SOURCE_BYTES"),
    renderTimeoutMs: positiveInteger(env.RENDER_TIMEOUT_MS, 10_000, "RENDER_TIMEOUT_MS"),
    cacheMaxEntries: positiveInteger(env.CACHE_MAX_ENTRIES, 500, "CACHE_MAX_ENTRIES"),
    rendererVersion: env.RENDERER_VERSION ?? "kroki-0.31.1",
  };
}
