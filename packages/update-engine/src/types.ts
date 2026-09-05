export interface ReleaseEntry {
  version: string;
  released_at: string;
  /**
   * Identity hash of the Worker: computed on the FIRST-pass build (before
   * `_version.ts` is embedded) and baked into the shipped Worker, which
   * self-reports it via /admin/version. detectFork compares against this.
   * NOT the byte hash of the bundle's worker/index.js — an artifact cannot
   * contain its own hash.
   */
  worker_hash: string;
  admin_hash: string;
  liff_hash: string;
  /** Integrity hash of bundle.tar.gz's worker-assets/ tree. */
  worker_assets_hash?: string;
  /**
   * Byte hash (sha256:<hex>) of the FINAL worker/index.js inside
   * bundle.tar.gz — the detached integrity hash download verification
   * uses. Absent on releases predating the deployable-worker pipeline;
   * those bundles ship a broken worker stub and cannot be installed from.
   */
  worker_bundle_hash?: string;
  bundle_url: string;
  bundle_size_bytes: number;
  required_secrets: string[];
  new_required_secrets: string[];
  migrations: string[];
  changelog_url: string;
  min_from_version: string;
}

export interface Manifest {
  schema_version: 1;
  latest: string;
  releases: ReleaseEntry[];
}

export interface CurrentVersion {
  version: string;
  worker_hash: string;
  admin_hash: string;
  liff_hash: string;
  worker_assets_hash?: string;
}

export type ForkStatus =
  | { kind: 'vanilla'; matchedRelease: ReleaseEntry }
  | { kind: 'fork'; reason: string };

export interface UpdateEvent {
  step:
    | 'preflight'
    | 'migration'
    | 'worker'
    | 'admin'
    | 'liff'
    | 'verify'
    | 'rollback'
    | 'complete';
  status: 'pending' | 'running' | 'done' | 'failed';
  name?: string;
  hash?: string;
  deployment_id?: string;
  error?: string;
  rolling_back?: boolean;
  new_version?: string;
  reverted_to?: string;
}

export interface CfApiCreds {
  accountId: string;
  apiToken: string;
}

export interface UpdateContext {
  creds: CfApiCreds;
  workerName: string;
  adminPagesProject: string;
  /**
   * LIFF Pages project name, or '' for CLI installs that serve the LIFF SPA
   * from Worker assets instead of a separate Pages project. When empty, the
   * LIFF snapshot / deploy / verify / rollback steps are skipped.
   */
  liffPagesProject: string;
  d1DatabaseId: string;
  current: CurrentVersion;
  target: ReleaseEntry;
  manifestUrl: string;
  bundleStoragePath?: string;
  /**
   * Public origin of the deployed Worker (e.g. `https://x.workers.dev`).
   * Used to materialize the admin bundle's `__LH_WORKER_URL__` placeholder
   * before the admin Pages deploy. Optional only for backwards
   * compatibility — callers should always set it; when absent the admin
   * files ship with the placeholder still baked in (pre-fix behaviour).
   */
  workerPublicUrl?: string;
}
