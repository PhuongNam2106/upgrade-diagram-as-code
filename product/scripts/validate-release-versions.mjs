const INTERNAL_PACKAGE_NAMES = new Set([
  "@diagram-as-code/contracts",
  "@diagram-as-code/diagram-config",
]);

export function validateReleaseVersions(manifests) {
  if (manifests.length === 0) {
    throw new Error("At least one product manifest is required");
  }

  const versions = new Set(manifests.map((manifest) => manifest.version));
  if (versions.size !== 1) {
    throw new Error(
      `Product package versions must match: ${[...versions].join(", ")}`,
    );
  }
  const [version] = versions;

  for (const manifest of manifests) {
    for (const [name, dependencyVersion] of Object.entries(
      manifest.dependencies ?? {},
    )) {
      if (INTERNAL_PACKAGE_NAMES.has(name) && dependencyVersion !== version) {
        throw new Error(
          `${manifest.name} depends on ${name}@${dependencyVersion}; expected ${version}`,
        );
      }
    }
  }

  return version;
}
