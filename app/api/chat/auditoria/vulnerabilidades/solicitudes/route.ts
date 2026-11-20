import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore, NO_STORE, serverError } from "../../../../../../lib/chat/http";
import { isCollectorRequest } from "../../../../../../lib/agent-audit/collector-auth";
import { fallarEscaneo, pedirEscaneo, progresoEscaneo, tomarEscaneo, VulnsNoDisponible } from "../../../../../../lib/agent-audit/vulns-db";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat/auditoria/vulnerabilidades/solicitudes → SOLO el escáner.
 *   {}                            toma el escaneo pendiente más antiguo (o null).
 *   { programado: true }          deja uno programado (si no hay otro) y lo toma.
 *   { progreso: id, texto: "…" }  avance visible en la pantalla.
 *   { fallo: id, error: "…" }     marca el escaneo como fallido.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const b = (await request.json().catch(() => ({}))) as { programado?: unknown; progreso?: unknown; texto?: unknown; fallo?: unknown; error?: unknown };
    try {
      if (typeof b.fallo === "number") {
        await fallarEscaneo(b.fallo, String(b.error ?? ""));
        return jsonNoStore({ ok: true });
      }
      if (typeof b.progreso === "number") {
        await progresoEscaneo(b.progreso, String(b.texto ?? ""));
        return jsonNoStore({ ok: true });
      }
      if (b.programado === true) await pedirEscaneo("programado", null);
      return jsonNoStore({ escaneo: await tomarEscaneo() });
    } catch (e) {
      if (e instanceof VulnsNoDisponible) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/vulnerabilidades/solicitudes", error);
  }
}
