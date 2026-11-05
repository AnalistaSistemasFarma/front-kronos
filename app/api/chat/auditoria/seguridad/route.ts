import { NextRequest, NextResponse } from "next/server";
import { canAuditAgents, getAuditScope, getAuditTextScope } from "../../../../../lib/chat/audit-access";
import { badRequest, jsonNoStore, NO_STORE, resolveSessionUser, serverError, unauthorized } from "../../../../../lib/chat/http";
import { isCollectorRequest } from "../../../../../lib/agent-audit/collector-auth";
import {
  AnalisisSeguridadNoDisponible,
  leerAnalisis,
  publicarAnalisisSeguridad,
} from "../../../../../lib/agent-audit/security-db";
import {
  AnalisisValidacionError,
  parsePublicacionAnalisis,
  periodoActual,
  periodoValido,
  periodosDisponibles,
} from "../../../../../lib/agent-audit/security-rules";

export const dynamic = "force-dynamic";

/**
 * ANÁLISIS DE SEGURIDAD DE CONVERSACIONES (Auditoría de agentes, 2026-11-05).
 *   GET ?periodo=AAAA-MM → sesión + permiso de auditoría: estado del análisis del mes y sus
 *       hallazgos dentro del alcance. La evidencia (texto) solo con el permiso de conversaciones.
 *       `puedeAnalizar` solo con alcance total (el análisis recorre toda la flota).
 *   POST → SOLO el analizador (llave del recolector): publica los hallazgos de una corrida.
 */

const MAX_BODY = 8 * 1024 * 1024;

export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)))
      return jsonNoStore({ error: "La auditoría de agentes está reservada a la administración." }, { status: 403 });
    const periodo = request.nextUrl.searchParams.get("periodo") || periodoActual();
    if (!periodoValido(periodo)) return badRequest("Mes no válido.");
    const alcance = await getAuditScope(user.email);
    const texto = await getAuditTextScope(user.email, alcance);
    try {
      return jsonNoStore({
        ...(await leerAnalisis(periodo, alcance, texto)),
        periodos: periodosDisponibles(),
        puedeAnalizar: alcance.all,
      });
    } catch (e) {
      if (e instanceof AnalisisSeguridadNoDisponible) return jsonNoStore({ error: e.message, disponible: false }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/seguridad", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY) return jsonNoStore({ error: "Publicación demasiado grande." }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return badRequest("JSON inválido.");
    }
    try {
      return jsonNoStore({ ok: true, ...(await publicarAnalisisSeguridad(parsePublicacionAnalisis(body))) });
    } catch (e) {
      if (e instanceof AnalisisValidacionError) return badRequest(e.message);
      if (e instanceof AnalisisSeguridadNoDisponible) return jsonNoStore({ error: e.message }, { status: 503 });
      if ((e as { number?: number } | null)?.number === 51610)
        return jsonNoStore({ error: "La corrida no está en curso." }, { status: 409 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/seguridad", error);
  }
}
