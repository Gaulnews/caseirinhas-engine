import { describe, expect, it } from 'vitest';
import { orderedTemplateParameters, parseTemplateParameters, validateTemplateParameters } from '../src/lib/server/campaign-template';

describe('validateTemplateParameters', () => {
  it('accepts a well-formed positional object', () => {
    expect(validateTemplateParameters({ '1': 'segunda-feira', '2': 'Bife à parmegiana', '3': 'R$ 22,00' })).toEqual({
      '1': 'segunda-feira',
      '2': 'Bife à parmegiana',
      '3': 'R$ 22,00',
    });
  });

  it('rejects non-object input', () => {
    expect(validateTemplateParameters('not an object')).toBeNull();
    expect(validateTemplateParameters(null)).toBeNull();
    expect(validateTemplateParameters(undefined)).toBeNull();
    expect(validateTemplateParameters(42)).toBeNull();
  });

  it('rejects arrays', () => {
    expect(validateTemplateParameters(['a', 'b'])).toBeNull();
  });

  it('rejects an empty object', () => {
    expect(validateTemplateParameters({})).toBeNull();
  });

  it('rejects non-positional keys — this is the guard against arbitrary free text smuggled in as a key', () => {
    expect(validateTemplateParameters({ message: 'anything I want to say' })).toBeNull();
    expect(validateTemplateParameters({ '0': 'zero is not a valid WhatsApp template position' })).toBeNull();
    expect(validateTemplateParameters({ '01': 'leading zero' })).toBeNull();
  });

  it('rejects non-string or empty values', () => {
    expect(validateTemplateParameters({ '1': 42 })).toBeNull();
    expect(validateTemplateParameters({ '1': '' })).toBeNull();
    expect(validateTemplateParameters({ '1': null })).toBeNull();
  });

  it('rejects values longer than 500 characters', () => {
    expect(validateTemplateParameters({ '1': 'a'.repeat(501) })).toBeNull();
    expect(validateTemplateParameters({ '1': 'a'.repeat(500) })).not.toBeNull();
  });

  it('rejects more than 10 parameters', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 1), `value${i}`]));
    expect(validateTemplateParameters(tooMany)).toBeNull();
  });
});

describe('parseTemplateParameters', () => {
  it('parses a valid JSON string', () => {
    expect(parseTemplateParameters('{"1": "a", "2": "b"}')).toEqual({ '1': 'a', '2': 'b' });
  });

  it('returns null for malformed JSON', () => {
    expect(parseTemplateParameters('{not json')).toBeNull();
  });

  it('returns null for non-string input (e.g. FormDataEntryValue File)', () => {
    expect(parseTemplateParameters(null)).toBeNull();
    expect(parseTemplateParameters(undefined)).toBeNull();
  });

  it('returns null for a blank string', () => {
    expect(parseTemplateParameters('   ')).toBeNull();
  });
});

describe('orderedTemplateParameters', () => {
  it('orders values numerically by key, not lexicographically', () => {
    expect(orderedTemplateParameters({ '10': 'ten', '2': 'two', '1': 'one' })).toEqual(['one', 'two', 'ten']);
  });

  it('handles a single parameter', () => {
    expect(orderedTemplateParameters({ '1': 'only' })).toEqual(['only']);
  });
});
