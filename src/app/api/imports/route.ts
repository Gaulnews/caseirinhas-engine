import { NextRequest, NextResponse } from 'next/server';
import { normalizeBrazilPhone, normalizedText, parseCsv } from '../../../lib/server/csv';
import { requireAdminApiToken, supabaseRest } from '../../../lib/server/supabase-rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CHUNK_SIZE = 50;

type Candidate = { rowNumber: number; raw: Record<string, string>; companyName: string; neighborhood: string | null; phone: string | null; reason: string | null };

function column(row: string[], headers: string[], names: string[]) {
  for (const name of names) { const index = headers.indexOf(name); if (index >= 0) return row[index] ?? ''; }
  return '';
}

async function json(response: Response) { return response.json().catch(() => null); }

export async function POST(request: NextRequest) {
  if (!requireAdminApiToken(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.csv')) return NextResponse.json({ error: 'Attach a .csv file in the file field' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'CSV must be between 1 byte and 2 MiB' }, { status: 400 });

  let matrix: string[][];
  try { matrix = parseCsv((await file.text()).replace(/^\uFEFF/, '')); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid CSV' }, { status: 400 }); }
  if (matrix.length < 2) return NextResponse.json({ error: 'CSV must contain a header and at least one data row' }, { status: 400 });

  const headers = matrix[0].map((header) => normalizedText(header));
  const candidates: Candidate[] = matrix.slice(1).map((row, index) => {
    const raw = Object.fromEntries(headers.map((header, position) => [header, row[position] ?? '']));
    const companyName = column(row, headers, ['title', 'name', 'nome']).trim();
    const phone = normalizeBrazilPhone(column(row, headers, ['phone', 'phoneunformatted', 'phonenumber', 'telefone']));
    const neighborhood = column(row, headers, ['neighborhood', 'bairro']).trim() || null;
    return { rowNumber: index + 2, raw, companyName, neighborhood, phone, reason: !companyName ? 'missing_company_name' : !phone ? 'invalid_phone' : null };
  });

  const createImport = await supabaseRest('lead_imports', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ original_filename: file.name.slice(0, 255), storage_path: `transient://csv/${crypto.randomUUID()}`, source: 'google_places', status: 'processing', total_rows: candidates.length }]) });
  const imports = await json(createImport);
  const importId = Array.isArray(imports) ? imports[0]?.id : null;
  if (!createImport.ok || !importId) return NextResponse.json({ error: 'Unable to create import batch' }, { status: 502 });

  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  let accepted = 0; let rejected = 0;

  for (let start = 0; start < candidates.length; start += CHUNK_SIZE) {
    const chunk = candidates.slice(start, start + CHUNK_SIZE);
    const usable = chunk.filter((candidate) => {
      if (candidate.reason) return false;
      if (seen.has(candidate.phone!)) { candidate.reason = 'duplicate_in_file'; return false; }
      seen.add(candidate.phone!); return true;
    });
    const phones = usable.map((candidate) => candidate.phone!);
    const existing = new Set<string>();
    const optedOut = new Set<string>();
    if (phones.length) {
      const list = phones.join(',');
      const [leadResult, optOutResult] = await Promise.all([supabaseRest(`leads?select=phone_e164&phone_e164=in.(${list})`), supabaseRest(`opt_outs?select=phone_e164&phone_e164=in.(${list})`)]);
      for (const item of (await json(leadResult)) ?? []) existing.add(item.phone_e164);
      for (const item of (await json(optOutResult)) ?? []) optedOut.add(item.phone_e164);
    }
    const insertable = usable.filter((candidate) => {
      if (optedOut.has(candidate.phone!)) { candidate.reason = 'existing_opt_out'; return false; }
      if (existing.has(candidate.phone!)) { candidate.reason = 'duplicate_in_database'; return false; }
      return true;
    });
    const insertedByPhone = new Map<string, string>();
    if (insertable.length) {
      const insert = await supabaseRest('leads', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(insertable.map((candidate) => ({ import_id: importId, company_name: candidate.companyName, normalized_name: normalizedText(candidate.companyName), phone_e164: candidate.phone, neighborhood: candidate.neighborhood, source: 'google_places', legal_basis: 'pending_legal_review', purpose: 'b2b_prospecting_pending_review', status: 'pending_review' }))) });
      const inserted = await json(insert);
      if (!insert.ok) { for (const candidate of insertable) candidate.reason = 'database_insert_failed'; }
      else for (const item of inserted ?? []) insertedByPhone.set(item.phone_e164, item.id);
    }
    for (const candidate of chunk) {
      const leadId = candidate.phone ? insertedByPhone.get(candidate.phone) : undefined;
      const outcome = leadId ? 'accepted' : candidate.reason?.startsWith('duplicate') ? 'duplicate' : candidate.reason ? 'rejected' : 'rejected';
      if (leadId) accepted += 1; else rejected += 1;
      rows.push({ import_id: importId, row_number: candidate.rowNumber, raw_data: candidate.raw, outcome, reason: leadId ? null : candidate.reason ?? 'not_inserted', lead_id: leadId ?? null });
    }
  }

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const result = await supabaseRest('lead_import_rows', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows.slice(start, start + CHUNK_SIZE)) });
    if (!result.ok) return NextResponse.json({ error: 'Import completed but audit row persistence failed', importId }, { status: 502 });
  }

  await supabaseRest(`lead_imports?id=eq.${importId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'completed', accepted_rows: accepted, rejected_rows: rejected, completed_at: new Date().toISOString() }) });
  return NextResponse.json({ success: true, importId, totalRows: candidates.length, acceptedRows: accepted, rejectedRows: rejected, status: 'pending_review_only' }, { status: 201 });
}
