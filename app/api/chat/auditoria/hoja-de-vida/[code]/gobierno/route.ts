import {
  agentCodeInScope,
  canConfigureAgents,
  getAuditScope,
} from '../../../../../../../lib/chat/audit-access';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../../../lib/chat/http';
import { EntradaInvalidaError, validarGobierno } from '../../../../../../../lib/agent-audit/cv-completa';
import { guardarGobierno } from '../../../../../../../lib/agent-audit/cv-completa-db';

export const dynamic = 'force-dynamic';

/**
 * EDITAR EL GOBIERNO DECLARADO de un agente (hoja de vida, incremento 1).
 *
 *   PUT /api/chat/auditoria/hoja-de-vida/<code>/gobierno
 *   { "directorName", "directorEmail", "privilegeTemplate", "privilegeAppliedOn": "YYYY-MM-DD", "notes" }
 *
 * Mismo permiso que editar propósito y dueño: el subproceso de configurar
 * (ser administrador no alcanza). Cada cambio queda en la línea de tiempo con
 * el correo de quien lo hizo.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canConfigureAgents(user.email))) {
      return jsonNoStore(
        { error: 'Editar el gobierno del agente requiere el permiso «Auditoría de agentes · Configurar».' },
        { status: 403 }
      );
    }
    let entrada;
    try {
      entrada = validarGobierno(await readJsonBody(request));
    } catch (err) {
      if (err instanceof EntradaInvalidaError) return badRequest(err.message);
      throw err;
    }
    const codigo = decodeURIComponent((await params).code).toLowerCase();
    if (!(await agentCodeInScope(await getAuditScope(user.email), codigo))) {
      return jsonNoStore({ error: 'Ese agente está fuera de las empresas que usted puede auditar.' }, { status: 403 });
    }
    const r = await guardarGobierno(codigo, entrada, user.email);
    if (!r) return jsonNoStore({ error: 'No existe ese agente.' }, { status: 404 });
    return jsonNoStore({ ok: true, cambios: r.cambios });
  } catch (error) {
    return serverError('PUT /api/chat/auditoria/hoja-de-vida/[code]/gobierno', error);
  }
}
