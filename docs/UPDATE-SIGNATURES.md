# Release manifest signatures

The exact downloaded manifest bytes are verified before JSON parsing. Ed25519 is
available in Workers WebCrypto and Node 20+: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ . No canonicalization/re-serialization is allowed.

`UPDATE_SIGNATURE_POLICY=warn` preserves unsigned historical releases with a warning.
`require` refuses missing/invalid signatures before update mutation (HTTP 409).
CLI setup/update also accept `--signature-policy warn|require`; configuration mistakes
fail closed. `UPDATE_TRUSTED_KEYS=kid:base64-raw-32-byte-public-key,...` adds locally
trusted keys; keys in downloaded files are never trusted. Duplicate conflicting IDs
are rejected. The dashboard reports verification separately from bundle hashes.

The initial built-in trust store is intentionally empty: **no official signing key
has been provisioned or certified by this change**. Verification tests use disposable
keys. This code alone does not establish an official signed release chain, and warn
mode does not prevent malicious updates. No automatic future policy switch is set.

## Signing ceremony and release integration

1. Generate an Ed25519 key in the maintainer's controlled signing environment; store
   only its private PEM in the protected `release-signing` GitHub Environment secret
   `RELEASE_SIGNING_KEY`. Configure required reviewers outside the workflow. Do not
   put private keys in repository variables, artifacts, command arguments or logs.
2. Review the raw public key and its SHA-256 fingerprint out of band. Add that public
   key and key ID to `packages/update-engine/src/trusted-keys.ts` in a reviewed release.
   Keep the previous key for at least one rotation release. Bootstrap trust is explicit:
   an older unsigned client cannot authenticate its own first trust-store update.
3. Before merging a previous manifest, download both original bytes and its `.sig`,
   then run `UPDATE_TRUSTED_KEYS=... node scripts/release/sign-manifest.mjs verify previous.json`.
   Unsigned first-release history needs a separately reviewed bootstrap artifact; do
   not silently fall back to trusting an unverified previous manifest.
4. After `update-manifest.ts`, in the protected signing job run
   `node scripts/release/sign-manifest.mjs sign release-manifest.json` with
   `RELEASE_SIGNING_KID` and the secret environment. Upload the unchanged JSON and
   `.sig` together. Verification example: the same script with `verify` and the
   published trusted raw public key in `UPDATE_TRUSTED_KEYS`.
5. Test the release with `require` before switching client policy. Cloud bundle
   promotion is a separate path; it must consume the verified artifact and must not
   be claimed covered by the standalone manifest fetcher.

The private repository has no OSS `release.yml`; that public workflow and real
signing-environment setup are pending public release work. Do not add an unprotected
signing step or invent an official fingerprint. Preserve existing Cloud release pins.

One fetch now has a companion signature request. Each request is time bounded;
manifest bytes are capped at 8 MiB, signature bytes at 16 KiB. No D1 or cron changes.
Signature authenticity does not prevent replay of a previously valid old manifest;
existing version checks remain relevant and key compromise needs revocation/release
procedures. A compromised signer can still sign malicious files.
