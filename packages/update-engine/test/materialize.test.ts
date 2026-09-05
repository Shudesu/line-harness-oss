import { describe, it, expect } from 'vitest';
import {
  ADMIN_URL_PLACEHOLDER,
  isTextAssetPath,
  materializeAdminFiles,
  findResidualPlaceholders,
  isBenignSchemaErrorText,
} from '../src/materialize.js';

const WORKER_URL = 'https://my-harness.example.workers.dev';

describe('isTextAssetPath', () => {
  it('classifies common Next.js export outputs', () => {
    expect(isTextAssetPath('index.html')).toBe(true);
    expect(isTextAssetPath('_next/static/chunks/main-abc123.js')).toBe(true);
    expect(isTextAssetPath('_next/static/css/app.css')).toBe(true);
    expect(isTextAssetPath('manifest.webmanifest')).toBe(true);
    expect(isTextAssetPath('chunks/page.js.map')).toBe(true);
  });

  it('treats binary and extension-less paths as non-text', () => {
    expect(isTextAssetPath('favicon.ico')).toBe(false);
    expect(isTextAssetPath('images/logo.png')).toBe(false);
    expect(isTextAssetPath('fonts/inter.woff2')).toBe(false);
    expect(isTextAssetPath('LICENSE')).toBe(false);
  });
});

describe('materializeAdminFiles', () => {
  it('replaces every occurrence of the placeholder in text files', () => {
    const js = `fetch("${ADMIN_URL_PLACEHOLDER}/api/friends");const base="${ADMIN_URL_PLACEHOLDER}";`;
    const files = new Map([['chunk.js', Buffer.from(js)]]);

    const out = materializeAdminFiles(files, WORKER_URL);

    const text = out.get('chunk.js')!.toString('utf8');
    expect(text).toBe(
      `fetch("${WORKER_URL}/api/friends");const base="${WORKER_URL}";`,
    );
    expect(text).not.toContain('__LH_');
  });

  it('strips trailing slashes from the worker URL (admin concatenates paths)', () => {
    const files = new Map([
      ['a.js', Buffer.from(`"${ADMIN_URL_PLACEHOLDER}/api"`)],
    ]);
    const out = materializeAdminFiles(files, `${WORKER_URL}/`);
    expect(out.get('a.js')!.toString('utf8')).toBe(`"${WORKER_URL}/api"`);
  });

  it('passes binary files through byte-for-byte even if bytes match the placeholder', () => {
    const png = Buffer.from(`\x89PNG${ADMIN_URL_PLACEHOLDER}`, 'latin1');
    const files = new Map([['logo.png', png]]);
    const out = materializeAdminFiles(files, WORKER_URL);
    expect(out.get('logo.png')).toBe(png);
  });

  it('does not mutate the input map or its buffers', () => {
    const original = Buffer.from(`x="${ADMIN_URL_PLACEHOLDER}"`);
    const files = new Map([['a.js', original]]);
    materializeAdminFiles(files, WORKER_URL);
    expect(files.get('a.js')!.toString('utf8')).toContain(ADMIN_URL_PLACEHOLDER);
  });

  it('reuses untouched buffers for text files without the placeholder', () => {
    const clean = Buffer.from('console.log(1)');
    const files = new Map([['a.js', clean]]);
    const out = materializeAdminFiles(files, WORKER_URL);
    expect(out.get('a.js')).toBe(clean);
  });
});

describe('findResidualPlaceholders', () => {
  it('reports text files that still contain a __LH_ marker, sorted', () => {
    const files = new Map([
      ['z.js', Buffer.from('const x = "__LH_FUTURE_THING__";')],
      ['a.html', Buffer.from('<a href="__LH_OTHER__">x</a>')],
      ['ok.js', Buffer.from('nothing here')],
      ['bin.png', Buffer.from('__LH_IN_BINARY__')],
    ]);
    expect(findResidualPlaceholders(files)).toEqual(['a.html', 'z.js']);
  });

  it('returns empty after a full materialization', () => {
    const files = new Map([
      ['a.js', Buffer.from(`"${ADMIN_URL_PLACEHOLDER}/api"`)],
    ]);
    const out = materializeAdminFiles(files, WORKER_URL);
    expect(findResidualPlaceholders(out)).toEqual([]);
  });
});

describe('isBenignSchemaErrorText', () => {
  it('matches duplicate-object errors from wrangler and the D1 REST API', () => {
    expect(isBenignSchemaErrorText('duplicate column name: score')).toBe(true);
    expect(isBenignSchemaErrorText('table "friends" already exists')).toBe(true);
    expect(
      isBenignSchemaErrorText('D1_ERROR: index idx_chats_friend already exists: SQLITE_ERROR'),
    ).toBe(true);
    expect(isBenignSchemaErrorText('Error: table friends already defined? ALREADY exists')).toBe(
      true,
    );
  });

  it('rejects real failures', () => {
    expect(isBenignSchemaErrorText('no such table: friends')).toBe(false);
    expect(isBenignSchemaErrorText('near "FRM": syntax error')).toBe(false);
    expect(isBenignSchemaErrorText('D1_ERROR: too many SQL variables')).toBe(false);
    expect(isBenignSchemaErrorText('')).toBe(false);
  });
});
