import { describe, it, expect, beforeEach } from 'vitest';
import {
  WranglerError,
  setAccountId,
  workersOnboardingUrl,
} from '../src/lib/wrangler.js';

const ACCOUNT_ID = 'a'.repeat(32);
const SUBDOMAIN_ERROR =
  'wrangler deploy failed: ✘ [ERROR] You need to register a workers.dev subdomain before publishing to workers.dev';

describe('workersOnboardingUrl', () => {
  it('embeds the account ID when available', () => {
    expect(workersOnboardingUrl(ACCOUNT_ID)).toBe(
      `https://dash.cloudflare.com/${ACCOUNT_ID}/workers/onboarding`,
    );
  });

  it('falls back to the account-resolving deep link without an account ID', () => {
    expect(workersOnboardingUrl(undefined)).toBe(
      'https://dash.cloudflare.com/?to=/:account/workers/onboarding',
    );
  });
});

describe('WranglerError.getHelp — workers.dev subdomain registration', () => {
  beforeEach(() => {
    // Reset module-level account ID (empty string is treated as unset).
    setAccountId('');
  });

  it('maps the unregistered-subdomain error to registration guidance', () => {
    const help = new WranglerError(SUBDOMAIN_ERROR, '').getHelp();
    expect(help).toContain('workers.dev サブドメインが未登録です');
    expect(help).toContain('/workers/onboarding');
    expect(help).toContain('同じコマンドを再実行');
    expect(help).toContain('DNS 反映に数分かかる');
  });

  it('detects the error when it only appears on stderr', () => {
    const help = new WranglerError(
      'wrangler deploy failed: exit code 1',
      'You need to register a workers.dev subdomain before publishing to workers.dev',
    ).getHelp();
    expect(help).toContain('workers.dev サブドメインが未登録です');
  });

  it('embeds the account ID in the onboarding URL once setAccountId was called', () => {
    setAccountId(ACCOUNT_ID);
    const help = new WranglerError(SUBDOMAIN_ERROR, '').getHelp();
    expect(help).toContain(
      `https://dash.cloudflare.com/${ACCOUNT_ID}/workers/onboarding`,
    );
  });

  it('links the generic dashboard deep link when no account ID is known', () => {
    const help = new WranglerError(SUBDOMAIN_ERROR, '').getHelp();
    expect(help).toContain(
      'https://dash.cloudflare.com/?to=/:account/workers/onboarding',
    );
  });

  it('suppresses the non-interactive "CLI bug" hint for the subdomain case', () => {
    // Wrangler tries to prompt for registration and then fails with a
    // non-interactive error — the subdomain guidance is the real fix.
    const help = new WranglerError(
      SUBDOMAIN_ERROR,
      'This command cannot be run in a non-interactive context',
    ).getHelp();
    expect(help).toContain('workers.dev サブドメインが未登録です');
    expect(help).not.toContain('Issue で報告');
  });

  it('keeps the non-interactive hint for unrelated non-interactive errors', () => {
    const help = new WranglerError(
      'wrangler deploy failed: This command cannot be run in a non-interactive context',
      '',
    ).getHelp();
    expect(help).toContain('Issue で報告');
  });

  it('returns null for unrelated errors', () => {
    const help = new WranglerError(
      'wrangler deploy failed: something else entirely',
      '',
    ).getHelp();
    expect(help).toBeNull();
  });
});
