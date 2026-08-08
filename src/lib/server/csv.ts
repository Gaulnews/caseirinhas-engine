export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell.trim()); cell = ''; }
    else if (char === '
') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else if (char !== '') cell += char;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (cell.length > 0 || row.length > 0) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((values) => values.some(Boolean));
}

export function normalizeBrazilPhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  const phone = `+${digits}`;
  return /^\+55\d{10,11}$/.test(phone) ? phone : null;
}

export function normalizedText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
