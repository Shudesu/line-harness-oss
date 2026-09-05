import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { putWorkerScript, type WorkerBinding } from '../src/cf-api/workers.js';

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

  // Regression: adoption/update flows re-send the bindings returned by
  // GET /bindings verbatim. That list contains secret_text entries WITHOUT
  // their values (CF never returns secret values), and the script upload
  // API rejects a textless secret_text binding with error 10021
  // "invalid or missing text property for binding <NAME>". Secrets must
  // instead be carried over via metadata.keep_bindings.
  it('drops textless secret_text bindings and inherits them via keep_bindings', async () => {
    await putWorkerScript({
      creds,
      scriptName: 'w',
      scriptContent: Buffer.from('export default {}'),
      bindings: [
        ...BINDINGS,
        { type: 'secret_text', name: 'ADMIN_ORIGIN' },
        { type: 'secret_text', name: 'WORKER_URL' },
        { type: 'secret_key', name: 'SIGNING_KEY' },
      ],
    });

    const metadata = await capturedMetadata(fetchMock);
    expect(metadata.bindings).toEqual(BINDINGS);
    expect(metadata.keep_bindings).toEqual(['secret_text', 'secret_key']);
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
