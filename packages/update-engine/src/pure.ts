export type {
  CurrentVersion,
  ForkStatus,
  Manifest,
  ReleaseEntry,
} from './types.js';
export {
  compareSemver,
  fetchManifest,
  findLatestUpgrade,
  findRelease,
} from './manifest.js';
export { detectFork } from './fork-detect.js';
// Browser-safe: a bare string constant, no Node builtins. The Node-side
// materialization logic that rewrites it (materialize.ts) stays out of this
// entry point; only the admin runtime's placeholder *detection* needs it.
export { ADMIN_URL_PLACEHOLDER } from './admin-url-placeholder.js';
