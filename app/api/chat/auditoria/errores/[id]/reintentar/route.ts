import { NextRequest } from "next/server";
import { checkAdminPrivileges } from "../../../../../../../lib/access-control";
import {
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from "../../../../../../../lib/chat/http";
import {
  ErroresNoDisponibles,
  reintentarMensaje,
} from "../../../../../../../lib/agent-audit/errors-db";

export const dynamic = "force-dynamic";

/**
 * POST → «Reintentar mensaje»: vuelve a entregarle al agente el mensaje que
 * quedó sin atender (delivered_at = NULL con las guardas de
 * reintentarMensaje). SOLO la administración.
 */
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await checkAdminPrivileges(user.email)))
      return jsonNoStore(
        { error: "Reintentar mensajes está reservado a la administración." },
        { status: 403 },
      );
    const { id } = await ctx.params;
    const idIssue = Number(id);
    if (!Number.isSafeInteger(idIssue) || idIssue <= 0)
      return jsonNoStore({ error: "No encontrado." }, { status: 404 });
    try {
      const r = await reintentarMensaje(idIssue, user.email);
      if (!r.ok) return jsonNoStore({ error: r.motivo }, { status: r.status });
      return jsonNoStore(r);
    } catch (e) {
      if (e instanceof ErroresNoDisponibles)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/errores/[id]/reintentar", error);
  }
}
