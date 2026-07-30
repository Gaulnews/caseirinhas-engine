import { NextResponse } from 'next/server';
export const runtime = 'edge';
export async function GET(request: Request) {
  return NextResponse.json({ success: true, message: 'Cron via Vercel Edge ativado. WPP 43999821401' });
}
