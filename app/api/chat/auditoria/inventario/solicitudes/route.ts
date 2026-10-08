import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { jsonNoStore, NO_STORE, serverError } from '../../../../../../lib/chat/http';
import { isCollectorRequest } from '../../../../../../lib/agent-audit/collector-auth';
import { vencerSolicitudesColgadas } from '../../../../../../lib/agent-audit/inventory-db';

export const dynamic = 'force-dynamic';

/**
 * El RECOLECTOR toma la siguiente solicitud de escaneo pendiente.
 *
 *   POST /api/chat/auditoria/inventario/solicitudes   → SOLO el recolector.
 *
 * Respuesta: { solicitud: { id } } o { solicitud: null } si no hay nada.
 * La toma es atómica (UPDATE … WHERE status = 'pendiente'): si dos rondas del
 * recolector se cruzan, solo una se queda con la solicitud.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    await vencerSolicitudesColgadas();

    const siguiente = await prisma.agentScanRequest.findFirst({
      where: { status: 'pendiente' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!siguiente) return jsonNoStore({ solicitud: null });

    const tomada = await prisma.agentScanRequest.updateMany({
      where: { id: siguiente.id, status: 'pendiente' },
      data: { status: 'en_curso', started_at: new Date() },
    });
    if (tomada.count !== 1) return jsonNoStore({ solicitud: null });

    return jsonNoStore({ solicitud: { id: siguiente.id } });
  } catch (error) {
    return serverError('POST /api/chat/auditoria/inventario/solicitudes', error);
  }
}
