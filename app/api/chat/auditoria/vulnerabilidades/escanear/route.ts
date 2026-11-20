import { canAuditAgents, getAuditScope } from "../../../../../../lib/chat/audit-access";
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../../lib/chat/http";
import { pedirEscaneo, VulnsNoDisponible } from "../../../../../../lib/agent-audit/vulns-db";

export const dynamic = "force-dynamic";

/** POST /api/chat/auditoria/vulnerabilidades/escanear → botón «Escanear ahora» (solo administración). */
export async function POST() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
      return jsonNoStore({ error: "Solo la administración puede pedir un escaneo." }, { status: 403 });
    try {
      return jsonNoStore({ ok: true, escaneo: await pedirEscaneo("manual", user.email) });
    } catch (e) {
      if (e instanceof VulnsNoDisponible) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/vulnerabilidades/escanear", error);
  }
}
