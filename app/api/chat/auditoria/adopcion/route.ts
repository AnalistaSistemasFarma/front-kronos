import { NextRequest } from "next/server";
import { canAuditAgents, getAuditScope } from "../../../../../lib/chat/audit-access";
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../lib/chat/http";
import { readAdoption } from "../../../../../lib/agent-audit/adoption-db";

export const dynamic = "force-dynamic";

/**
 * ADOPCIÓN DE IA VS PLANTILLA (Auditoría de agentes, Nicolás Rivera 2026-11-26).
 *   GET ?empresa=<id>&area=<id_department>&refrescar=1
 * Session + audit permission, trimmed to the user's audit scope (companies). `refrescar=1` recomputes the
 * fit and re-reads the sources (administration only); otherwise the result is cached for a few hours.
 * THE GATE IS HERE, not in the page.
 */
const intParam = (v: string | null) => {
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 ? n : null;
};

export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)))
      return jsonNoStore({ error: "La auditoría de agentes está reservada a la administración." }, { status: 403 });
    const scope = await getAuditScope(user.email);
    const q = request.nextUrl.searchParams;
    const force = q.get("refrescar") === "1" && scope.all;
    const data = await readAdoption(scope, { companyId: intParam(q.get("empresa")), departmentId: intParam(q.get("area")) }, force);
    return jsonNoStore({ ...data, puedeRefrescar: scope.all });
  } catch (error) {
    return serverError("GET /api/chat/auditoria/adopcion", error);
  }
}
