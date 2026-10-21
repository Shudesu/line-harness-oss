import { describe, expect, it } from 'vitest';
import { buildMessage as buildBroadcastMessage } from './broadcast.js';
import { buildMessage as buildScenarioMessage, messageToLogPayload } from './step-delivery.js';

const imageContent = JSON.stringify({ originalContentUrl: 'https://example.test/original.jpg', previewImageUrl: 'https://example.test/preview.jpg' });
const flexContent = JSON.stringify({ type: 'bubble', body: { type: 'box', contents: [
  { type: 'text', text: '' },
  { type: 'text', text: '予約のお知らせ' },
] } });

describe.each([
  { name: 'broadcast', build: buildBroadcastMessage },
  { name: 'scenario', build: buildScenarioMessage },
])('$name message contract', ({ build }) => {
  it('preserves text exactly, including whitespace and punctuation', () => {
    expect(build('text', '  A,, B\n[]  ')).toEqual({ type: 'text', text: '  A,, B\n[]  ' });
  });
  it.each(['image', 'flex', 'unknown'])('falls back to the original text for %s with invalid JSON', (type) => {
    expect(build(type, '{invalid')).toEqual({ type: 'text', text: '{invalid' });
  });
  it('keeps original and preview image URLs separate', () => {
    expect(build('image', imageContent)).toEqual({ type: 'image', ...JSON.parse(imageContent) });
  });
  it('uses an explicit altText and retains the Flex structure', () => {
    const content = JSON.stringify({ type: 'bubble', body: { type: 'box', contents: [{ type: 'text', text: '本文' }] } });
    expect(build('flex', content, '通知用テキスト')).toEqual({ type: 'flex', altText: '通知用テキスト', contents: JSON.parse(content) });
  });
  it('derives missing or empty altText, and keeps an explicit whitespace value', () => {
    const content = JSON.stringify({ type: 'bubble', body: { type: 'box', contents: [{ type: 'text', text: '本文' }] } });
    expect(build('flex', content)).toMatchObject({ type: 'flex', altText: '本文' });
    expect(build('flex', content, '')).toMatchObject({ type: 'flex', altText: '本文' });
    expect(build('flex', content, ' ')).toMatchObject({ type: 'flex', altText: ' ' });
  });
  it('uses the established notification fallback when Flex has no text', () => {
    expect(build('flex', '{"type":"bubble"}')).toMatchObject({ type: 'flex', altText: 'お知らせ' });
  });
});

it('preserves empty Flex nodes for broadcasts while scenarios clean them before deriving altText', () => {
  const broadcast = buildBroadcastMessage('flex', flexContent);
  const scenario = buildScenarioMessage('flex', flexContent);
  expect(broadcast).toEqual({ type: 'flex', contents: JSON.parse(flexContent), altText: '予約のお知らせ' });
  expect(scenario).toEqual({ type: 'flex', altText: '予約のお知らせ', contents: {
    type: 'bubble', body: { type: 'box', contents: [{ type: 'text', text: '予約のお知らせ' }] },
  } });
});

it('logs the scenario payload after empty-node cleanup and logs parse failures as text', () => {
  const message = buildScenarioMessage('flex', flexContent);
  expect(messageToLogPayload(message)).toEqual({ messageType: 'flex', content: JSON.stringify({
    type: 'bubble', body: { type: 'box', contents: [{ type: 'text', text: '予約のお知らせ' }] },
  }) });
  expect(messageToLogPayload(buildScenarioMessage('image', '{invalid'))).toEqual({ messageType: 'text', content: '{invalid' });
  expect(messageToLogPayload(buildScenarioMessage('image', imageContent))).toEqual({ messageType: 'image', content: imageContent });
});
