import { describe, expect, it } from 'vitest';
import {
  normalizeQuestion,
  isCacheableQuestion,
} from './llm-cache.js';
import { matchCannedResponse, CANNED_USAGE_OVERVIEW } from './groq-knowledge-content.js';

describe('normalizeQuestion', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeQuestion('  使い方  を  教えて  ')).toBe('使い方 を 教えて');
  });
});

describe('isCacheableQuestion', () => {
  it('allows canonical FAQ-style questions', () => {
    expect(isCacheableQuestion('使い方を教えて')).toBe(true);
  });

  it('rejects error-context messages', () => {
    expect(isCacheableQuestion('Google認証でエラーが出ました')).toBe(false);
  });

  it('rejects messages with email', () => {
    expect(isCacheableQuestion('info@example.com について')).toBe(false);
  });
});

describe('matchCannedResponse', () => {
  it('returns 4-step overview for usage questions', () => {
    const text = matchCannedResponse('使い方を教えて');
    expect(text).toBe(CANNED_USAGE_OVERVIEW);
    expect(text).toContain('STEP 1');
    expect(text).toContain('STEP 4');
  });

  it('returns null for unrelated text', () => {
    expect(matchCannedResponse('こんにちは')).toBeNull();
  });
});
