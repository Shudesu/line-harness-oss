import { describe, expect, it } from 'vitest';
import { buildLiffLaunchUrls } from './liff-launch.js';

describe('buildLiffLaunchUrls', () => {
  it('preserves campaign and ad parameters', () => {
    const urls = buildLiffLaunchUrls(
      'https://worker.example.com/?liffId=200-abc&ref=lh-main&gclid=click-1',
      '200-abc',
    );

    expect(urls.canonical).toBe(
      'https://liff.line.me/200-abc?ref=lh-main&gclid=click-1',
    );
    expect(urls.ios).toBe('line://app/200-abc?ref=lh-main&gclid=click-1');
    expect(urls.android).toContain(
      'intent://liff.line.me/200-abc?ref=lh-main&gclid=click-1#Intent;',
    );
  });

  it('unpacks the initial liff.state redirect without leaking internal parameters', () => {
    const urls = buildLiffLaunchUrls(
      'https://worker.example.com/?liffId=200-abc&liff.state=%2F%3Fref%3Dlh-main%26fbclid%3Dmeta-1',
      '200-abc',
    );

    expect(urls.canonical).toBe(
      'https://liff.line.me/200-abc?ref=lh-main&fbclid=meta-1',
    );
    expect(urls.canonical).not.toContain('liff.state');
    expect(urls.canonical).not.toContain('liffId');
  });

  it('keeps a LIFF sub-path', () => {
    const urls = buildLiffLaunchUrls(
      'https://worker.example.com/?liffId=200-abc&liff.state=%2Fevents%2Fevent-1%3Futm_source%3Dline',
      '200-abc',
    );

    expect(urls.canonical).toBe(
      'https://liff.line.me/200-abc/events/event-1?utm_source=line',
    );
  });
});
