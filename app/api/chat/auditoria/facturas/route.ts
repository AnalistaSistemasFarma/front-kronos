import { NextRequest } from "next/server";
import { canAuditAgents, getAuditScope } from "../../../../../lib/chat/audit-access";
import { badRequest, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from "../../../../../lib/chat/http";
import {
  eliminarFactura,
  FacturasNoDisponibles,
  FacturasValidacionError,
  guardarFactura,
  guardarReparto,
  leerFacturas,
  parseFactura,
  repartirPorLicencias,
} from "../../../../../lib/agent-audit/facturas-db";

export const dynamic = "force-dynamic";

/**
 * FACTURAS DE IA (Auditoría de agentes, Nicolás 2026-11-17).
 *   GET  ?anio=2026 → facturas del año, totales por empresa (pagado y lo que le corresponde), por mes y proveedor.
 *   POST { accion: "guardar", factura }                 crea o edita (con líneas y PDF en base64)
 *        { accion: "eliminar", idFactura }
 *        { accion: "repartir", idFactura }              reparto sugerido por las licencias de la organización
 *        { accion: "reparto", idFactura, reparto: [{ idEmpresa, empresa, monto }] }   reparto manual
 * Solo administración (auditoría con alcance total).
 */
async function soloAdministracion() {
  const user = await resolveSessionUser();
  if (!user) return { error: unauthorized() };
  if (!(await canAuditAgents(user.email)) || !(await getAuditScope(user.email)).all)
    return { error: jsonNoStore({ error: "Las facturas de IA son solo para la administración." }, { status: 403 }) };
  return { user };
}

export async function GET(request: NextRequest) {
  try {
    const acceso = await soloAdministracion();
    if (acceso.error) return acceso.error;
    const anioTxt = request.nextUrl.searchParams.get("anio");
    const anio = anioTxt ? Number(anioTxt) : new Date().getUTCFullYear();
    if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return badRequest("Año inválido.");
    try {
      return jsonNoStore(await leerFacturas(anio));
    } catch (e) {
      if (e instanceof FacturasNoDisponibles) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("GET /api/chat/auditoria/facturas", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const acceso = await soloAdministracion();
    if (acceso.error) return acceso.error;
    const body = await readJsonBody(request);
    if (!body) return badRequest("El cuerpo debe ser un objeto JSON.");
    const id = Number(body.idFactura);
    try {
      switch (body.accion) {
        case "guardar": {
          const f = body.factura;
          if (!f || typeof f !== "object" || Array.isArray(f)) return badRequest("Faltan los datos de la factura.");
          return jsonNoStore({ ok: true, idFactura: await guardarFactura(parseFactura(f as Record<string, unknown>), acceso.user.email) });
        }
        case "eliminar":
          if (!Number.isInteger(id) || id <= 0) return badRequest("Factura inválida.");
          await eliminarFactura(id);
          return jsonNoStore({ ok: true });
        case "repartir":
          if (!Number.isInteger(id) || id <= 0) return badRequest("Factura inválida.");
          return jsonNoStore({ ok: true, reparto: await repartirPorLicencias(id) });
        case "reparto": {
          if (!Number.isInteger(id) || id <= 0) return badRequest("Factura inválida.");
          if (!Array.isArray(body.reparto)) return badRequest("Falta el reparto.");
          const reparto = (body.reparto as Record<string, unknown>[]).map((r) => ({
            idEmpresa: Number(r.idEmpresa),
            empresa: String(r.empresa ?? ""),
            monto: Math.round(Number(r.monto) * 100) / 100,
          }));
          if (reparto.some((r) => !Number.isFinite(r.monto))) return badRequest("Monto inválido en el reparto.");
          await guardarReparto(id, reparto, "manual");
          return jsonNoStore({ ok: true });
        }
        default:
          return badRequest("Acción desconocida.");
      }
    } catch (e) {
      if (e instanceof FacturasValidacionError) return jsonNoStore({ error: e.message }, { status: 409 });
      if (e instanceof FacturasNoDisponibles) return jsonNoStore({ error: e.message }, { status: 503 });
      throw e;
    }
  } catch (error) {
    return serverError("POST /api/chat/auditoria/facturas", error);
  }
}
