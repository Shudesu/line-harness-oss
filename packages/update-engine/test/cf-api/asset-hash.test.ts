import { describe, expect, it } from 'vitest';
import { hashWorkerAsset, normalizeAssetPath } from '../../src/cf-api/asset-hash.js';

describe('hashWorkerAsset', () => {
  it('matches the known Wrangler Workers Assets hash for a fixed input', () => {
    // Same vector as cf-api/assets.test.ts — this file is the canonical
    // implementation both assets.ts and the WfP bundle builder import.
    expect(hashWorkerAsset('index.html', Buffer.from('hello'))).toBe(
      'a2b82584e50075886b08927390f2f573',
    );
  });

  it('is a 32-char lowercase hex string', () => {
    const hash = hashWorkerAsset('app.js', Buffer.from('console.log(1)'));
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('changes when the extension changes but the bytes are identical', () => {
    const content = Buffer.from('same bytes');
    const html = hashWorkerAsset('logo.html', content);
    const svg = hashWorkerAsset('logo.svg', content);
    expect(html).not.toBe(svg);
  });

  it('changes when the content changes but the path is identical', () => {
    const a = hashWorkerAsset('a.txt', Buffer.from('one'));
    const b = hashWorkerAsset('a.txt', Buffer.from('two'));
    expect(a).not.toBe(b);
  });
});

describe('normalizeAssetPath', () => {
  it('adds a single leading slash', () => {
    expect(normalizeAssetPath('index.html')).toBe('/index.html');
  });

  it('strips a leading ./', () => {
    expect(normalizeAssetPath('./index.html')).toBe('/index.html');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizeAssetPath('assets\\app.js')).toBe('/assets/app.js');
  });

  it('collapses an existing leading slash to exactly one', () => {
    expect(normalizeAssetPath('/assets/app.css')).toBe('/assets/app.css');
  });

  it('rejects path traversal', () => {
    expect(() => normalizeAssetPath('../secret')).toThrow(/invalid Workers Asset path/);
  });

  it('rejects an empty path', () => {
    expect(() => normalizeAssetPath('')).toThrow(/invalid Workers Asset path/);
  });
});
