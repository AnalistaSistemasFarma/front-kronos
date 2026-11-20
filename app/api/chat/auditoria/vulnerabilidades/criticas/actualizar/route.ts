import type { NextRequest } from "next/server";
import { canAuditAgents, getAuditScope } from "../../../../../../../lib/chat/audit-access";
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../../../lib/chat/http";
import { isCollectorRequest } from "../../../../../../../lib/agent-audit/collector-auth";
import { requestSync, ThreatsUnavailable } from "../../../../../../../lib/agent-audit/threats-db";
import { runPendingSyncs } from "../../../../../../../lib/agent-audit/threats-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat/auditoria/vulnerabilidades/criticas/actualizar
 *   «Actualizar ahora» (administration) or a scheduler with the collector key (origin «programado»).
 *   Queues one refresh (only one at a time) and starts it in this server process.
 */
export async function POST(request: NextRequest) {
  try {
    let email: string | null = null;
    if (!isCollectorRequest(request)) {
      const user = await resolveSessionUser();
      if (!user) return unauthorized();
      if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
        return jsonNoStore({ error: "Solo la administración puede actualizar el catálogo." }, { status: 403 });
      email = user.email;
    }
    try {
      const job = await requestSync(email ? "manual" : "programado", email);
      void runPendingSyncs();
      return jsonNoStore({ ok: true, sync: job });
    } catch (e) {
      if (e instanceof ThreatsUnavailable) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/vulnerabilidades/criticas/actualizar", error);
  }
}
