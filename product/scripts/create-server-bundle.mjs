import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import AdmZip from "adm-zip";

export async function createServerBundle({
  productRoot,
  releaseDirectory,
  version,
  dockerImage,
  rendererLock,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid product version: ${version}`);
  }
  if (!dockerImage.endsWith(`:product-v${version}`)) {
    throw new Error(`Gateway image must use product-v${version}`);
  }

  const manifest = {
    schemaVersion: 1,
    productVersion: version,
    composeProject: "diagram-as-code",
    gatewayUrl: "http://localhost:9000",
    readinessTimeoutSeconds: 120,
    images: {
      gateway: dockerImage,
      kroki: `yuzutech/kroki:${rendererLock.kroki}`,
      mermaid: `yuzutech/kroki-mermaid:${rendererLock.mermaid}`,
    },
  };

  const sourceEntries = [
    ["windows-installer/diagram-server.ps1", "diagram-server.ps1"],
    ["windows-installer/DiagramServer.psm1", "DiagramServer.psm1"],
    ["windows-installer/README.md", "README.md"],
    ["deploy/docker-compose.release.yml", "docker-compose.yml"],
  ];
  const contentEntries = new Map();
  for (const [source, destination] of sourceEntries) {
    contentEntries.set(
      destination,
      await readFile(path.join(productRoot, source)),
    );
  }
  contentEntries.set(
    "LICENSE",
    await readFile(path.resolve(productRoot, "..", "LICENSE")),
  );
  contentEntries.set(
    "server-manifest.json",
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  );

  const checksumLines = [...contentEntries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, content]) =>
        `${createHash("sha256").update(content).digest("hex")}  ${name}`,
    );
  contentEntries.set(
    "SHA256SUMS",
    Buffer.from(`${checksumLines.join("\n")}\n`, "utf8"),
  );

  const zip = new AdmZip();
  for (const [name, content] of contentEntries) {
    zip.addFile(name, content);
  }

  await mkdir(releaseDirectory, { recursive: true });
  const fileName = `diagram-as-code-server-${version}.zip`;
  const outputPath = path.join(releaseDirectory, fileName);
  zip.writeZip(outputPath);
  return { fileName, outputPath, manifest };
}
