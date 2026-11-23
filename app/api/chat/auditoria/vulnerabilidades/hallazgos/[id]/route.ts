import { canAuditAgents, getAuditScope } from "../../../../../../../lib/chat/audit-access";
import { badRequest, jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../../../lib/chat/http";
import { revisarVuln, VulnsNoDisponible } from "../../../../../../../lib/agent-audit/vulns-db";
import { esEstadoVuln } from "../../../../../../../lib/agent-audit/vulns-rules";

export const dynamic = "force-dynamic";

/** PATCH /api/chat/auditoria/vulnerabilidades/hallazgos/:id { estado, nota? } — solo administración. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
      return jsonNoStore({ error: "Solo la administración revisa vulnerabilidades." }, { status: 403 });
    const { id } = await ctx.params;
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return badRequest("Hallazgo no válido.");
    const body = (await request.json().catch(() => ({}))) as { estado?: unknown; nota?: unknown };
    if (!esEstadoVuln(body.estado)) return badRequest("Estado no válido.");
    const nota = typeof body.nota === "string" ? body.nota.trim().slice(0, 1000) || null : null;
    try {
      if (!(await revisarVuln(n, body.estado, nota, user.email))) return jsonNoStore({ error: "Hallazgo no encontrado." }, { status: 404 });
      return jsonNoStore({ ok: true });
    } catch (e) {
      if (e instanceof VulnsNoDisponible) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("PATCH /api/chat/auditoria/vulnerabilidades/hallazgos/[id]", error);
  }
}
