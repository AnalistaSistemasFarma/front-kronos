import { NextResponse } from "next/server";
import { canAuditAgents, getAuditScope } from "../../../../../../../lib/chat/audit-access";
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from "../../../../../../../lib/chat/http";
import { FacturasNoDisponibles, leerPdfFactura } from "../../../../../../../lib/agent-audit/facturas-db";

export const dynamic = "force-dynamic";

/** PDF de una factura de IA, para verlo en el navegador. Solo administración. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
      return jsonNoStore({ error: "Las facturas de IA son solo para la administración." }, { status: 403 });
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return jsonNoStore({ error: "Factura inválida." }, { status: 400 });
    try {
      const f = await leerPdfFactura(id);
      if (!f) return jsonNoStore({ error: "Esta factura no tiene PDF." }, { status: 404 });
      return new NextResponse(new Uint8Array(f.pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${encodeURIComponent(f.nombre)}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (e) {
      if (e instanceof FacturasNoDisponibles) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/facturas/[id]/pdf", error);
  }
}
