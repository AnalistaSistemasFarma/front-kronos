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
  leerRespaldos,
  parsePublicacionRespaldos,
  publicarRespaldos,
  RespaldosNoDisponibles,
  RespaldosValidacionError,
} from "../../../../../lib/agent-audit/backups-db";

export const dynamic = "force-dynamic";

/**
 * COPIAS DE SEGURIDAD DE LOS AGENTES (Auditoría de agentes).
 *   GET  → sesión + auditoría con alcance total (es información de toda la flota).
 *   POST → SOLO el recolector (llave del recolector del inventario).
 */
const MAX_BODY = 8 * 1024 * 1024;

export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (
      !(await canAuditAgents(user.email)) ||
      !(await getAuditScope(user.email)).all
    )
      return jsonNoStore(
        {
          error:
            "Las copias de seguridad de los agentes son solo para la administración.",
        },
        { status: 403 },
      );
    try {
      return jsonNoStore(await leerRespaldos());
    } catch (e) {
      if (e instanceof RespaldosNoDisponibles)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/respaldos", error);
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
        ...(await publicarRespaldos(parsePublicacionRespaldos(body))),
      });
    } catch (e) {
      if (e instanceof RespaldosValidacionError) return badRequest(e.message);
      if (e instanceof RespaldosNoDisponibles)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/respaldos", error);
  }
}
