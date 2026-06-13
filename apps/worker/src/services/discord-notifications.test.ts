import { describe, expect, it } from 'vitest';
import { reservationNoteForDiscord } from './discord-notifications.js';

describe('reservationNoteForDiscord', () => {
  it('reads note from reservation form_data', () => {
    const note = reservationNoteForDiscord({
      form_data: JSON.stringify({ note: '犬連れで伺います' }),
      metadata: '{}',
    });

    expect(note).toBe('犬連れで伺います');
  });

  it('falls back to Japanese note keys in metadata', () => {
    const note = reservationNoteForDiscord({
      form_data: '{}',
      metadata: JSON.stringify({ 備考: '到着が少し遅れるかもしれません' }),
    });

    expect(note).toBe('到着が少し遅れるかもしれません');
  });

  it('falls back to nested customer metadata', () => {
    const note = reservationNoteForDiscord({
      form_data: '{}',
      metadata: JSON.stringify({ customer: { ご要望: 'ベビーカーあり' } }),
    });

    expect(note).toBe('ベビーカーあり');
  });

  it('returns empty text when no note exists', () => {
    const note = reservationNoteForDiscord({
      form_data: '{}',
      metadata: '{}',
    });

    expect(note).toBe('');
  });

  it('truncates long notes for Discord field limits', () => {
    const note = reservationNoteForDiscord({
      form_data: JSON.stringify({ note: 'a'.repeat(1200) }),
      metadata: '{}',
    });

    expect(note).toHaveLength(1000);
    expect(note.endsWith('...')).toBe(true);
  });
});
