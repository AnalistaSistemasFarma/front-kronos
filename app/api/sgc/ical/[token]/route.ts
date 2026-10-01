import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auditOrigin } from '@/lib/sgc/audit';
import { getIcalFeed } from '@/lib/sgc/db/ical';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/ical/<token> — calendario iCal PRIVADO de solo lectura (sin
 * sesión: lo consulta Outlook). El token es secreto (32 bytes aleatorios; en
 * la base solo su SHA-256). Token inválido, revocado o persona sin acceso →
 * 404, sin decir por qué. Cada consulta queda en la auditoría.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const clean = token.replace(/\.ics$/i, '');
    const origin = auditOrigin(request);
    const ics = await getIcalFeed(prisma, clean, { ...origin, appUrl: process.env.NEXTAUTH_URL || new URL(request.url).origin });
    if (!ics) return new NextResponse('No encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return new NextResponse(ics, {
      status: 200,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="sgc-vencimientos.ics"', 'X-Robots-Tag': 'noindex' },
    });
  } catch (error) {
    console.error('[sgc/ical:feed]', error);
    return new NextResponse('Error', { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
