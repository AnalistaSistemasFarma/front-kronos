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
  leerDetalle,
  MemoriasNoDisponibles,
} from "../../../../../../lib/agent-audit/memories-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/chat/auditoria/memorias/[id] → contenido de UNA memoria.
 * Una memoria de un agente personal solo la ve su dueño; las demás, quien
 * tiene la auditoría de agentes dentro de su alcance. Si no existe o no la
 * puede ver, 404 sin pistas.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const { id } = await ctx.params;
    const idMemory = Number(id);
    if (!Number.isSafeInteger(idMemory) || idMemory <= 0) {
      return jsonNoStore({ error: "No encontrada." }, { status: 404 });
    }
    const alcance = (await canAuditAgents(user.email))
      ? await getAuditScope(user.email)
      : null;
    try {
      const detalle = await leerDetalle(idMemory, user.email, alcance);
      if (!detalle)
        return jsonNoStore({ error: "No encontrada." }, { status: 404 });
      return jsonNoStore(detalle);
    } catch (err) {
      if (err instanceof MemoriasNoDisponibles) {
        return jsonNoStore(
          {
            error:
              "Las memorias de los agentes aún no están habilitadas en este ambiente.",
          },
          { status: 503 },
        );
      }
      throw err;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/memorias/[id]", error);
  }
}
