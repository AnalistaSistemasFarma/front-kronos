import {
  canAuditAgents,
  getAuditScope,
} from "../../../../../lib/chat/audit-access";
import {
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from "../../../../../lib/chat/http";
import {
  CasosNoDisponibles,
  leerCasosDeUso,
} from "../../../../../lib/agent-audit/use-cases-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/auditoria/casos-de-uso → sesión + permiso de auditoría.
 * El corte más reciente de la matriz por agente: para qué se usa, lo que ha hecho
 * (con su recurrencia medida) y lo que está haciendo. Alcance por empresa de la
 * auditoría; los agentes personales solo para su dueño.
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email))) {
      return jsonNoStore(
        {
          error: "La auditoría de agentes está reservada a la administración.",
        },
        { status: 403 },
      );
    }
    const alcance = await getAuditScope(user.email);
    try {
      return jsonNoStore(await leerCasosDeUso(user.email, alcance));
    } catch (err) {
      if (err instanceof CasosNoDisponibles)
        return jsonNoStore({ error: err.message }, { status: 503 });
      throw err;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/casos-de-uso", error);
  }
}
