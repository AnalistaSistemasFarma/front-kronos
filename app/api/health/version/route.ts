import { NextResponse } from 'next/server';

// Build id served by this process. components/errors/UpdateRecovery.tsx uses it
// to know whether the server already has a new version. It lives under
// /api/health/ so IIS lets it through even with the maintenance page on.
// No sensitive data.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { buildId: process.env.APP_BUILD_ID ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
