import { NextRequest, NextResponse } from "next/server";
import {
  canAuditAgents,
  canConfigureAgents,
  getAuditScope,
} from "../../../../../../lib/chat/audit-access";
import {
  badRequest,
  jsonNoStore,
  NO_STORE,
  resolveSessionUser,
  serverError,
  unauthorized,
} from "../../../../../../lib/chat/http";
import { isCollectorRequest } from "../../../../../../lib/agent-audit/collector-auth";
import {
  parseProgramadas,
  ProgramadasValidacionError,
} from "../../../../../../lib/agent-audit/scheduled";
import {
  leerProgramadas,
  ProgramadasNoDisponible,
  publicarProgramadas,
} from "../../../../../../lib/agent-audit/scheduled-db";
import { avisarSalud } from "../../../../../../lib/agent-audit/scheduled-avisos-db";

export const dynamic = "force-dynamic";

/**
 * AUTOMATIZACIONES PROGRAMADAS de los agentes (Indicador de automatizaciones).
 *   GET  → sesión + permiso de auditoría: las del alcance de quien consulta.
 *   POST → SOLO el recolector (llave del recolector del inventario):
 *          scripts/agent-automation/programadas.py publica el inventario.
 *          Después evalúa cuáles están «muertas» o «fallando» y las registra en
 *          Errores de IA (tipo 'automatizacion'); `avisos.notificar` trae lo que
 *          el recolector debe avisar (solo con AGENT_ERRORS_NOTIFY=1).
 */
const MAX_BODY = 2 * 1024 * 1024;

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
    const lista = await leerProgramadas(
      user.email,
      await getAuditScope(user.email),
    );
    if (lista === null)
      return jsonNoStore(
        { error: new ProgramadasNoDisponible().message },
        { status: 503 },
      );
    return jsonNoStore({
      programadas: lista,
      puedeAdministrar: await canConfigureAgents(user.email).catch(() => false),
    });
  } catch (error) {
    return serverError(
      "GET /api/chat/auditoria/automatizaciones/programadas",
      error,
    );
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
      const pub = parseProgramadas(body);
      const res = await publicarProgramadas(pub);
      return jsonNoStore({
        ok: true,
        ...res,
        avisos: await avisarSalud(pub.hostsLeidos),
      });
    } catch (e) {
      if (e instanceof ProgramadasValidacionError) return badRequest(e.message);
      if (e instanceof ProgramadasNoDisponible)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError(
      "POST /api/chat/auditoria/automatizaciones/programadas",
      error,
    );
  }
}
