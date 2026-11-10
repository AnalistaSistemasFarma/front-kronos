import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore, NO_STORE, serverError } from "../../../../../../lib/chat/http";
import { isCollectorRequest } from "../../../../../../lib/agent-audit/collector-auth";
import {
  AnalisisSeguridadNoDisponible,
  fallarCorridaSeguridad,
  progresoCorridaSeguridad,
  tomarCorridaSeguridad,
} from "../../../../../../lib/agent-audit/security-db";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat/auditoria/seguridad/solicitudes → SOLO el analizador.
 *   {}                              toma la corrida pendiente más antigua (o null).
 *   { progreso: id, texto: "…" }    avance visible en la pantalla.
 *   { fallo: id, error: "…" }       marca la corrida como fallida.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const body = (await request.json().catch(() => ({}))) as { fallo?: unknown; error?: unknown; progreso?: unknown; texto?: unknown };
    try {
      if (typeof body.fallo === "number") {
        await fallarCorridaSeguridad(body.fallo, String(body.error ?? ""));
        return jsonNoStore({ ok: true });
      }
      if (typeof body.progreso === "number") {
        await progresoCorridaSeguridad(body.progreso, String(body.texto ?? ""));
        return jsonNoStore({ ok: true });
      }
      return jsonNoStore({ corrida: await tomarCorridaSeguridad() });
    } catch (e) {
      if (e instanceof AnalisisSeguridadNoDisponible) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/seguridad/solicitudes", error);
  }
}
