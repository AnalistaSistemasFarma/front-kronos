import { canAuditAgents, getAuditScope, getAuditTextScope } from "../../../../../../../lib/chat/audit-access";
import { badRequest, forbidden, jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../../../lib/chat/http";
import { AnalisisSeguridadNoDisponible, revisarHallazgo } from "../../../../../../../lib/agent-audit/security-db";
import { esEstado, textoSeguro } from "../../../../../../../lib/agent-audit/security-rules";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/chat/auditoria/seguridad/hallazgos/:id { estado, nota? } → revisión humana
 * (revisado, falso positivo, escalado). Exige poder leer el texto de las conversaciones:
 * no se revisa lo que no se puede ver.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email))) return forbidden("La auditoría de agentes está reservada a la administración.");
    const alcance = await getAuditScope(user.email);
    const texto = await getAuditTextScope(user.email, alcance);
    if (!texto) return forbidden("Revisar hallazgos exige el permiso de conversaciones de la auditoría.");
    const { id } = await ctx.params;
    const idFinding = Number(id);
    if (!Number.isInteger(idFinding) || idFinding <= 0) return badRequest("Hallazgo no válido.");
    const body = (await request.json().catch(() => ({}))) as { estado?: unknown; nota?: unknown };
    if (!esEstado(body.estado)) return badRequest("Estado no válido.");
    try {
      const ok = await revisarHallazgo(idFinding, body.estado, textoSeguro(body.nota, 1000), user.email, texto);
      if (!ok) return jsonNoStore({ error: "Hallazgo no encontrado." }, { status: 404 });
      return jsonNoStore({ ok: true });
    } catch (e) {
      if (e instanceof AnalisisSeguridadNoDisponible) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("PATCH /api/chat/auditoria/seguridad/hallazgos/[id]", error);
  }
}
