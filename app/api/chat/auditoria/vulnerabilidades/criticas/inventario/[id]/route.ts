import { canAuditAgents, getAuditScope } from "../../../../../../../../lib/chat/audit-access";
import { badRequest, jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../../../../lib/chat/http";
import { deleteItem, ThreatsUnavailable, updateItem } from "../../../../../../../../lib/agent-audit/threats-db";
import { InventoryValidationError, parseInventoryInput } from "../../../../../../../../lib/agent-audit/threats-rules";

export const dynamic = "force-dynamic";

async function guard(ctx: { params: Promise<{ id: string }> }) {
  const user = await resolveSessionUser();
  if (!user) return { error: unauthorized() };
  if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
    return { error: jsonNoStore({ error: "Solo la administración edita el inventario." }, { status: 403 }) };
  const n = Number((await ctx.params).id);
  if (!Number.isInteger(n) || n <= 0) return { error: badRequest("Elemento no válido.") };
  return { user, id: n };
}

/** PATCH /api/chat/auditoria/vulnerabilidades/criticas/inventario/:id — edits a product (administration only). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard(ctx);
    if ("error" in g) return g.error;
    try {
      const item = await updateItem(g.id, parseInventoryInput(await request.json().catch(() => ({}))), g.user.email);
      if (!item) return jsonNoStore({ error: "Elemento no encontrado." }, { status: 404 });
      return jsonNoStore({ ok: true, item });
    } catch (e) {
      if (e instanceof InventoryValidationError) return badRequest(e.message);
      if (e instanceof ThreatsUnavailable) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("PATCH /api/chat/auditoria/vulnerabilidades/criticas/inventario/[id]", error);
  }
}

/** DELETE /api/chat/auditoria/vulnerabilidades/criticas/inventario/:id — removes a product (administration only). */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard(ctx);
    if ("error" in g) return g.error;
    try {
      if (!(await deleteItem(g.id))) return jsonNoStore({ error: "Elemento no encontrado." }, { status: 404 });
      return jsonNoStore({ ok: true });
    } catch (e) {
      if (e instanceof ThreatsUnavailable) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("DELETE /api/chat/auditoria/vulnerabilidades/criticas/inventario/[id]", error);
  }
}
