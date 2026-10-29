import { NextRequest, NextResponse } from "next/server";
import {
  canAuditAgents,
  getAuditScope,
} from "../../../../../lib/chat/audit-access";
import {
  badRequest,
  jsonNoStore,
  NO_STORE,
  resolveSessionUser,
  serverError,
  unauthorized,
} from "../../../../../lib/chat/http";
import { isCollectorRequest } from "../../../../../lib/agent-audit/collector-auth";
import {
  MemoryValidationError,
  parseMemoriesPayload,
} from "../../../../../lib/agent-audit/memories";
import {
  guardarMemorias,
  leerMapa,
  MemoriasNoDisponibles,
  tieneMapaPersonal,
} from "../../../../../lib/agent-audit/memories-db";

export const dynamic = "force-dynamic";

/**
 * MEMORIAS DE LOS AGENTES — pestaña «Memorias» de la Auditoría de agentes.
 *
 *   GET  /api/chat/auditoria/memorias?mapa=general   → sesión + permiso de
 *        auditoría, con su alcance por empresa. Sin los agentes personales.
 *   GET  /api/chat/auditoria/memorias?mapa=personal  → sesión. Solo los agentes
 *        personales cuyo dueño es el usuario (agent_memory_setting); nadie más
 *        los ve, ni la administración.
 *        En ambos casos va el mapa sin el contenido de cada memoria: el
 *        contenido se pide de a una en /api/chat/auditoria/memorias/[id].
 *
 *   POST /api/chat/auditoria/memorias → SOLO el recolector, con la misma llave
 *        del inventario (AGENT_INVENTORY_COLLECTOR_KEY). Publica las memorias
 *        de un equipo; todo pasa por parseMemoriesPayload, que oculta secretos.
 *
 * LA REJA ESTÁ AQUÍ, no en la pantalla.
 */

/** Tope del cuerpo: un equipo con varios agentes ronda unos pocos MB. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const NO_HABILITADO = {
  error:
    "Las memorias de los agentes aún no están habilitadas en este ambiente.",
};

export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const mapa =
      request.nextUrl.searchParams.get("mapa") === "personal"
        ? "personal"
        : "general";
    try {
      if (mapa === "personal") {
        if (!(await tieneMapaPersonal(user.email))) {
          return jsonNoStore(
            { error: "No tiene un mapa personal." },
            { status: 403 },
          );
        }
        return jsonNoStore(await leerMapa("personal", user.email, null));
      }

      if (!(await canAuditAgents(user.email))) {
        // Sin auditoría puede tener igual su mapa personal.
        if (await tieneMapaPersonal(user.email)) {
          return jsonNoStore({
            ...(await leerMapa("personal", user.email, null)),
            soloPersonal: true,
          });
        }
        return jsonNoStore(
          {
            error:
              "Las memorias de los agentes están reservadas a la auditoría de agentes.",
          },
          { status: 403 },
        );
      }
      const alcance = await getAuditScope(user.email);
      return jsonNoStore(await leerMapa("general", user.email, alcance));
    } catch (err) {
      if (err instanceof MemoriasNoDisponibles)
        return jsonNoStore(NO_HABILITADO, { status: 503 });
      throw err;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/memorias", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isCollectorRequest(request)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE },
      );
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return jsonNoStore(
        { error: "El envío de memorias es demasiado grande." },
        { status: 413 },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return badRequest("El cuerpo no es JSON válido.");
    }
    let payload;
    try {
      payload = parseMemoriesPayload(body);
    } catch (err) {
      if (err instanceof MemoryValidationError) return badRequest(err.message);
      throw err;
    }
    try {
      return jsonNoStore({ ok: true, ...(await guardarMemorias(payload)) });
    } catch (err) {
      if (err instanceof MemoriasNoDisponibles)
        return jsonNoStore(NO_HABILITADO, { status: 503 });
      throw err;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/memorias", error);
  }
}
