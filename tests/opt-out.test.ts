import { describe, expect, it } from 'vitest';
import { detectOptOutKeyword, isValidE164 } from '../src/lib/server/opt-out';

describe('isValidE164', () => {
  it('accepts a well-formed E.164 Brazilian number', () => {
    expect(isValidE164('+5511999998888')).toBe(true);
  });

  it('rejects numbers missing the leading +', () => {
    expect(isValidE164('5511999998888')).toBe(false);
  });

  it('rejects numbers with a leading zero after the +', () => {
    expect(isValidE164('+0511999998888')).toBe(false);
  });

  it('rejects too-short numbers', () => {
    expect(isValidE164('+551199')).toBe(false);
  });

  it('rejects non-numeric characters', () => {
    expect(isValidE164('+55 11 99999-8888')).toBe(false);
  });
});

describe('detectOptOutKeyword', () => {
  it.each(['sair', 'SAIR', 'Sair', 'parar', 'stop', 'remover', 'cancelar'])(
    'detects the exact keyword "%s" (case-insensitive)',
    (keyword) => {
      expect(detectOptOutKeyword(keyword)).toBe(keyword.toLowerCase());
    },
  );

  it('detects a keyword followed by extra words', () => {
    expect(detectOptOutKeyword('sair por favor')).toBe('sair');
    expect(detectOptOutKeyword('PARAR de enviar')).toBe('parar');
  });

  it('is accent-insensitive', () => {
    expect(detectOptOutKeyword('cancélar')).toBe('cancelar');
  });

  it('does not match a keyword embedded inside another word', () => {
    expect(detectOptOutKeyword('vou parargora')).toBeNull();
    expect(detectOptOutKeyword('pararcerta hora')).toBeNull();
  });

  it('returns null for ordinary conversational text', () => {
    expect(detectOptOutKeyword('Qual o cardápio de hoje?')).toBeNull();
    expect(detectOptOutKeyword('Obrigado, vou querer o prato feito')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(detectOptOutKeyword('')).toBeNull();
  });
});
