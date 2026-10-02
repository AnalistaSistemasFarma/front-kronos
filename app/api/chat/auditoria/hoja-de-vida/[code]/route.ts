import { canAuditAgents, canConfigureAgents } from '../../../../../../lib/chat/audit-access';
import {
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../../lib/chat/http';
import { leerHojaDeVida } from '../../../../../../lib/agent-audit/cv-db';

export const dynamic = 'force-dynamic';

/**
 * HOJA DE VIDA DE UN AGENTE (Auditoría de agentes, F2).
 *
 *   GET /api/chat/auditoria/hoja-de-vida/<code>   → sesión + permiso de auditoría.
 *
 * Propósito, dueño, usuarios asignados, inventario vigente, reglas, métricas,
 * historial, hallazgos y resúmenes semanales. NO devuelve el texto de las
 * conversaciones: solo conteos y fechas (ver lib/agent-audit/cv-db.ts).
 * `puedeConfigurar` le dice a la pantalla si muestra el botón de editar; la
 * reja real está en PUT …/perfil.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email))) {
      return jsonNoStore(
        { error: 'La auditoría de agentes está reservada a la administración.' },
        { status: 403 }
      );
    }
    const { code } = await params;
    const ficha = await leerHojaDeVida(decodeURIComponent(code).toLowerCase());
    if (!ficha) return jsonNoStore({ error: 'No existe ese agente.' }, { status: 404 });
    return jsonNoStore({ ...ficha, puedeConfigurar: await canConfigureAgents(user.email) });
  } catch (error) {
    return serverError('GET /api/chat/auditoria/hoja-de-vida/[code]', error);
  }
}
