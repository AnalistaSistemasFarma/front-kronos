import { NextRequest, NextResponse } from "next/server";
import {
  jsonNoStore,
  NO_STORE,
  serverError,
} from "../../../../../../lib/chat/http";
import { isCollectorRequest } from "../../../../../../lib/agent-audit/collector-auth";
import {
  fallarCorrida,
  IndicadorNoDisponible,
  tomarCorrida,
} from "../../../../../../lib/agent-audit/automation-db";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat/auditoria/automatizaciones/solicitudes → SOLO el analizador.
 *   {}                         toma la corrida pendiente más antigua (o null).
 *   { fallo: id, error: "…" }  marca una corrida como fallida.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request))
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE },
      );
    const body = (await request.json().catch(() => ({}))) as {
      fallo?: unknown;
      error?: unknown;
    };
    try {
      if (typeof body.fallo === "number") {
        await fallarCorrida(body.fallo, String(body.error ?? ""));
        return jsonNoStore({ ok: true });
      }
      return jsonNoStore({ corrida: await tomarCorrida() });
    } catch (e) {
      if (e instanceof IndicadorNoDisponible)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError(
      "POST /api/chat/auditoria/automatizaciones/solicitudes",
      error,
    );
  }
}
