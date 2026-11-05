import {
  canAuditAgents,
  canConfigureAgents,
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
import { leerProgramadas } from "../../../../../../lib/agent-audit/scheduled-db";

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
      const alcance = await getAuditScope(user.email);
      const [d, programadas, puedeAdministrar] = await Promise.all([
        leerIndicadorAgente(codigo, user.email, alcance),
        leerProgramadas(user.email, alcance, codigo),
        canConfigureAgents(user.email).catch(() => false),
      ]);
      if (d) return jsonNoStore({ ...d, programadas, puedeAdministrar });
      // Agente sin casos en el chat pero con automatizaciones programadas.
      const p = programadas?.[0];
      if (!p) return jsonNoStore({ error: "No encontrado." }, { status: 404 });
      return jsonNoStore({
        agente: {
          idAgent: p.idAgent,
          code: p.code,
          displayName: p.displayName,
          empresa: p.empresa,
          departamento: null,
          casos: 0,
          casosValidos: 0,
          ocurrencias: 0,
          horasAntes: 0,
          horasDespues: 0,
          horasAhorradas: 0,
          horasMes: 0,
          reduccion: null,
        },
        casos: [],
        corte: null,
        periodoDesde: null,
        programadas,
        puedeAdministrar,
      });
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
