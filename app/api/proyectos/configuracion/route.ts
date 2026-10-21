import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';
import { empresasConfigurables, guardarCambioConfig, vistaConfigEmpresa } from '../../../../lib/proyectos/config-agentes';
import { validarCambio } from '../../../../lib/proyectos/config-agentes-rules';
import type { AccesoConfigDto, ConfigEmpresaDto } from '../../../../lib/proyectos/config-agentes-tipos';

export const dynamic = 'force-dynamic';

/**
 * CONFIGURACIÓN del módulo «Proyectos» (2026-10-20, pedido de Nicolás Rivera).
 *
 *   GET  /api/proyectos/configuracion               empresas que la persona puede configurar
 *   GET  /api/proyectos/configuracion?company=3     agentes de esa empresa, su estado y el registro
 *   POST /api/proyectos/configuracion  { company, idAgent, enabled, profiles[], reason }
 *
 * SEGURIDAD
 *   - La persona sale de la SESIÓN.
 *   - Solo quien tenga el permiso /process/proyectos/configuracion EN ESA
 *     empresa, o la administración de SynerLink (lib/proyectos/config-agentes.ts).
 *   - Sin permiso: 403 (la pantalla dice por qué; no expone datos).
 *   - Un agente sin puente de proyectos no se puede cambiar (409).
 */
const sinPermiso = () => jsonNoStore({ error: 'No tiene permiso para configurar Proyectos en esta empresa.' }, { status: 403 });

export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const acceso = await empresasConfigurables(user.email);
    const raw = request.nextUrl.searchParams.get('company');
    if (raw === null) {
      const dto: AccesoConfigDto = acceso;
      return jsonNoStore(dto);
    }

    const idCompany = Number.parseInt(raw, 10);
    if (!Number.isInteger(idCompany) || idCompany <= 0) return badRequest('Empresa inválida.');
    if (!acceso.companies.some((c) => c.idCompany === idCompany)) return sinPermiso();

    const dto: ConfigEmpresaDto = await vistaConfigEmpresa(idCompany);
    return jsonNoStore(dto);
  } catch (error) {
    return serverError('GET /api/proyectos/configuracion', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const v = validarCambio(payload);
    if (!v.ok) return badRequest(v.error);

    const acceso = await empresasConfigurables(user.email);
    if (!acceso.companies.some((c) => c.idCompany === v.value.idCompany)) return sinPermiso();

    const r = await guardarCambioConfig(user.id, v.value);
    if (!r.ok) return jsonNoStore({ error: r.error }, { status: r.status });
    return jsonNoStore({ ok: true, copiados: r.copiados });
  } catch (error) {
    return serverError('POST /api/proyectos/configuracion', error);
  }
}
