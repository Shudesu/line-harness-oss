import { describe, expect, it } from 'vitest';
import { allowsLegacyXForm } from './legacy-x-form-policy.js';

describe('legacy form compatibility boundary', () => {
  it('requires an explicit exact form identity', () => {
    expect(allowsLegacyXForm(' form-one,form-two ', 'form-one')).toBe(true);
    expect(allowsLegacyXForm('form-one,form-two', 'form')).toBe(false);
    expect(allowsLegacyXForm('*', 'form-one')).toBe(false);
  });
  it('is off when unconfigured or empty', () => {
    expect(allowsLegacyXForm(undefined, 'form-one')).toBe(false);
    expect(allowsLegacyXForm('', 'form-one')).toBe(false);
    expect(allowsLegacyXForm(',', '')).toBe(false);
  });
});
