import { prisma } from '@/lib/prisma';
import { verifyVersionByCode } from '@/lib/sgc/db/verify';
import { errorResponse, getSgcRequestContext, jsonNoStore } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/verify?empresa=3&codigo=OLP-GC-PR-001&version=2 — lo abre el
 * QR del PDF controlado: ¿esa versión sigue vigente? Exige sesión y acceso al
 * SGC de la empresa; queda en la auditoría.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const q = new URL(request.url).searchParams;
    return jsonNoStore(await verifyVersionByCode(prisma, ctx.access, ctx.subject, { idCompany: q.get('empresa'), code: q.get('codigo'), versionNumber: q.get('version') }, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'verificar');
  }
}
