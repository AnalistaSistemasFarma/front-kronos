import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Build que sirve hoy el servidor (para que el navegador detecte versiones nuevas). */
export function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_SYNERLINK_BUILD_ID ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
