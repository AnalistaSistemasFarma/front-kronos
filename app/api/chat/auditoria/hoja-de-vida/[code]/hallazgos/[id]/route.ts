import {
  agentCodeInScope,
  canConfigureAgents,
  getAuditScope,
} from '../../../../../../../../lib/chat/audit-access';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../../../../lib/chat/http';
import { EntradaInvalidaError, validarEstadoHallazgo } from '../../../../../../../../lib/agent-audit/cv-completa';
import { cambiarEstadoHallazgoExterno, VinculoError } from '../../../../../../../../lib/agent-audit/cv-completa-db';

export const dynamic = 'force-dynamic';

/**
 * CAMBIAR EL ESTADO de un hallazgo de Gobierno IA: «resuelto», «aceptado»
 * (riesgo aceptado) o «abierto» (reabrir). Solo con el permiso de configurar.
 *
 *   PATCH …/<code>/hallazgos/<id>   { "status": "resuelto" }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canConfigureAgents(user.email))) {
      return jsonNoStore(
        { error: 'Cambiar hallazgos requiere el permiso «Auditoría de agentes · Configurar».' },
        { status: 403 }
      );
    }
    let entrada;
    try {
      entrada = validarEstadoHallazgo(await readJsonBody(request));
    } catch (err) {
      if (err instanceof EntradaInvalidaError) return badRequest(err.message);
      throw err;
    }
    const { code, id } = await params;
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return badRequest('Hallazgo inválido.');
    const codigo = decodeURIComponent(code).toLowerCase();
    if (!(await agentCodeInScope(await getAuditScope(user.email), codigo))) {
      return jsonNoStore({ error: 'Ese agente está fuera de las empresas que usted puede auditar.' }, { status: 403 });
    }
    const r = await cambiarEstadoHallazgoExterno(codigo, n, entrada.status, user.email);
    if (!r) return jsonNoStore({ error: 'No existe ese agente.' }, { status: 404 });
    return jsonNoStore(r);
  } catch (error) {
    if (error instanceof VinculoError) return jsonNoStore({ error: error.message }, { status: error.status });
    return serverError('PATCH /api/chat/auditoria/hoja-de-vida/[code]/hallazgos/[id]', error);
  }
}
