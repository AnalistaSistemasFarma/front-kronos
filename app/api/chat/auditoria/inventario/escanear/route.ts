import { prisma } from '../../../../../../lib/prisma';
import { canAuditAgents } from '../../../../../../lib/chat/audit-access';
import {
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../../lib/chat/http';
import { vencerSolicitudesColgadas } from '../../../../../../lib/agent-audit/inventory-db';

export const dynamic = 'force-dynamic';

/**
 * BOTÓN "RE-ESCANEAR" de la pestaña Inventario.
 *
 *   POST /api/chat/auditoria/inventario/escanear   → sesión + permiso de auditoría.
 *
 * La aplicación no tiene acceso a los equipos de la flota (no debe tenerlo):
 * aquí solo se deja una SOLICITUD pendiente. El recolector de la Mac de horus
 * la toma en su siguiente ronda (cada pocos minutos), escanea y publica.
 *
 * Una sola solicitud viva a la vez: si ya hay una pendiente o en curso, se
 * devuelve esa en vez de encolar otra (evita que varios clics disparen varios
 * escaneos por SSH a toda la flota).
 */
export async function POST() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await canAuditAgents(user.email))) {
      return jsonNoStore(
        {
          error: 'La auditoría de agentes está reservada a la administración.',
        },
        { status: 403 }
      );
    }

    await vencerSolicitudesColgadas();

    const viva = await prisma.agentScanRequest.findFirst({
      where: { status: { in: ['pendiente', 'en_curso'] } },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, requested_at: true },
    });
    if (viva) {
      return jsonNoStore({
        ok: true,
        yaExistia: true,
        solicitud: {
          id: viva.id,
          status: viva.status,
          requestedAt: viva.requested_at.toISOString(),
        },
      });
    }

    const nueva = await prisma.agentScanRequest.create({
      data: { origin: 'manual', status: 'pendiente', requested_by: user.email },
      select: { id: true, status: true, requested_at: true },
    });
    return jsonNoStore(
      {
        ok: true,
        yaExistia: false,
        solicitud: {
          id: nueva.id,
          status: nueva.status,
          requestedAt: nueva.requested_at.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return serverError('POST /api/chat/auditoria/inventario/escanear', error);
  }
}
