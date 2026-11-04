import { NextRequest } from "next/server";
import {
  canAuditAgents,
  getAuditScope,
} from "../../../../../../lib/chat/audit-access";
import {
  badRequest,
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from "../../../../../../lib/chat/http";
import { ESTADOS, type EstadoError } from "../../../../../../lib/agent-audit/errors";
import {
  cambiarEstado,
  ErroresNoDisponibles,
  leerEventos,
} from "../../../../../../lib/agent-audit/errors-db";

export const dynamic = "force-dynamic";

/**
 * UN error de IA.
 *   GET   → sus últimas 50 ocurrencias.
 *   PATCH → { estado: "abierto" | "resuelto" | "silenciado" }.
 * Sesión + permiso de auditoría, dentro de su alcance; si no existe o no lo
 * puede ver, 404 sin pistas.
 */
type Ctx = { params: Promise<{ id: string }> };

async function preparar(ctx: Ctx) {
  const user = await resolveSessionUser();
  if (!user) return { respuesta: unauthorized() };
  if (!(await canAuditAgents(user.email)))
    return {
      respuesta: jsonNoStore(
        { error: "La auditoría de agentes está reservada a la administración." },
        { status: 403 },
      ),
    };
  const { id } = await ctx.params;
  const idIssue = Number(id);
  if (!Number.isSafeInteger(idIssue) || idIssue <= 0)
    return { respuesta: jsonNoStore({ error: "No encontrado." }, { status: 404 }) };
  return { user, idIssue, alcance: await getAuditScope(user.email) };
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const p = await preparar(ctx);
    if ("respuesta" in p) return p.respuesta;
    try {
      const eventos = await leerEventos(p.idIssue, p.user.email, p.alcance);
      if (!eventos) return jsonNoStore({ error: "No encontrado." }, { status: 404 });
      return jsonNoStore({ eventos });
    } catch (e) {
      if (e instanceof ErroresNoDisponibles)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/errores/[id]", error);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const p = await preparar(ctx);
    if ("respuesta" in p) return p.respuesta;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("El cuerpo no es JSON válido.");
    }
    const estado = (body as { estado?: unknown } | null)?.estado;
    if (typeof estado !== "string" || !(ESTADOS as readonly string[]).includes(estado))
      return badRequest("Estado no válido.");
    try {
      const dto = await cambiarEstado(p.idIssue, estado as EstadoError, p.user.email, p.alcance);
      if (!dto) return jsonNoStore({ error: "No encontrado." }, { status: 404 });
      return jsonNoStore({ ok: true, error: dto });
    } catch (e) {
      if (e instanceof ErroresNoDisponibles)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("PATCH /api/chat/auditoria/errores/[id]", error);
  }
}
