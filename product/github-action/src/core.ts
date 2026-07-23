import path from "node:path";
import { createHash } from "node:crypto";

import { createRenderRequest, detectDiagramType, type RenderRequest } from "@diagram-as-code/contracts";
import type { DiagramConfig } from "@diagram-as-code/diagram-config";
import { minimatch } from "minimatch";

export interface FileChange {
  status: "A" | "M" | "D" | "R";
  path: string;
  oldPath?: string;
}

export interface VerificationItem {
  sourcePath: string;
  outputPath: string;
  operation: "verify" | "remove";
}

export interface PullRequestContext {
  repository: string;
  serverUrl: string;
  number: number;
  baseSha: string;
  headSha: string;
}

export interface DiagramReviewRow {
  status: "added" | "modified" | "deleted" | "renamed" | "verified";
  source: string;
  generatedSvg: string;
  before: string;
  after: string;
  visualDiff: string;
}

interface GitHubPullRequestEvent {
  pull_request?: {
    number?: number;
    base?: { sha?: string };
    head?: { sha?: string };
  };
}

function normalize(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function outputPath(sourcePath: string, config: DiagramConfig): string | undefined {
  const source = normalize(sourcePath);
  const sourceDirectory = normalize(config.sources.directory).replace(/\/$/, "");
  const prefix = `${sourceDirectory}/`;
  if (!source.startsWith(prefix)) return undefined;

  const relative = source.slice(prefix.length);
  if (!detectDiagramType(relative) || !config.sources.include.some((pattern) => minimatch(relative, pattern))) {
    return undefined;
  }
  const extension = path.posix.extname(relative);
  return path.posix.join(normalize(config.output.directory), `${relative.slice(0, -extension.length)}.svg`);
}

export function buildVerificationPlan(
  changes: FileChange[],
  allSources: string[],
  config: DiagramConfig,
  forceAll: boolean,
): VerificationItem[] {
  const items = new Map<string, VerificationItem>();
  const sourceByOutput = new Map<string, string>();
  for (const source of allSources) {
    const generated = outputPath(source, config);
    if (generated) sourceByOutput.set(generated, normalize(source));
  }

  const add = (sourcePath: string, operation: VerificationItem["operation"]): void => {
    const generated = outputPath(sourcePath, config);
    if (!generated) return;
    items.set(`${operation}:${normalize(sourcePath)}`, {
      sourcePath: normalize(sourcePath),
      outputPath: generated,
      operation,
    });
  };

  if (forceAll) {
    for (const source of allSources) add(source, "verify");
  } else {
    for (const change of changes) {
      if (change.status === "D") add(change.path, "remove");
      else if (change.status === "R") {
        if (change.oldPath) add(change.oldPath, "remove");
        add(change.path, "verify");
      } else {
        add(change.path, "verify");
      }
      const sourceForGenerated = sourceByOutput.get(normalize(change.path));
      if (sourceForGenerated) add(sourceForGenerated, "verify");
    }
  }

  return [...items.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

export function deterministicRequest(sourcePath: string, source: string): RenderRequest {
  return createRenderRequest(sourcePath, source);
}

export function pullRequestContextFromEvent(
  event: unknown,
  repository: string | undefined,
  serverUrl: string | undefined,
): PullRequestContext | undefined {
  if (!repository) return undefined;
  const pullRequest = (event as GitHubPullRequestEvent | undefined)?.pull_request;
  const number = pullRequest?.number;
  const baseSha = pullRequest?.base?.sha;
  const headSha = pullRequest?.head?.sha;
  if (!number || !baseSha || !headSha) return undefined;
  return {
    repository,
    serverUrl: serverUrl ?? "https://github.com",
    number,
    baseSha,
    headSha,
  };
}

function encodedPath(filePath: string): string {
  return normalize(filePath).split("/").map(encodeURIComponent).join("/");
}

function blobUrl(context: PullRequestContext, sha: string, filePath: string): string {
  return `${context.serverUrl}/${context.repository}/blob/${sha}/${encodedPath(filePath)}`;
}

function markdownLink(label: string, url: string): string {
  return `[${label}](${url})`;
}

function pullRequestFileUrl(context: PullRequestContext, filePath: string): string {
  const hash = createHash("sha256").update(normalize(filePath)).digest("hex");
  return `${context.serverUrl}/${context.repository}/pull/${context.number}/files#diff-${hash}`;
}

export function buildDiagramReviewRows(
  plan: VerificationItem[],
  changes: FileChange[],
  context: PullRequestContext,
): DiagramReviewRow[] {
  const normalizedChanges = changes.map((change) => ({
    ...change,
    path: normalize(change.path),
    oldPath: change.oldPath ? normalize(change.oldPath) : undefined,
  }));
  const changeByPath = new Map(normalizedChanges.map((change) => [change.path, change]));
  const renameByNewPath = new Map(normalizedChanges.filter((change) => change.status === "R").map((change) => [change.path, change]));
  const renameByOldPath = new Map(
    normalizedChanges
      .filter((change): change is FileChange & { oldPath: string } => change.status === "R" && Boolean(change.oldPath))
      .map((change) => [change.oldPath, change]),
  );
  const itemBySource = new Map(plan.map((item) => [normalize(item.sourcePath), item]));

  return plan.flatMap((item): DiagramReviewRow[] => {
    const sourcePath = normalize(item.sourcePath);
    const outputPath = normalize(item.outputPath);
    const renameFromOldPath = renameByOldPath.get(sourcePath);
    if (item.operation === "remove" && renameFromOldPath) return [];

    const renameToNewPath = renameByNewPath.get(sourcePath);
    if (renameToNewPath?.oldPath) {
      const oldItem = itemBySource.get(renameToNewPath.oldPath);
      const oldOutputPath = oldItem?.outputPath ?? outputPath;
      return [{
        status: "renamed",
        source: markdownLink(sourcePath, blobUrl(context, context.headSha, sourcePath)),
        generatedSvg: markdownLink(outputPath, blobUrl(context, context.headSha, outputPath)),
        before: markdownLink("base", blobUrl(context, context.baseSha, oldOutputPath)),
        after: markdownLink("head", blobUrl(context, context.headSha, outputPath)),
        visualDiff: markdownLink("open", pullRequestFileUrl(context, outputPath)),
      }];
    }

    const change = changeByPath.get(sourcePath) ?? changeByPath.get(outputPath);
    if (item.operation === "remove") {
      return [{
        status: "deleted",
        source: markdownLink(sourcePath, blobUrl(context, context.baseSha, sourcePath)),
        generatedSvg: markdownLink(outputPath, blobUrl(context, context.baseSha, outputPath)),
        before: markdownLink("base", blobUrl(context, context.baseSha, outputPath)),
        after: "",
        visualDiff: markdownLink("open", pullRequestFileUrl(context, outputPath)),
      }];
    }

    const status = change?.status === "A" ? "added" : change?.status === "M" ? "modified" : "verified";
    return [{
      status,
      source: markdownLink(sourcePath, blobUrl(context, context.headSha, sourcePath)),
      generatedSvg: markdownLink(outputPath, blobUrl(context, context.headSha, outputPath)),
      before: status === "added" ? "" : markdownLink("base", blobUrl(context, context.baseSha, outputPath)),
      after: markdownLink("head", blobUrl(context, context.headSha, outputPath)),
      visualDiff: markdownLink("open", pullRequestFileUrl(context, outputPath)),
    }];
  });
}

export function parseNameStatus(output: string): FileChange[] {
  const changes: FileChange[] = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [rawStatus, firstPath, secondPath] = line.split("\t");
    if (!rawStatus || !firstPath) continue;
    const status = rawStatus[0];
    if (status === "R" && secondPath) {
      changes.push({ status: "R", oldPath: firstPath, path: secondPath });
    } else if (status === "A" || status === "M" || status === "D") {
      changes.push({ status, path: firstPath });
    }
  }
  return changes;
}
