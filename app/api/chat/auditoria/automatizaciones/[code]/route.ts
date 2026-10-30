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
  leerIndicadorAgente,
} from "../../../../../../lib/agent-audit/automation-db";

export const dynamic = "force-dynamic";

/** GET /api/chat/auditoria/automatizaciones/[code] → ficha del indicador de UN agente. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)))
      return jsonNoStore(
        {
          error: "La auditoría de agentes está reservada a la administración.",
        },
        { status: 403 },
      );
    const { code } = await params;
    const codigo = decodeURIComponent(code).trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,60}$/.test(codigo))
      return jsonNoStore({ error: "No encontrado." }, { status: 404 });
    try {
      const d = await leerIndicadorAgente(
        codigo,
        user.email,
        await getAuditScope(user.email),
      );
      if (!d) return jsonNoStore({ error: "No encontrado." }, { status: 404 });
      return jsonNoStore(d);
    } catch (e) {
      if (e instanceof IndicadorNoDisponible)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError(
      "GET /api/chat/auditoria/automatizaciones/[code]",
      error,
    );
  }
}
