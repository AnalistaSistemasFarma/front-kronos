import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore, NO_STORE, serverError } from "../../../../../../../lib/chat/http";
import { hostDelEjecutor } from "../../../../../../../lib/agent-audit/executor-auth";
import {
  AdminNoDisponible,
  ordenesPendientesHost,
} from "../../../../../../../lib/agent-audit/scheduled-admin-db";

export const dynamic = "force-dynamic";

/**
 * ÓRDENES PENDIENTES DE UN EQUIPO — las lee el ejecutor de automatizaciones de
 * cada Mac (ejecutor-automatizaciones.py, cada minuto).
 *   GET  Authorization: Bearer <llave del ejecutor de ese equipo>
 *        (AGENT_SCHEDULED_EXECUTOR_KEYS) → { host, ordenes: [...] }
 * Solo lee. Cada llave ve únicamente las órdenes de SU equipo.
 */
export async function GET(request: NextRequest) {
  try {
    const host = hostDelEjecutor(request);
    if (!host)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    return jsonNoStore({ host, ordenes: await ordenesPendientesHost(host) });
  } catch (error) {
    if (error instanceof AdminNoDisponible)
      return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError("GET /api/chat/auditoria/automatizaciones/programadas/ordenes", error);
  }
}
