import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function retired() {
  return NextResponse.json(
    {
      success: false,
      code: 'LEGACY_DISPATCH_RETIRED',
      message: 'O disparo legado foi desativado durante a migração de segurança.',
    },
    { status: 410 },
  );
}

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}
