import { canAuditAgents, getAuditScope } from "../../../../../../lib/chat/audit-access";
import { badRequest, jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../../lib/chat/http";
import { AnalisisSeguridadNoDisponible, pedirAnalisisSeguridad } from "../../../../../../lib/agent-audit/security-db";
import { periodoActual, periodoValido } from "../../../../../../lib/agent-audit/security-rules";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat/auditoria/seguridad/analizar { periodo } → botón «Analizar».
 * Deja una corrida pendiente (una sola a la vez); el analizador la toma en su siguiente
 * ronda (cada 5 min). Solo con alcance total de auditoría.
 */
export async function POST(request: Request) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
      return jsonNoStore({ error: "Solo la administración puede pedir un análisis de seguridad." }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { periodo?: unknown };
    const periodo = body.periodo ?? periodoActual();
    if (!periodoValido(periodo)) return badRequest("Mes no válido.");
    try {
      return jsonNoStore({ ok: true, corrida: await pedirAnalisisSeguridad(user.email, periodo) });
    } catch (e) {
      if (e instanceof AnalisisSeguridadNoDisponible) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/seguridad/analizar", error);
  }
}
