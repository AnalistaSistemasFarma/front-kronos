import { canAuditAgents } from '../../../../../lib/chat/audit-access';
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import catalogo from '../../../../../lib/agent-audit/skills-catalog.json';

export const dynamic = 'force-dynamic';

/**
 * CATÁLOGO DE SKILLS DE LA FLOTA — pestaña "Skills" de la Auditoría de agentes.
 *
 *   GET /api/chat/auditoria/skills
 *
 * El dato sale de un JSON versionado (lib/agent-audit/skills-catalog.json) que
 * se regenera con scripts/agent-skills-catalog.py, escaneando por SSH los
 * equipos de la flota. La aplicación no tiene acceso a esos equipos, por eso
 * no se consulta en vivo.
 *
 * Misma reja que /api/chat/auditoria: el catálogo dice qué sabe hacer cada
 * agente y en qué equipo corre, así que se reserva a quien puede auditar.
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await canAuditAgents(user.email))) {
      return jsonNoStore(
        { error: 'La auditoría de agentes está reservada a la administración.' },
        { status: 403 }
      );
    }

    return jsonNoStore(catalogo);
  } catch (error) {
    return serverError('auditoria-skills', error);
  }
}
