import { describe, expect, it } from 'vitest';
import { getKnowledgePack } from './knowledge-packs.js';

describe('getKnowledgePack', () => {
  it('returns the ai-shain pack for ai-shain-link', () => {
    const pack = getKnowledgePack('ai-shain-link');
    expect(pack.project).toBe('ai-shain-link');
  });

  it('returns the soushin-suggest pack for soushin-suggest', () => {
    const pack = getKnowledgePack('soushin-suggest');
    expect(pack.project).toBe('soushin-suggest');
  });

  it('returns the henshin-hisho pack for henshin-hisho', () => {
    const pack = getKnowledgePack('henshin-hisho');
    expect(pack.project).toBe('henshin-hisho');
  });

  it('falls back to the default project pack for an unknown project id (fail-closed)', () => {
    const pack = getKnowledgePack('nonexistent-project');
    expect(pack.project).toBe('ai-shain-link');
  });
});

describe('henshin-hisho knowledge pack guardrails', () => {
  it('answers with usage overview for "使い方を教えて"', () => {
    const pack = getKnowledgePack('henshin-hisho');
    const answer = pack.matchCannedResponse('使い方を教えて');
    expect(answer).toContain('Chrome拡張');
  });

  it('does not claim Android is usable now (未配信を「使える」と言わない)', () => {
    const pack = getKnowledgePack('henshin-hisho');
    const prompt = pack.buildSystemPrompt('');
    expect(prompt).toContain('審査中');
    expect(prompt).toContain('未配信のプラットフォームを「使える」と案内しない');
  });

  it('states that sending is always done by the user (代行禁止)', () => {
    const pack = getKnowledgePack('henshin-hisho');
    const prompt = pack.buildSystemPrompt('');
    expect(prompt).toContain('送信は必ずユーザー本人が行う');
  });

  it('distinguishes bot role from acting on behalf of the user\'s customers (立場の区別)', () => {
    const pack = getKnowledgePack('henshin-hisho');
    const prompt = pack.buildSystemPrompt('');
    expect(prompt).toContain('利用者の顧客');
  });

  it('provides a fail-closed escalation text', () => {
    const pack = getKnowledgePack('henshin-hisho');
    expect(pack.getFailClosedEscalationText()).toContain('担当者');
  });
});
