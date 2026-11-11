import { NextResponse } from 'next/server';
import { NO_STORE, adminErrorResponse, readJsonBody, requireApiClientAdmin } from '@/lib/api-permissions/access';
import { MAX_PERMISSION_COPY_TARGETS } from '@/lib/api-permissions/constants';
import { copyApiClientPermissions } from '@/lib/api-permissions/db';
import { parseRouteId } from '@/lib/api-permissions/rules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/administration/api-clients/[id]/copy-permissions  { targetIds: number[] }  (2026-11-11)
 * Pone a los clientes elegidos los MISMOS permisos de este (reemplaza los suyos), respetando las
 * reglas de cada uno: nivel de acceso, agente y tipo (permissionsForCopy). Responde qué recibió cada uno.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireApiClientAdmin();
  if (admin instanceof NextResponse) return admin;
  try {
    const sourceId = parseRouteId((await params).id);
    if (!sourceId) return NextResponse.json({ error: 'Cliente no válido' }, { status: 400, headers: NO_STORE });

    const body = await readJsonBody(request);
    const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const list = raw && Object.keys(raw).every((k) => k === 'targetIds') ? raw.targetIds : null;
    if (!Array.isArray(list) || list.length === 0) {
      return NextResponse.json({ error: 'Elige al menos un cliente' }, { status: 400, headers: NO_STORE });
    }
    if (list.length > MAX_PERMISSION_COPY_TARGETS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_PERMISSION_COPY_TARGETS} clientes por copia` },
        { status: 400, headers: NO_STORE }
      );
    }
    const targetIds = [...new Set(list.map((v) => (typeof v === 'number' ? parseRouteId(String(v)) : null)))];
    if (targetIds.some((v) => !v)) return NextResponse.json({ error: 'Clientes no válidos' }, { status: 400, headers: NO_STORE });
    const targets = (targetIds as number[]).filter((v) => v !== sourceId);
    if (targets.length === 0) {
      return NextResponse.json({ error: 'Elige clientes distintos de este' }, { status: 400, headers: NO_STORE });
    }

    const result = await copyApiClientPermissions(sourceId, targets, admin.email);
    if (result.status === 'source_not_found') {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404, headers: NO_STORE });
    }
    if (result.status === 'targets_not_found') {
      return NextResponse.json({ error: 'Los clientes elegidos ya no existen' }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, outcomes: result.outcomes }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, 'copy-permissions');
  }
}
