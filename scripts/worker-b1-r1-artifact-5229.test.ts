import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { LEGACY_UNKNOWN_HASH, restampArtifact } from './worker-b1-r1-artifact-5229.js';

const SOURCE_FILE =
  '/Users/kensmba/.line-harness-5229-B1-BUILD-20260902/apps/worker/dist-release-final/index.js';
const OLD_ADMIN_HASH = 'sha256:43e9888fa37af2db1ecdd2f135029ddb570279ebf07373b47d6cb5e62a25ac6c';
const OLD_LIFF_HASH = 'sha256:350e651bacbede38ea9f197d0ae6e29903c5b3b219daccf4c62566310cc7ce17';

describe('Worker B1-R1 artifact restamp', () => {
  test('changes only the two legacy asset identity fields and is deterministic', () => {
    const source = readFileSync(SOURCE_FILE);
    const first = restampArtifact(source);
    const second = restampArtifact(source);
    const output = first.toString('utf8');

    expect(first.equals(second)).toBe(true);
    expect(first.length).toBe(source.length);
    expect(first.equals(source)).toBe(false);
    expect(output).not.toContain(OLD_ADMIN_HASH);
    expect(output).not.toContain(OLD_LIFF_HASH);
    expect(output.split(LEGACY_UNKNOWN_HASH).length - 1).toBe(2);

    let changed = 0;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== first[index]) changed += 1;
    }
    expect(changed).toBe(121);
  });

  test('fails closed for any nonexact source artifact', () => {
    const changed = Buffer.from(readFileSync(SOURCE_FILE));
    changed[0] ^= 1;
    expect(() => restampArtifact(changed)).toThrow(/bytes\/hash mismatch/);
  });
});
