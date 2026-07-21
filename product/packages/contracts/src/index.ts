import { extname } from "node:path";

export const DIAGRAM_TYPES = [
  "mermaid",
  "plantuml",
  "graphviz",
  "d2",
] as const;

export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export type RenderFormat = "svg";

export const DEFAULT_RENDER_FORMAT: RenderFormat = "svg";

const EXTENSION_TO_TYPE: Readonly<Record<string, DiagramType>> = {
  ".mmd": "mermaid",
  ".puml": "plantuml",
  ".dot": "graphviz",
  ".d2": "d2",
};

export interface RenderOptions {
  deterministic?: boolean;
  [key: string]: boolean | number | string | undefined;
}

export interface RenderRequest {
  type: DiagramType;
  format: RenderFormat;
  source: string;
  options?: RenderOptions;
  theme?: string;
}

export interface RenderError {
  code: string;
  message: string;
  line?: number;
  column?: number;
  requestId: string;
}

export function detectDiagramType(filePath: string): DiagramType | undefined {
  return EXTENSION_TO_TYPE[extname(filePath).toLowerCase()];
}

export function isDiagramType(value: unknown): value is DiagramType {
  return typeof value === "string" && DIAGRAM_TYPES.includes(value as DiagramType);
}

export function outputContentType(format: RenderFormat): "image/svg+xml" {
  if (format !== "svg") {
    throw new Error(`Unsupported render format: ${String(format)}`);
  }

  return "image/svg+xml";
}
