/**
 * A campaign's `template_parameters` is a JSON object with string keys "1", "2", ... mapping to
 * the approved WhatsApp template's {{1}}, {{2}}, ... body variables (see docs/SECURITY_MIGRATION.md
 * "Structured template parameters"). It is never free text spliced into the template — that would
 * let staff turn an approved template into an arbitrary marketing message, which is both a WhatsApp
 * policy violation and exactly the "template laundering" risk this module exists to close off.
 */
export type TemplateParameters = Record<string, string>;

const MAX_PARAMETERS = 10;
const MAX_VALUE_LENGTH = 500;

/** Parses and validates a JSON blob from a form/API body. Returns null when invalid. */
export function parseTemplateParameters(raw: unknown): TemplateParameters | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateTemplateParameters(parsed);
}

export function validateTemplateParameters(value: unknown): TemplateParameters | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_PARAMETERS) return null;

  const result: TemplateParameters = {};
  const positions = new Set<number>();
  for (const [key, val] of entries) {
    if (!/^[1-9][0-9]*$/.test(key)) return null; // only positional keys "1", "2", ... — no arbitrary field names
    if (typeof val !== 'string' || val.length === 0 || val.length > MAX_VALUE_LENGTH) return null;
    positions.add(Number(key));
    result[key] = val;
  }

  // Positions must be contiguous starting at 1 ({"2": "x"} or {"1": "a", "3": "c"} are both
  // rejected). orderedTemplateParameters() below compacts whatever keys are present into a
  // 0-indexed array for WhatsApp's positional {{1}}, {{2}}, ... slots — a gap would silently
  // shift every parameter after it into the wrong slot instead of failing loudly.
  for (let position = 1; position <= entries.length; position += 1) {
    if (!positions.has(position)) return null;
  }

  return result;
}

/** Converts {"1": "a", "2": "b"} into ["a", "b"] — the ordered shape WhatsApp's template API expects. */
export function orderedTemplateParameters(parameters: TemplateParameters): string[] {
  return Object.keys(parameters)
    .map(Number)
    .sort((a, b) => a - b)
    .map((key) => parameters[String(key)]);
}
