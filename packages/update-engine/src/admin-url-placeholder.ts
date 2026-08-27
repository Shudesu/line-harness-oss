/**
 * Placeholder origin baked into every admin build by release.yml.
 *
 * The admin bundle is built once per release and its build tooling (Next.js)
 * needs *some* value for the API origin at compile time, but the real Worker
 * origin isn't known until install/deploy time. `__LH_WORKER_URL__` stands in
 * for it. Deployment topology decides what happens afterwards:
 *
 *   - Per-tenant builds and self-hosted installs, where the admin is served
 *     from a different host than the Worker API: {@link materializeAdminFiles}
 *     (materialize.ts) rewrites every occurrence to that install's real
 *     Worker origin before the files are ever served.
 *   - Shared builds served by the tenant Worker itself explicitly build the
 *     admin with `NEXT_PUBLIC_API_MODE=same-origin`. They leave this URL
 *     placeholder untouched because one shared asset cannot contain a
 *     tenant-specific origin.
 *
 * Browser code must not import this constant to infer topology: the normal
 * materializer rewrites every occurrence, including comparison sentinels.
 * That exact coupling caused the v0.23.0 Pages login 405 regression.
 */
export const ADMIN_URL_PLACEHOLDER = 'https://__LH_WORKER_URL__';
