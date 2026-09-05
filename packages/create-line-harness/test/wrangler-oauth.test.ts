import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getWranglerConfigDir,
  parseWranglerAuthToml,
  readWranglerOAuthToken,
} from '../src/lib/wrangler-oauth.js';

describe('getWranglerConfigDir', () => {
  const isDir = (dirs: string[]) => (p: string) => dirs.includes(p);

  it('prefers a pre-existing legacy ~/.wrangler directory', () => {
    const home = '/home/user';
    expect(
      getWranglerConfigDir({
        env: {},
        platform: 'linux',
        home,
        isDirectory: isDir([join(home, '.wrangler')]),
      }),
    ).toBe(join(home, '.wrangler'));
  });

  it('uses XDG_CONFIG_HOME when set (no legacy dir)', () => {
    expect(
      getWranglerConfigDir({
        env: { XDG_CONFIG_HOME: '/custom/config' },
        platform: 'linux',
        home: '/home/user',
        isDirectory: () => false,
      }),
    ).toBe(join('/custom/config', '.wrangler'));
  });

  it('falls back to ~/Library/Preferences on macOS', () => {
    expect(
      getWranglerConfigDir({
        env: {},
        platform: 'darwin',
        home: '/Users/u',
        isDirectory: () => false,
      }),
    ).toBe(join('/Users/u', 'Library', 'Preferences', '.wrangler'));
  });

  it('falls back to ~/.config on Linux', () => {
    expect(
      getWranglerConfigDir({
        env: {},
        platform: 'linux',
        home: '/home/user',
        isDirectory: () => false,
      }),
    ).toBe(join('/home/user', '.config', '.wrangler'));
  });

  it('uses %APPDATA%/xdg.config on Windows', () => {
    expect(
      getWranglerConfigDir({
        env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
        platform: 'win32',
        home: 'C:\\Users\\u',
        isDirectory: () => false,
      }),
    ).toBe(join('C:\\Users\\u\\AppData\\Roaming', 'xdg.config', '.wrangler'));
  });
});

describe('parseWranglerAuthToml', () => {
  it('extracts oauth_token and expiration_time', () => {
    const toml = [
      'oauth_token = "tok_123"',
      'refresh_token = "ref_456"',
      'expiration_time = "2099-01-01T00:00:00.000Z"',
      'scopes = ["account:read"]',
    ].join('\n');
    expect(parseWranglerAuthToml(toml)).toEqual({
      oauthToken: 'tok_123',
      expirationTime: '2099-01-01T00:00:00.000Z',
    });
  });

  it('returns nulls for an api-token-only or empty config', () => {
    expect(parseWranglerAuthToml('api_token = "x"\n')).toEqual({
      oauthToken: null,
      expirationTime: null,
    });
    expect(parseWranglerAuthToml('')).toEqual({
      oauthToken: null,
      expirationTime: null,
    });
  });
});

describe('readWranglerOAuthToken', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'clh-oauth-test-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function writeCredentials(content: string): void {
    const configDir = join(home, '.wrangler', 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'default.toml'), content);
  }

  const opts = () => ({ env: {}, platform: 'linux' as const, home });

  it('reads a live token from the legacy ~/.wrangler location', () => {
    writeCredentials(
      'oauth_token = "tok_live"\nexpiration_time = "2099-01-01T00:00:00.000Z"\n',
    );
    expect(readWranglerOAuthToken(opts())).toBe('tok_live');
  });

  it('returns null when the token is expired', () => {
    writeCredentials(
      'oauth_token = "tok_old"\nexpiration_time = "2000-01-01T00:00:00.000Z"\n',
    );
    expect(readWranglerOAuthToken(opts())).toBeNull();
  });

  it('accepts a token without expiration_time', () => {
    writeCredentials('oauth_token = "tok_noexp"\n');
    expect(readWranglerOAuthToken(opts())).toBe('tok_noexp');
  });

  it('returns null when the credentials file is missing', () => {
    expect(readWranglerOAuthToken(opts())).toBeNull();
  });

  it('returns null when the file has no oauth_token', () => {
    writeCredentials('api_token = "not-oauth"\n');
    expect(readWranglerOAuthToken(opts())).toBeNull();
  });
});
