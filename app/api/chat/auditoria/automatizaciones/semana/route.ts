import { NextRequest } from "next/server";
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
  leerDetalleSemana,
} from "../../../../../../lib/agent-audit/automation-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/auditoria/automatizaciones/semana?departamento=…&semana=AAAA-MM-DD
 * → detalle de UNA celda del mapa de calor (qué casos de uso sumaron esa semana y por qué).
 * Mismo permiso y alcance que el indicador (auditoría de agentes).
 */
export async function GET(request: NextRequest) {
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
    const departamento = (
      request.nextUrl.searchParams.get("departamento") ?? ""
    ).trim();
    const semana = (request.nextUrl.searchParams.get("semana") ?? "").trim();
    if (
      !departamento ||
      departamento.length > 120 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(semana) ||
      Number.isNaN(Date.parse(semana))
    )
      return jsonNoStore(
        { error: "Indique el departamento y la semana (AAAA-MM-DD)." },
        { status: 400 },
      );
    try {
      return jsonNoStore(
        await leerDetalleSemana(
          departamento,
          semana,
          user.email,
          await getAuditScope(user.email),
        ),
      );
    } catch (e) {
      if (e instanceof IndicadorNoDisponible)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError(
      "GET /api/chat/auditoria/automatizaciones/semana",
      error,
    );
  }
}
