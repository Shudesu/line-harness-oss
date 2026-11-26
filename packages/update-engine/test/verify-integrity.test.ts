import { describe, it, expect } from 'vitest';
import {
  verifyBundleIntegrity,
  BundleNotDeployableError,
  type BundleHashes,
} from '../src/bundle.js';

const computed: BundleHashes = {
  worker: 'sha256:workerbytes',
  workerAssets: 'sha256:workerassets',
  admin: 'sha256:adminbytes',
  liff: 'sha256:liffbytes',
};

const entry = {
  version: '0.17.0',
  admin_hash: 'sha256:adminbytes',
  liff_hash: 'sha256:liffbytes',
  worker_assets_hash: 'sha256:workerassets',
  worker_bundle_hash: 'sha256:workerbytes',
};

describe('verifyBundleIntegrity', () => {
  it('passes when worker bytes match worker_bundle_hash and admin/liff match', () => {
    expect(() => verifyBundleIntegrity(computed, entry)).not.toThrow();
  });

  it('rejects releases without worker_bundle_hash (pre-pipeline bundles are undeployable)', () => {
    const legacy = { ...entry, worker_bundle_hash: undefined };
    expect(() => verifyBundleIntegrity(computed, legacy)).toThrow(
      BundleNotDeployableError,
    );
    expect(() => verifyBundleIntegrity(computed, legacy)).toThrow(/0\.17\.0/);
  });

  it('rejects a tampered worker artifact', () => {
    expect(() =>
      verifyBundleIntegrity(computed, {
        ...entry,
        worker_bundle_hash: 'sha256:other',
      }),
    ).toThrow(/worker hash mismatch/);
  });

  it('rejects tampered admin / liff files', () => {
    expect(() =>
      verifyBundleIntegrity(
        { ...computed, admin: 'sha256:evil' },
        entry,
      ),
    ).toThrow(/admin hash mismatch/);
    expect(() =>
      verifyBundleIntegrity(
        { ...computed, liff: 'sha256:evil' },
        entry,
      ),
    ).toThrow(/liff hash mismatch/);
  });

  it('rejects tampered Worker Assets', () => {
    expect(() =>
      verifyBundleIntegrity(
        { ...computed, workerAssets: 'sha256:evil' },
        entry,
      ),
    ).toThrow(/worker assets hash mismatch/);
  });
});
