import { describe, it, expect } from 'vitest';
import { safeRedirectTarget } from './safe-redirect';

describe('safeRedirectTarget', () => {
  it('allows http(s) absolute URLs (tracked-link / marketing destinations are intentional)', () => {
    expect(safeRedirectTarget('https://example.com/lp')).toBe('https://example.com/lp');
    expect(safeRedirectTarget('http://example.com')).toBe('http://example.com');
  });

  it('allows root-relative paths', () => {
    expect(safeRedirectTarget('/thanks')).toBe('/thanks');
    expect(safeRedirectTarget('/r/abc?x=1')).toBe('/r/abc?x=1');
  });

  it('allows non-dangerous app/deep-link schemes (funnels must not break)', () => {
    expect(safeRedirectTarget('line://ti/p/@abc')).toBe('line://ti/p/@abc');
    expect(safeRedirectTarget('tel:08012345678')).toBe('tel:08012345678');
    expect(safeRedirectTarget('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    expect(safeRedirectTarget('myapp://open/path')).toBe('myapp://open/path');
  });

  it('rejects dangerous schemes', () => {
    expect(safeRedirectTarget('javascript:alert(1)')).toBeNull();
    expect(safeRedirectTarget('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeRedirectTarget('vbscript:msgbox(1)')).toBeNull();
    expect(safeRedirectTarget('file:///etc/passwd')).toBeNull();
  });

  it('rejects protocol-relative URLs (ambiguous scheme)', () => {
    expect(safeRedirectTarget('//evil.com')).toBeNull();
    expect(safeRedirectTarget('//evil.com/path')).toBeNull();
  });

  it('rejects backslash protocol-relative bypass (browsers normalize \\ to /)', () => {
    expect(safeRedirectTarget('/\\evil.com')).toBeNull();
    expect(safeRedirectTarget('/\\/evil.com')).toBeNull();
    expect(safeRedirectTarget('\\\\evil.com')).toBeNull();
  });

  it('rejects targets containing control characters', () => {
    expect(safeRedirectTarget('/path\nSet-Cookie: x')).toBeNull();
    expect(safeRedirectTarget('/foo\tbar')).toBeNull();
    expect(safeRedirectTarget('https://example.com/\r\nevil')).toBeNull();
  });

  it('rejects empty / malformed input', () => {
    expect(safeRedirectTarget('')).toBeNull();
    expect(safeRedirectTarget('not a url')).toBeNull();
    expect(safeRedirectTarget('   ')).toBeNull();
  });

  it('tolerates leading/trailing whitespace around an otherwise valid target', () => {
    expect(safeRedirectTarget('  https://example.com  ')).toBe('https://example.com');
  });
});
