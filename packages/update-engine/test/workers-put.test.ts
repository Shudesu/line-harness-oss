import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listWorkerBindings, putWorkerScript, type WorkerBinding } from '../src/cf-api/workers.js';

const creds = { accountId: 'acc', apiToken: 'tok' };

const BINDINGS: WorkerBinding[] = [
  { type: 'd1', name: 'DB', database_id: 'd1id' },
  { type: 'assets', name: 'ASSETS' },
];

/** Capture the metadata part of the multipart PUT body as parsed JSON. */
async function capturedMetadata(
  fetchMock: ReturnType<typeof vi.fn>,
): Promise<Record<string, unknown>> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const fd = init.body as FormData;
  const blob = fd.get('metadata') as Blob;
  return JSON.parse(await blob.text()) as Record<string, unknown>;
}

describe('putWorkerScript metadata', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('omits keep_assets and compatibility_flags by default (legacy call shape)', async () => {
    await putWorkerScript({
      creds,
      scriptName: 'w',
      scriptContent: Buffer.from('export default {}'),
      bindings: BINDINGS,
    });

    const metadata = await capturedMetadata(fetchMock);
    expect(metadata.main_module).toBe('worker.js');
    expect(metadata.compatibility_date).toBe('2024-12-01');
    expect(metadata.bindings).toEqual(BINDINGS);
    expect(metadata).not.toHaveProperty('keep_assets');
    expect(metadata).not.toHaveProperty('compatibility_flags');
  });

  it('sends keep_assets + compatibility_flags when requested', async () => {
    await putWorkerScript({
      creds,
      scriptName: 'w',
      scriptContent: Buffer.from('export default {}'),
      bindings: BINDINGS,
      keepAssets: true,
      compatibilityFlags: ['nodejs_compat'],
    });

    const metadata = await capturedMetadata(fetchMock);
    expect(metadata.keep_assets).toBe(true);
    expect(metadata.compatibility_flags).toEqual(['nodejs_compat']);
  });

  it('attaches a new assets JWT and adds the ASSETS binding when absent', async () => {
    await putWorkerScript({
      creds,
      scriptName: 'w',
      scriptContent: Buffer.from('export default {}'),
      bindings: [{ type: 'd1', name: 'DB', database_id: 'd1id' }],
      assets: { jwt: 'assets-jwt', binding: 'ASSETS', runWorkerFirst: true },
    });

    const metadata = await capturedMetadata(fetchMock);
    expect(metadata.assets).toEqual({
      jwt: 'assets-jwt',
      config: { run_worker_first: true },
    });
    expect(metadata.bindings).toEqual([
      { type: 'd1', name: 'DB', database_id: 'd1id' },
      { type: 'assets', name: 'ASSETS' },
    ]);
    expect(metadata).not.toHaveProperty('keep_assets');
  });

  it('rejects contradictory keepAssets + assets options', async () => {
    await expect(
      putWorkerScript({
        creds,
        scriptName: 'w',
        scriptContent: Buffer.from('export default {}'),
        bindings: BINDINGS,
        keepAssets: true,
        assets: { jwt: 'assets-jwt' },
      }),
    ).rejects.toThrow(/cannot be used together/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits compatibility_flags when the list is empty', async () => {
    await putWorkerScript({
      creds,
      scriptName: 'w',
      scriptContent: Buffer.from('export default {}'),
      bindings: [],
      compatibilityFlags: [],
    });

    const metadata = await capturedMetadata(fetchMock);
    expect(metadata).not.toHaveProperty('compatibility_flags');
  });

  it('preserves write-only bindings when updating a Worker with assets', async () => {
    const listedBindings = [
      ...BINDINGS,
      { type: 'secret_text', name: 'WORKER_URL' },
      { type: 'secret_text', name: 'ADMIN_ORIGIN' },
      { type: 'secret_key', name: 'SIGNING_KEY' },
    ];
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit) => {
      expect(url).toMatch(/\/scripts\/w\/bindings$/);
      expect(init.method).toBe('GET');
      return Response.json({ success: true, result: listedBindings });
    });
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit) => {
      expect(url).toMatch(/\/scripts\/w$/);
      expect(init.method).toBe('PUT');
      const metadataPart = (init.body as FormData).get('metadata') as Blob;
      const metadata = JSON.parse(await metadataPart.text());
      if (metadata.bindings.some((binding: WorkerBinding) =>
        binding.type === 'secret_text' && typeof binding.text !== 'string'
      )) {
        return Response.json({
          success: false,
          errors: [{ code: 10021, message: 'invalid or missing text property' }],
        }, { status: 400 });
      }
      expect(metadata.bindings).toEqual(BINDINGS);
      expect(metadata.keep_bindings).toEqual(['secret_text', 'secret_key']);
      expect(metadata.assets).toEqual({
        jwt: 'assets-jwt',
        config: { run_worker_first: true },
      });
      return Response.json({ success: true });
    });

    const bindings = await listWorkerBindings({ creds, scriptName: 'w' });
    expect(bindings).toEqual(listedBindings);
    await putWorkerScript({
      creds,
      scriptName: 'w',
      scriptContent: Buffer.from('export default {}'),
      bindings,
      assets: { jwt: 'assets-jwt' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps secret_text bindings that carry an explicit text value', async () => {
    const withValue: WorkerBinding = {
      type: 'secret_text',
      name: 'NEW_SECRET',
      text: 's3cret',
    };
    await putWorkerScript({
      creds,
      scriptName: 'w',
      scriptContent: Buffer.from('export default {}'),
      bindings: [withValue],
    });

    const metadata = await capturedMetadata(fetchMock);
    expect(metadata.bindings).toEqual([withValue]);
  });

  it('uploads the script bytes unchanged as the worker.js module part', async () => {
    const script = Buffer.from('export default {fetch(){}}');
    await putWorkerScript({
      creds,
      scriptName: 'w',
      scriptContent: script,
      bindings: [],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const fd = init.body as FormData;
    const blob = fd.get('worker.js') as Blob;
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(script);
    expect(blob.type).toBe('application/javascript+module');
  });
});
