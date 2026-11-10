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
  ErroresValidacionError,
  horasEntreAvisos,
  notificacionActiva,
  parseAcuse,
  parsePublicacion,
} from "../../../../../lib/agent-audit/errors";
import {
  acusarNotificados,
  ErroresNoDisponibles,
  leerErrores,
  publicarErrores,
} from "../../../../../lib/agent-audit/errors-db";

export const dynamic = "force-dynamic";

/**
 * ERRORES DE IA (Auditoría de agentes) — «como un Sentry pero con los agentes».
 *   GET  → sesión + permiso de auditoría, recortado a su alcance: errores
 *          agrupados por huella. `puedeReintentar` solo para la administración.
 *   POST → SOLO el recolector (llave del recolector del inventario,
 *          AGENT_INVENTORY_COLLECTOR_KEY):
 *            { eventos: [...] }             publica ocurrencias; responde
 *                                           `notificar` si AGENT_ERRORS_NOTIFY=1.
 *            { accion: "acuse", huellas }   el aviso ya salió: anota la hora.
 * LA REJA ESTÁ AQUÍ, no en la pantalla.
 */
const MAX_BODY = 5 * 1024 * 1024;

export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)))
      return jsonNoStore(
        { error: "La auditoría de agentes está reservada a la administración." },
        { status: 403 },
      );
    const alcance = await getAuditScope(user.email);
    try {
      return jsonNoStore({
        ...(await leerErrores(user.email, alcance)),
        puedeReintentar: alcance.all,
        notificacionActiva: notificacionActiva(),
        horasEntreAvisos: horasEntreAvisos(),
      });
    } catch (e) {
      if (e instanceof ErroresNoDisponibles)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/errores", error);
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
      return jsonNoStore({ error: "Publicación demasiado grande." }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return badRequest("El cuerpo no es JSON válido.");
    }
    try {
      if ((body as { accion?: unknown } | null)?.accion === "acuse") {
        return jsonNoStore({ ok: true, acusados: await acusarNotificados(parseAcuse(body)) });
      }
      const notificar = notificacionActiva();
      return jsonNoStore({
        ok: true,
        notificacionActiva: notificar,
        ...(await publicarErrores(parsePublicacion(body), {
          notificar,
          horas: horasEntreAvisos(),
        })),
      });
    } catch (e) {
      if (e instanceof ErroresValidacionError) return badRequest(e.message);
      if (e instanceof ErroresNoDisponibles)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/errores", error);
  }
}
