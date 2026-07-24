import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { createServerBundle } from "./create-server-bundle.mjs";
import { validateReleaseVersions } from "./validate-release-versions.mjs";

const productRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(productRoot, relativePath), "utf8"),
  );
}

async function sha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

const packagePaths = [
  "package.json",
  "packages/contracts/package.json",
  "packages/diagram-config/package.json",
  "gateway/package.json",
  "vscode-extension/package.json",
  "github-action/package.json",
  "playground/package.json",
];
const packages = await Promise.all(packagePaths.map(readJson));
const version = validateReleaseVersions(packages);
const tag = `product-v${version}`;
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== tag) {
  throw new Error(
    `Release tag ${process.env.RELEASE_TAG} does not match package version ${tag}`,
  );
}

const extensionManifest = packages[4];
const repositoryUrl = extensionManifest.repository?.url ?? "";
const ownerMatch = repositoryUrl.match(/github\.com[/:]([^/]+)\//i);
if (!ownerMatch)
  throw new Error(
    "Cannot determine the GitHub owner from the extension repository URL",
  );

const rendererLock = YAML.parse(
  await readFile(path.join(productRoot, ".diagram-renderer.lock"), "utf8"),
);
const dockerImage = `ghcr.io/${ownerMatch[1].toLowerCase()}/diagram-as-code-gateway:${tag}`;
const releaseDirectory = path.join(productRoot, "release", tag);
await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const files = [
  {
    source: "vscode-extension/dist/diagram-as-code-vscode.vsix",
    destination: `diagram-as-code-vscode-${version}.vsix`,
  },
  {
    source: "github-action/dist/index.cjs",
    destination: `diagram-as-code-action-${version}.cjs`,
  },
  {
    source: "deploy/docker-compose.release.yml",
    destination: "docker-compose.yml",
  },
  { source: ".diagramrc.example.yml", destination: "diagramrc.example.yml" },
  { source: `docs/releases/${version}.md`, destination: "RELEASE_NOTES.md" },
];

for (const file of files) {
  await copyFile(
    path.join(productRoot, file.source),
    path.join(releaseDirectory, file.destination),
  );
}

await createServerBundle({
  productRoot,
  releaseDirectory,
  version,
  dockerImage,
  rendererLock,
});

const environmentExample = `# Replace this value before starting the stack.\nDIAGRAM_API_KEYS=change-me-to-a-long-random-secret\nGATEWAY_PORT=9000\n\nGATEWAY_IMAGE=${dockerImage}\nKROKI_IMAGE=yuzutech/kroki:${rendererLock.kroki}\nMERMAID_IMAGE=yuzutech/kroki-mermaid:${rendererLock.mermaid}\n`;
await writeFile(
  path.join(releaseDirectory, "diagram-as-code.env.example"),
  environmentExample,
  "utf8",
);

const artifactNames = (await readdir(releaseDirectory)).sort();
const artifacts = await Promise.all(
  artifactNames.map(async (name) => {
    const filePath = path.join(releaseDirectory, name);
    return {
      name,
      bytes: (await stat(filePath)).size,
      sha256: await sha256(filePath),
    };
  }),
);

const manifest = {
  schemaVersion: 1,
  version,
  tag,
  dockerImage,
  renderers: {
    kroki: String(rendererLock.kroki),
    mermaid: String(rendererLock.mermaid),
    canonicalFormat: rendererLock.canonicalFormat,
  },
  artifacts,
};
await writeFile(
  path.join(releaseDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

const checksumNames = [...artifactNames, "manifest.json"].sort();
const checksumLines = await Promise.all(
  checksumNames.map(
    async (name) =>
      `${await sha256(path.join(releaseDirectory, name))}  ${name}`,
  ),
);
await writeFile(
  path.join(releaseDirectory, "SHA256SUMS"),
  `${checksumLines.join("\n")}\n`,
  "utf8",
);

console.log(`Prepared ${tag} in ${releaseDirectory}`);
for (const name of [...checksumNames, "SHA256SUMS"]) console.log(`- ${name}`);
