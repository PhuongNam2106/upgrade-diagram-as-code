import { parse as parseYaml } from "yaml";
import { z } from "zod";

const diagramConfigSchema = z.object({
  version: z.literal(1),
  server: z.object({
    url: z.url(),
    apiKeyEnv: z.string().min(1).default("DIAGRAM_API_KEY"),
  }),
  sources: z
    .object({
      directory: z.string().min(1).default("docs/diagrams"),
      include: z
        .array(z.string().min(1))
        .min(1)
        .default(["**/*.mmd", "**/*.puml", "**/*.dot", "**/*.d2"]),
    })
    .default({
      directory: "docs/diagrams",
      include: ["**/*.mmd", "**/*.puml", "**/*.dot", "**/*.d2"],
    }),
  output: z
    .object({
      directory: z.string().min(1).default("docs/generated"),
      format: z.literal("svg").default("svg"),
    })
    .default({ directory: "docs/generated", format: "svg" }),
  preview: z
    .object({
      debounceMs: z.number().int().min(100).max(10_000).default(600),
    })
    .default({ debounceMs: 600 }),
  render: z
    .object({
      onSave: z.literal("changed").default("changed"),
      exportOnSave: z.boolean().default(false),
    })
    .default({ onSave: "changed", exportOnSave: false }),
});

export type DiagramConfig = z.infer<typeof diagramConfigSchema>;

export function parseDiagramConfig(source: string): DiagramConfig {
  try {
    return diagramConfigSchema.parse(parseYaml(source));
  } catch (error) {
    const details = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Invalid diagram configuration${details}`, { cause: error });
  }
}
