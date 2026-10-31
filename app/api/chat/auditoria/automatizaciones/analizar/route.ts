import {
  canAuditAgents,
  getAuditScope,
} from "../../../../../../lib/chat/audit-access";
import {
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from "../../../../../../lib/chat/http";
import {
  IndicadorNoDisponible,
  pedirAnalisis,
} from "../../../../../../lib/agent-audit/automation-db";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat/auditoria/automatizaciones/analizar → botón «Analizar ahora».
 * Deja una corrida pendiente (una sola a la vez); el analizador la toma en su
 * siguiente ronda. Solo con alcance total de auditoría.
 */
export async function POST() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (
      !(await canAuditAgents(user.email)) ||
      !(await getAuditScope(user.email)).all
    )
      return jsonNoStore(
        { error: "Solo la administración puede pedir un análisis." },
        { status: 403 },
      );
    try {
      return jsonNoStore({
        ok: true,
        corrida: await pedirAnalisis(user.email),
      });
    } catch (e) {
      if (e instanceof IndicadorNoDisponible)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError(
      "POST /api/chat/auditoria/automatizaciones/analizar",
      error,
    );
  }
}
