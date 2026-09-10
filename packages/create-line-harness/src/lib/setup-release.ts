/** Release tags/manifest entries use canonical stable X.Y.Z versions. */
export function validateSetupReleaseVersion(version: string): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("--release requires a stable version (for example 0.24.1).");
  }
  return version;
}
