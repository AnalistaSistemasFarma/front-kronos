import { prisma } from '../../../../../../lib/prisma';
import { grantDocumentAccess } from '../../../../../../lib/sgc/db/documents';
import { errorResponse, getSgcRequestContext, jsonNoStore } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/documents/<id>/access — otorga consulta a un departamento o
 * persona, o un permiso EXCEPCIONAL de descarga/impresión (con vencimiento
 * obligatorio). Solo Calidad; exige motivo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const saved = await grantDocumentAccess(prisma, ctx.access, Number(id), body, ctx.actor);
    return jsonNoStore({ saved }, 201);
  } catch (error) {
    return errorResponse(error, 'documents:acceso');
  }
}
