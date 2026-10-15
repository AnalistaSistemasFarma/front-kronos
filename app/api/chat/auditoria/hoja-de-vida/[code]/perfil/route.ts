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
import { PerfilInvalidoError, validarPerfil } from '../../../../../../../lib/agent-audit/cv';
import { guardarPerfil } from '../../../../../../../lib/agent-audit/cv-db';

export const dynamic = 'force-dynamic';

/**
 * EDITAR PROPÓSITO Y DUEÑO de un agente (hoja de vida, F2).
 *
 *   PUT /api/chat/auditoria/hoja-de-vida/<code>/perfil
 *   { "purpose": "…", "ownerName": "…", "ownerEmail": "…" }
 *
 * Solo con el permiso de configurar (subproceso /process/chat/auditoria/
 * configurar, con nombre propio; ser administrador no alcanza). Cada cambio
 * queda en la línea de tiempo con el correo de quien lo hizo. Fuera de la
 * administración, solo agentes de las empresas del usuario (getAuditScope).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canConfigureAgents(user.email))) {
      return jsonNoStore(
        { error: 'Editar la hoja de vida requiere el permiso «Auditoría de agentes · Configurar».' },
        { status: 403 }
      );
    }
    const body = await readJsonBody(request);
    let entrada;
    try {
      entrada = validarPerfil(body);
    } catch (err) {
      if (err instanceof PerfilInvalidoError) return badRequest(err.message);
      throw err;
    }
    const { code } = await params;
    const codigo = decodeURIComponent(code).toLowerCase();
    if (!(await agentCodeInScope(await getAuditScope(user.email), codigo))) {
      return jsonNoStore(
        { error: 'Ese agente está fuera de las empresas que usted puede auditar.' },
        { status: 403 }
      );
    }
    const r = await guardarPerfil(codigo, entrada, user.email);
    if (!r) return jsonNoStore({ error: 'No existe ese agente.' }, { status: 404 });
    return jsonNoStore({ ok: true, cambios: r.cambios });
  } catch (error) {
    return serverError('PUT /api/chat/auditoria/hoja-de-vida/[code]/perfil', error);
  }
}
