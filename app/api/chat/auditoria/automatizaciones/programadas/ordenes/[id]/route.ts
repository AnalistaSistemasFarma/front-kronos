import { NextRequest, NextResponse } from "next/server";
import {
  badRequest,
  jsonNoStore,
  NO_STORE,
  readJsonBody,
  serverError,
} from "../../../../../../../../lib/chat/http";
import { hostDelEjecutor } from "../../../../../../../../lib/agent-audit/executor-auth";
import {
  AdminNoDisponible,
  reportarOrdenProgramada,
  TransicionProgramadaInvalida,
  type EstadoOrdenProg,
} from "../../../../../../../../lib/agent-audit/scheduled-admin-db";

export const dynamic = "force-dynamic";

/**
 * RESULTADO DE UNA ORDEN — lo reporta el ejecutor del equipo.
 *   POST Authorization: Bearer <llave del ejecutor>
 *        { "estado": "en_curso" | "ok" | "ocupado" | "error", "detalle": "…", "ejecutor": "<equipo>" }
 * 'en_curso' TOMA la orden (solo desde 'pendiente'); los finales la cierran.
 * Solo órdenes de SU equipo: otra cualquiera responde 404. 409 si la
 * transición no vale (ya la tomó otro, ya se cerró o venció).
 */
const REPORTABLES: readonly string[] = ["en_curso", "ok", "ocupado", "error"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const host = hostDelEjecutor(request);
    if (!host)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const { id } = await params;
    const idCommand = Number(id);
    if (!Number.isInteger(idCommand) || idCommand <= 0) return badRequest("Id de orden inválido.");
    const body = await readJsonBody(request);
    if (!body) return badRequest("El cuerpo debe ser un objeto JSON.");
    const estado = body.estado;
    if (typeof estado !== "string" || !REPORTABLES.includes(estado))
      return badRequest("estado debe ser 'en_curso', 'ok', 'ocupado' o 'error'.");
    const detalle = typeof body.detalle === "string" ? body.detalle.trim() || null : null;
    const ejecutor = typeof body.ejecutor === "string" ? body.ejecutor.trim() || null : null;
    const orden = await reportarOrdenProgramada(host, idCommand, estado as EstadoOrdenProg, detalle, ejecutor ?? host);
    if (!orden) return jsonNoStore({ error: "Orden no encontrada." }, { status: 404 });
    return jsonNoStore({ orden });
  } catch (error) {
    if (error instanceof TransicionProgramadaInvalida)
      return jsonNoStore({ error: error.message }, { status: 409 });
    if (error instanceof AdminNoDisponible)
      return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError("POST /api/chat/auditoria/automatizaciones/programadas/ordenes/[id]", error);
  }
}
