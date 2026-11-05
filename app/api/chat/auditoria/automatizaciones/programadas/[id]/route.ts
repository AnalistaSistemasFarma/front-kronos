import { NextRequest } from "next/server";
import {
  canAuditAgents,
  canConfigureAgents,
  getAuditScope,
} from "../../../../../../../lib/chat/audit-access";
import { readClientOrigin } from "../../../../../../../lib/chat/client-origin";
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from "../../../../../../../lib/chat/http";
import {
  ACCIONES_PROGRAMADA,
  esAccion,
  motivoNoPermitida,
} from "../../../../../../../lib/agent-audit/scheduled-admin";
import {
  AdminNoDisponible,
  crearOrdenProgramada,
  leerProgramada,
  OrdenProgramadaActiva,
  ordenesDeProgramada,
  type OrdenProgramadaDto,
} from "../../../../../../../lib/agent-audit/scheduled-admin-db";

export const dynamic = "force-dynamic";

/**
 * UNA AUTOMATIZACIÓN PROGRAMADA: ver sus últimas corridas y administrarla
 * (Nicolás, 2026-11-04). LA REJA ESTÁ AQUÍ, no en la pantalla.
 *
 *   GET  → sesión + permiso de auditoría + automatización en su alcance:
 *          { programada, ordenes, puedeAdministrar, acciones: {pausar|reanudar|ejecutar: motivo|null}, adminDisponible }
 *          Las notas de error de las corridas solo van a quien puede administrar.
 *   POST { accion: "pausar"|"reanudar"|"ejecutar", confirmar: true }
 *        → 202 { orden }. Exige «Auditoría de agentes · Configurar»
 *          (canConfigureAgents), la automatización en su alcance, en la LISTA
 *          BLANCA, sin otra orden activa y sin estar corriendo (409 si no).
 *          La orden queda con correo, IP y navegador, y en la hoja de vida.
 *          NO toca ningún Mac: el ejecutor de ese equipo la toma y la aplica.
 */
type Params = { params: Promise<{ id: string }> };

const noEncontrada = () =>
  jsonNoStore({ error: "Automatización no encontrada." }, { status: 404 });

async function resolver(id: string, email: string) {
  const idJob = Number(id);
  if (!Number.isInteger(idJob) || idJob <= 0) return null;
  return leerProgramada(idJob, email, await getAuditScope(email));
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email)))
      return jsonNoStore(
        { error: "La auditoría de agentes está reservada a la administración." },
        { status: 403 },
      );
    const { id } = await params;
    const p = await resolver(id, user.email);
    if (!p) return noEncontrada();
    const admin = await canConfigureAgents(user.email).catch(() => false);
    let ordenes: OrdenProgramadaDto[] = [];
    let adminDisponible = true;
    try {
      ordenes = await ordenesDeProgramada(p.clave);
    } catch (e) {
      if (!(e instanceof AdminNoDisponible)) throw e;
      adminDisponible = false;
    }
    const activa = ordenes.find(
      (o) => o.status === "pendiente" || o.status === "en_curso",
    );
    const acciones = Object.fromEntries(
      ACCIONES_PROGRAMADA.map((a) => [
        a,
        activa
          ? "Ya hay una orden en curso para esta automatización."
          : motivoNoPermitida(a, p),
      ]),
    );
    return jsonNoStore({
      programada: admin
        ? p
        : { ...p, ultimas: p.ultimas.map((u) => ({ ...u, nota: null })) },
      ordenes,
      puedeAdministrar: admin && adminDisponible,
      adminDisponible,
      acciones,
    });
  } catch (error) {
    return serverError(
      "GET /api/chat/auditoria/automatizaciones/programadas/[id]",
      error,
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canConfigureAgents(user.email).catch(() => false)))
      return jsonNoStore(
        {
          error:
            "Administrar automatizaciones requiere el permiso «Auditoría de agentes · Configurar».",
        },
        { status: 403 },
      );
    const { id } = await params;
    const p = await resolver(id, user.email);
    if (!p) return noEncontrada();
    const body = await readJsonBody(request);
    if (!body || body.confirmar !== true)
      return badRequest("Falta la confirmación («confirmar»: true).");
    if (!esAccion(body.accion))
      return badRequest("accion debe ser «pausar», «reanudar» o «ejecutar».");
    const motivo = motivoNoPermitida(body.accion, p);
    if (motivo) return jsonNoStore({ error: motivo }, { status: 409 });
    const origen = readClientOrigin(request);
    try {
      const orden = await crearOrdenProgramada({
        job: p,
        accion: body.accion,
        requestedBy: user.email,
        ip: origen.clientIp,
        userAgent: origen.userAgent,
      });
      return jsonNoStore({ orden }, { status: 202 });
    } catch (e) {
      if (e instanceof OrdenProgramadaActiva)
        return jsonNoStore({ error: e.message, orden: e.orden }, { status: 409 });
      if (e instanceof AdminNoDisponible)
        return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError(
      "POST /api/chat/auditoria/automatizaciones/programadas/[id]",
      error,
    );
  }
}
