import { canAuditAgents, getAuditScope } from "../../../../../../../lib/chat/audit-access";
import { badRequest, jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../../../lib/chat/http";
import { createItem, ThreatsUnavailable } from "../../../../../../../lib/agent-audit/threats-db";
import { InventoryValidationError, parseInventoryInput } from "../../../../../../../lib/agent-audit/threats-rules";

export const dynamic = "force-dynamic";

/** POST /api/chat/auditoria/vulnerabilidades/criticas/inventario — adds a third-party product (administration only). */
export async function POST(request: Request) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
      return jsonNoStore({ error: "Solo la administración edita el inventario." }, { status: 403 });
    try {
      const item = await createItem(parseInventoryInput(await request.json().catch(() => ({}))), user.email);
      return jsonNoStore({ ok: true, item });
    } catch (e) {
      if (e instanceof InventoryValidationError) return badRequest(e.message);
      if (e instanceof ThreatsUnavailable) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/vulnerabilidades/criticas/inventario", error);
  }
}
