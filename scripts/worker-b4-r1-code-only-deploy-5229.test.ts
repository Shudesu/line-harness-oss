import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  B4Stop, buildContentUpload, loadManifest, validateApprovalWindow,
} from './worker-b4-r1-code-only-deploy-5229.js';

const ARTIFACT = '/Users/kensmba/.line-harness-5229-B4-BUILD-20260904-final1/index.js';

describe('worker B4-R1 code-only deploy controls', () => {
  it('uses the exact half-open two-hour approval interval', () => {
    expect(() => validateApprovalWindow(Date.parse('2026-09-04T00:50:00.301Z'))).not.toThrow();
    expect(() => validateApprovalWindow(Date.parse('2026-09-04T02:50:00.300Z'))).not.toThrow();
    expect(() => validateApprovalWindow(Date.parse('2026-09-04T00:50:00.300Z'))).toThrow(B4Stop);
    expect(() => validateApprovalWindow(Date.parse('2026-09-04T02:50:00.301Z'))).toThrow(B4Stop);
  });

  it('builds a single code-only multipart body around the pinned artifact', () => {
    const artifact = readFileSync(ARTIFACT);
    const upload = buildContentUpload(artifact).toString('utf8');
    const metadata = upload.split('Content-Disposition: form-data; name="worker.js"', 1)[0];
    expect(upload.match(/name="metadata"/g)).toHaveLength(1);
    expect(upload.match(/Content-Disposition: form-data; name="worker\.js"; filename="worker\.js"/g)).toHaveLength(1);
    expect(upload).toContain('{"main_module":"worker.js"}');
    expect(metadata).not.toContain('bindings');
    expect(upload).not.toContain('INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED');
  });

  it('rejects any artifact byte drift', () => {
    const artifact = Buffer.from(readFileSync(ARTIFACT));
    artifact[0] ^= 1;
    expect(() => buildContentUpload(artifact)).toThrow(B4Stop);
  });

  it('loads exactly 77 legacy paths plus a scoped private readback target', () => {
    const manifest = loadManifest();
    expect(manifest.legacyPaths).toHaveLength(77);
    expect(new Set(manifest.legacyPaths).size).toBe(77);
    expect(manifest.legacyPaths.every((path) => path.startsWith('/images/incoming-'))).toBe(true);
    expect(manifest.privateHeadPath).toContain('/api/incoming-media/');
    expect(manifest.privateContentPath).toBe(`${manifest.privateHeadPath}/content`);
  });

  it('keeps the final full drift snapshot after private probes and immediately before PUT', () => {
    const source = readFileSync(new URL('./worker-b4-r1-code-only-deploy-5229.ts', import.meta.url), 'utf8');
    const privateGet = source.indexOf('validatePrivateGet(await requestWorker', source.indexOf("const privateHeaders"));
    const finalSnapshot = source.indexOf('const finalPre = await getSnapshot', privateGet);
    const mutation = source.indexOf("mutationStage = 'content_put_in_flight'", finalSnapshot);
    expect(privateGet).toBeGreaterThan(0);
    expect(finalSnapshot).toBeGreaterThan(privateGet);
    expect(mutation).toBeGreaterThan(finalSnapshot);
    expect(source.slice(finalSnapshot, mutation)).not.toContain('requestWorker(');
  });
});
