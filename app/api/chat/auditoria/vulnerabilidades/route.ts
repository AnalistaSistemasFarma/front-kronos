import { NextRequest, NextResponse } from "next/server";
import { canAuditAgents, getAuditScope } from "../../../../../lib/chat/audit-access";
import { badRequest, jsonNoStore, NO_STORE, resolveSessionUser, serverError, unauthorized } from "../../../../../lib/chat/http";
import { isCollectorRequest } from "../../../../../lib/agent-audit/collector-auth";
import { leerVulns, publicarEscaneo, VulnsNoDisponible } from "../../../../../lib/agent-audit/vulns-db";
import { parsePublicacionVulns, VulnValidacionError } from "../../../../../lib/agent-audit/vulns-rules";

export const dynamic = "force-dynamic";

/**
 * VULNERABILIDADES (OSV) — Auditoría de agentes, 2026-11-19.
 *   GET  → sesión + auditoría con alcance total (administración): último escaneo, hallazgos e historial.
 *   POST → SOLO el escáner (llave del recolector): publica los hallazgos de un escaneo.
 */
const MAX_BODY = 25 * 1024 * 1024;

async function soloAdministracion() {
  const user = await resolveSessionUser();
  if (!user) return { error: unauthorized() };
  if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
    return { error: jsonNoStore({ error: "Las vulnerabilidades solo las ve la administración." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  try {
    const a = await soloAdministracion();
    if ("error" in a) return a.error;
    try {
      return jsonNoStore(await leerVulns());
    } catch (e) {
      if (e instanceof VulnsNoDisponible) return jsonNoStore({ error: e.message, disponible: false }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/vulnerabilidades", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY) return jsonNoStore({ error: "Publicación demasiado grande." }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return badRequest("JSON inválido.");
    }
    try {
      return jsonNoStore({ ok: true, ...(await publicarEscaneo(parsePublicacionVulns(body))) });
    } catch (e) {
      if (e instanceof VulnValidacionError) return badRequest(e.message);
      if (e instanceof VulnsNoDisponible) return jsonNoStore({ error: e.message }, { status: 503 });
      if ((e as { number?: number } | null)?.number === 51630) return jsonNoStore({ error: "El escaneo no está en curso." }, { status: 409 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/vulnerabilidades", error);
  }
}
