import { describe, expect, it } from 'vitest';
import { normalizeBrazilPhone, normalizedText, parseCsv } from '../src/lib/server/csv';

describe('parseCsv', () => {
  it('parses a simple header + row', () => {
    const rows = parseCsv('title,phone\nAcme,11999998888\n');
    expect(rows).toEqual([
      ['title', 'phone'],
      ['Acme', '11999998888'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    const rows = parseCsv('title,address\n"Acme, Inc","Rua A, 123"\n');
    expect(rows).toEqual([
      ['title', 'address'],
      ['Acme, Inc', 'Rua A, 123'],
    ]);
  });

  it('handles escaped double quotes inside a quoted field', () => {
    const rows = parseCsv('title\n"Say ""hi"""\n');
    expect(rows).toEqual([['title'], ['Say "hi"']]);
  });

  it('handles quoted fields containing embedded newlines', () => {
    const rows = parseCsv('title,notes\nAcme,"line1\nline2"\n');
    expect(rows).toEqual([
      ['title', 'notes'],
      ['Acme', 'line1\nline2'],
    ]);
  });

  it('tolerates CRLF line endings', () => {
    const rows = parseCsv('title,phone\r\nAcme,11999998888\r\n');
    expect(rows).toEqual([
      ['title', 'phone'],
      ['Acme', '11999998888'],
    ]);
  });

  it('throws on an unterminated quoted field', () => {
    expect(() => parseCsv('title\n"unterminated')).toThrow(/unterminated/i);
  });

  it('drops fully blank rows', () => {
    const rows = parseCsv('title,phone\nAcme,11999998888\n,\n');
    expect(rows).toEqual([
      ['title', 'phone'],
      ['Acme', '11999998888'],
    ]);
  });

  // Regression test for the real bug found and fixed during the security migration
  // (`else if (char === '\n+')` instead of `else if (char === '\n')`), which silently broke
  // line-break recognition for every multi-row CSV.
  it('correctly splits multiple data rows (regression for the \\n+ parser bug)', () => {
    const rows = parseCsv('title,phone\nAcme,11999998888\nBeta,11888887777\nGamma,11777776666\n');
    expect(rows).toHaveLength(4);
    expect(rows[3]).toEqual(['Gamma', '11777776666']);
  });
});

describe('normalizeBrazilPhone', () => {
  it('accepts an 11-digit mobile number without country code and prefixes 55', () => {
    expect(normalizeBrazilPhone('11999998888')).toBe('+5511999998888');
  });

  it('accepts a 10-digit landline number without country code and prefixes 55', () => {
    expect(normalizeBrazilPhone('1133334444')).toBe('+551133334444');
  });

  it('accepts a number already carrying the 55 country code', () => {
    expect(normalizeBrazilPhone('5511999998888')).toBe('+5511999998888');
  });

  it('strips formatting characters before validating', () => {
    expect(normalizeBrazilPhone('(11) 99999-8888')).toBe('+5511999998888');
  });

  it('strips a leading 00 international prefix', () => {
    expect(normalizeBrazilPhone('0055 11 99999-8888')).toBe('+5511999998888');
  });

  it('rejects too-short input', () => {
    expect(normalizeBrazilPhone('1199')).toBeNull();
  });

  it('rejects non-Brazilian-shaped input', () => {
    expect(normalizeBrazilPhone('123')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(normalizeBrazilPhone('')).toBeNull();
  });
});

describe('normalizedText', () => {
  it('lowercases, strips accents, and collapses whitespace', () => {
    expect(normalizedText('  Bairro   Cinco Conjuntos  ')).toBe('bairro cinco conjuntos');
    expect(normalizedText('Coração')).toBe('coracao');
  });
});
