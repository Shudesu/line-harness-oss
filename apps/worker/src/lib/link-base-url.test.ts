import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock ───────────────────────────────────────────────────────────────────
// We mock only the getLinkBaseUrl helper from @line-crm/db so the test
// exercises resolveLinkBaseUrl without a real D1 binding.

const dbMocks = {
  getLinkBaseUrl: vi.fn<() => Promise<string | null>>(),
};

vi.mock('@line-crm/db', () => dbMocks);

// Import after mock registration.
const { resolveLinkBaseUrl } = await import('./link-base-url.js');

const DB = {} as D1Database;
const ENV_WITH_WORKER_URL = { WORKER_URL: 'https://worker.example.com' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveLinkBaseUrl', () => {
  describe('no DB setting configured', () => {
    beforeEach(() => {
      dbMocks.getLinkBaseUrl.mockResolvedValue(null);
    });

    it('falls back to WORKER_URL + /r', async () => {
      const base = await resolveLinkBaseUrl(DB, ENV_WITH_WORKER_URL);
      expect(base).toBe('https://worker.example.com/r');
    });

    it('strips trailing slash from WORKER_URL before appending /r', async () => {
      const base = await resolveLinkBaseUrl(DB, { WORKER_URL: 'https://worker.example.com/' });
      expect(base).toBe('https://worker.example.com/r');
    });

    it('forms a full affiliate link correctly', async () => {
      const base = await resolveLinkBaseUrl(DB, ENV_WITH_WORKER_URL);
      expect(`${base}/abc123`).toBe('https://worker.example.com/r/abc123');
    });

    it('throws when WORKER_URL is empty and no DB setting exists', async () => {
      await expect(resolveLinkBaseUrl(DB, { WORKER_URL: '' })).rejects.toThrow(
        'WORKER_URL is not configured',
      );
    });

    it('throws when WORKER_URL is undefined and no DB setting exists', async () => {
      await expect(resolveLinkBaseUrl(DB, {})).rejects.toThrow(
        'WORKER_URL is not configured',
      );
    });
  });

  describe('custom short domain configured in DB', () => {
    beforeEach(() => {
      dbMocks.getLinkBaseUrl.mockResolvedValue('https://go.example.com');
    });

    it('returns the stored domain', async () => {
      const base = await resolveLinkBaseUrl(DB, ENV_WITH_WORKER_URL);
      expect(base).toBe('https://go.example.com');
    });

    it('forms a full affiliate link correctly (no /r in path)', async () => {
      const base = await resolveLinkBaseUrl(DB, ENV_WITH_WORKER_URL);
      expect(`${base}/abc123`).toBe('https://go.example.com/abc123');
    });

    it('uses the stored domain even when WORKER_URL is missing', async () => {
      // If a custom domain is set, WORKER_URL is irrelevant and must not throw.
      const base = await resolveLinkBaseUrl(DB, {});
      expect(base).toBe('https://go.example.com');
    });

    it('always queries under the __global__ sentinel account ID', async () => {
      await resolveLinkBaseUrl(DB, ENV_WITH_WORKER_URL);
      expect(dbMocks.getLinkBaseUrl).toHaveBeenCalledWith(DB, '__global__');
    });
  });
});
