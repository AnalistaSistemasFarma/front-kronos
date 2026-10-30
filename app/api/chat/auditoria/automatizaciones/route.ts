import { NextRequest, NextResponse } from "next/server";
import {
  canAuditAgents,
  getAuditScope,
} from "../../../../../lib/chat/audit-access";
import {
  badRequest,
  jsonNoStore,
  NO_STORE,
  resolveSessionUser,
  serverError,
  unauthorized,
} from "../../../../../lib/chat/http";
import { isCollectorRequest } from "../../../../../lib/agent-audit/collector-auth";
import {
  IndicadorNoDisponible,
  IndicadorValidacionError,
  leerIndicador,
  parsePublicacion,
  publicarIndicador,
} from "../../../../../lib/agent-audit/automation-db";

export const dynamic = "force-dynamic";

/**
 * INDICADOR DE AUTOMATIZACIONES (Auditoría de agentes).
 *   GET  → sesión + permiso de auditoría: resumen por agente del último corte,
 *          estado del último análisis y si hay uno pendiente. `puedeAnalizar`
 *          solo con alcance total (el análisis recorre toda la flota).
 *   POST → SOLO el analizador (llave del recolector del inventario): publica un
 *          corte. Las horas se recalculan aquí; no se confía en las del cliente.
 */
const MAX_BODY = 5 * 1024 * 1024;

export async function GET() {
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
    const alcance = await getAuditScope(user.email);
    try {
      return jsonNoStore({
        ...(await leerIndicador(user.email, alcance)),
        puedeAnalizar: alcance.all,
      });
    } catch (e) {
      if (e instanceof IndicadorNoDisponible)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/automatizaciones", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request))
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE },
      );
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY)
      return jsonNoStore(
        { error: "Publicación demasiado grande." },
        { status: 413 },
      );
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return badRequest("El cuerpo no es JSON válido.");
    }
    try {
      return jsonNoStore({
        ok: true,
        ...(await publicarIndicador(parsePublicacion(body))),
      });
    } catch (e) {
      if (e instanceof IndicadorValidacionError) return badRequest(e.message);
      if (e instanceof IndicadorNoDisponible)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/automatizaciones", error);
  }
}
