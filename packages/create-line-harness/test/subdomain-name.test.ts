import { describe, it, expect } from 'vitest';
import {
  isValidSubdomainName,
  sanitizeSubdomainCandidate,
  subdomainFromWorkersDevUrl,
} from '../src/lib/subdomain-name.js';

describe('isValidSubdomainName', () => {
  it('accepts typical names', () => {
    expect(isValidSubdomainName('line-harness')).toBe(true);
    expect(isValidSubdomainName('a')).toBe(true);
    expect(isValidSubdomainName('a1')).toBe(true);
    expect(isValidSubdomainName('my-bot-2')).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(isValidSubdomainName('')).toBe(false);
    expect(isValidSubdomainName('-leading')).toBe(false);
    expect(isValidSubdomainName('trailing-')).toBe(false);
    expect(isValidSubdomainName('UPPER')).toBe(false);
    expect(isValidSubdomainName('has.dot')).toBe(false);
    expect(isValidSubdomainName('a'.repeat(64))).toBe(false);
    expect(isValidSubdomainName('a'.repeat(63))).toBe(true);
  });
});

describe('sanitizeSubdomainCandidate', () => {
  it('passes through already-valid project names', () => {
    expect(sanitizeSubdomainCandidate('line-harness')).toBe('line-harness');
  });

  it('lowercases and replaces invalid characters', () => {
    expect(sanitizeSubdomainCandidate('My_Cool Bot!')).toBe('my-cool-bot');
  });

  it('collapses runs of hyphens and trims edges', () => {
    expect(sanitizeSubdomainCandidate('--a--b--')).toBe('a-b');
  });

  it('truncates to 63 chars without leaving a trailing hyphen', () => {
    const long = 'ab-'.repeat(30); // 90 chars, position 63 lands after a hyphen
    const out = sanitizeSubdomainCandidate(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(63);
    expect(isValidSubdomainName(out!)).toBe(true);
  });

  it('returns null when nothing usable remains', () => {
    expect(sanitizeSubdomainCandidate('---')).toBeNull();
    expect(sanitizeSubdomainCandidate('日本語だけ')).toBeNull();
    expect(sanitizeSubdomainCandidate('')).toBeNull();
  });
});

describe('subdomainFromWorkersDevUrl', () => {
  it('extracts the account subdomain from a workers.dev URL', () => {
    expect(
      subdomainFromWorkersDevUrl('https://line-harness.acc.workers.dev'),
    ).toBe('acc');
    expect(
      subdomainFromWorkersDevUrl('https://my-bot.example-team.workers.dev/health'),
    ).toBe('example-team');
  });

  it('returns null for custom domains and unparsable input', () => {
    expect(subdomainFromWorkersDevUrl('https://bot.example.com')).toBeNull();
    // Bare account-subdomain URL (no worker label) — nothing to extract.
    expect(subdomainFromWorkersDevUrl('https://acc.workers.dev')).toBeNull();
    expect(subdomainFromWorkersDevUrl('not a url')).toBeNull();
  });
});
