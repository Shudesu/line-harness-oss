import { describe, expect, it } from 'vitest';
import { getEffectiveLocationParts } from './url-params.js';

const origin = 'https://example.com';
const liffId = '1234567890-example';

describe('getEffectiveLocationParts', () => {
  it('uses direct query params when LINE does not wrap them', () => {
    const parts = getEffectiveLocationParts({
      origin,
      pathname: '/',
      search: `?liffId=${liffId}&ref=fashion-bank-lp`,
    });

    expect(parts.pathname).toBe('/');
    expect(parts.params.get('liffId')).toBe(liffId);
    expect(parts.params.get('ref')).toBe('fashion-bank-lp');
  });

  it('restores LIFF params from liff.state wrapper', () => {
    const state = encodeURIComponent(`/?liffId=${liffId}&ref=fashion-bank-lp&gate=g1`);
    const parts = getEffectiveLocationParts({
      origin,
      pathname: '/',
      search: `?liff.state=${state}`,
    });

    expect(parts.pathname).toBe('/');
    expect(parts.params.get('liffId')).toBe(liffId);
    expect(parts.params.get('ref')).toBe('fashion-bank-lp');
    expect(parts.params.get('gate')).toBe('g1');
  });

  it('restores path and params from a wrapped LIFF state path', () => {
    const state = encodeURIComponent('/book?liffId=abc-def&ref=campaign');
    const parts = getEffectiveLocationParts({
      origin,
      pathname: '/',
      search: `?liff.state=${state}`,
    });

    expect(parts.pathname).toBe('/book');
    expect(parts.params.get('liffId')).toBe('abc-def');
    expect(parts.params.get('ref')).toBe('campaign');
  });

  it('lets explicit URL params override wrapped state params', () => {
    const state = encodeURIComponent('/?liffId=old&ref=wrapped');
    const parts = getEffectiveLocationParts({
      origin,
      pathname: '/',
      search: `?liff.state=${state}&ref=direct`,
    });

    expect(parts.params.get('liffId')).toBe('old');
    expect(parts.params.get('ref')).toBe('direct');
  });
});
