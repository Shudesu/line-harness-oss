import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildCredentialArtifacts,
  writeCredentialArtifacts,
} from './incoming-media-service-credential.js';

const INPUT = {
  accountId: 'acc-1',
  label: 'accounting recovery',
  notBefore: '2026-08-31T00:00:00Z',
  expiresAt: '2026-11-29T00:00:00Z',
  createdAt: '2026-08-31T00:01:00Z',
  credentialId: 'a'.repeat(32),
  secret: 'b'.repeat(64),
};

describe('incoming-media service credential planner', () => {
  test('separates the one-time plaintext from hash-only review artifacts', () => {
    const artifacts = buildCredentialArtifacts(INPUT);
    const token = `lhim_v1.${INPUT.credentialId}.${INPUT.secret}`;
    expect(artifacts['credential.env']).toContain(token);
    expect(artifacts['apply.sql']).not.toContain(token);
    expect(artifacts['apply.sql']).not.toContain(INPUT.secret);
    expect(artifacts['manifest.json']).not.toContain(token);
    expect(artifacts['manifest.json']).not.toContain(INPUT.secret);
    expect(artifacts['apply.sql']).toContain('incoming_media_read');
    expect(JSON.parse(artifacts['manifest.json'])).toMatchObject({
      credential_id: INPUT.credentialId,
      line_account_id: INPUT.accountId,
      d1_insert_count: 1,
      provider_calls: 0,
    });
  });

  test('writes a new owner-only directory and owner-only files', () => {
    const root = mkdtempSync(join(tmpdir(), 'incoming-media-credential-'));
    const output = join(root, 'artifacts');
    const previousUmask = process.umask(0o022);
    try {
      writeCredentialArtifacts(buildCredentialArtifacts(INPUT), output);
      expect(lstatSync(output).mode & 0o777).toBe(0o700);
      for (const name of readdirSync(output)) {
        expect(lstatSync(join(output, name)).mode & 0o777).toBe(0o600);
      }
      expect(readFileSync(join(output, 'credential.env'), 'utf8')).toContain('lhim_v1.');
      expect(() => writeCredentialArtifacts(buildCredentialArtifacts(INPUT), output))
        .toThrow(/must not already contain files/);
    } finally {
      process.umask(previousUmask);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects unsafe scope and unsafe output directories', () => {
    expect(() => buildCredentialArtifacts({ ...INPUT, accountId: 'acc/1' }))
      .toThrow(/SAFE_IDENTIFIER/);
    expect(() => buildCredentialArtifacts({ ...INPUT, expiresAt: INPUT.notBefore }))
      .toThrow(/earlier/);
    expect(() => buildCredentialArtifacts({ ...INPUT, notBefore: '2026-08-31' }))
      .toThrow(/UTC timestamp/);

    const root = mkdtempSync(join(tmpdir(), 'incoming-media-credential-'));
    const output = join(root, 'open');
    try {
      mkdirSync(output, { mode: 0o700 });
      chmodSync(output, 0o755);
      expect(() => writeCredentialArtifacts(buildCredentialArtifacts(INPUT), output))
        .toThrow(/0700/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
