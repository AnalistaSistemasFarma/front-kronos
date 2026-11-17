import { NextRequest } from "next/server";
import { canAuditAgents, getAuditScope } from "../../../../../lib/chat/audit-access";
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from "../../../../../lib/chat/http";
import {
  asignarAgente,
  guardarLicencia,
  leerLicencias,
  LicenciasNoDisponibles,
  LicenciasValidacionError,
  parseLicencia,
} from "../../../../../lib/agent-audit/licencias-db";

export const dynamic = "force-dynamic";

/**
 * COSTOS Y LICENCIAS DE LOS AGENTES (Auditoría de agentes, Nicolás 2026-11-17).
 *   GET  → tablero completo (licencias, uso de 4 semanas, costo por empresa y área, alertas).
 *   POST → { accion: "guardar", licencia: {...} }            crea o edita una licencia
 *          { accion: "asignar", idAgent, idLicencia|null }   asigna o quita la licencia de un agente
 * Solo administración (auditoría con alcance total): son costos de toda la flota.
 * Regla de negocio: una licencia no se comparte entre empresas (se valida al asignar).
 */

async function soloAdministracion() {
  const user = await resolveSessionUser();
  if (!user) return { error: unauthorized() };
  if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
    return {
      error: jsonNoStore({ error: "Los costos y licencias de los agentes son solo para la administración." }, { status: 403 }),
    };
  return { user };
}

export async function GET() {
  try {
    const acceso = await soloAdministracion();
    if (acceso.error) return acceso.error;
    try {
      return jsonNoStore(await leerLicencias());
    } catch (e) {
      if (e instanceof LicenciasNoDisponibles) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/licencias", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const acceso = await soloAdministracion();
    if (acceso.error) return acceso.error;
    const body = await readJsonBody(request);
    if (!body) return badRequest("El cuerpo debe ser un objeto JSON.");
    try {
      if (body.accion === "guardar") {
        const licencia = body.licencia;
        if (!licencia || typeof licencia !== "object" || Array.isArray(licencia)) return badRequest("Faltan los datos de la licencia.");
        const id = await guardarLicencia(parseLicencia(licencia as Record<string, unknown>), acceso.user.email);
        return jsonNoStore({ ok: true, idLicencia: id });
      }
      if (body.accion === "asignar") {
        const idAgent = Number(body.idAgent);
        const idLicencia = body.idLicencia === null ? null : Number(body.idLicencia);
        if (!Number.isInteger(idAgent) || idAgent <= 0) return badRequest("Agente inválido.");
        if (idLicencia !== null && (!Number.isInteger(idLicencia) || idLicencia <= 0)) return badRequest("Licencia inválida.");
        await asignarAgente(idAgent, idLicencia, acceso.user.email);
        return jsonNoStore({ ok: true });
      }
      return badRequest("Acción desconocida.");
    } catch (e) {
      if (e instanceof LicenciasValidacionError) return jsonNoStore({ error: e.message }, { status: 409 });
      if (e instanceof LicenciasNoDisponibles) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/licencias", error);
  }
}
