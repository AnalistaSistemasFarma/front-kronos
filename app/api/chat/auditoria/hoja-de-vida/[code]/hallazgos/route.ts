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
import { EntradaInvalidaError, validarHallazgoExterno } from '../../../../../../../lib/agent-audit/cv-completa';
import { registrarHallazgoExterno, VinculoError } from '../../../../../../../lib/agent-audit/cv-completa-db';

export const dynamic = 'force-dynamic';

/**
 * HALLAZGOS DE GOBIERNO IA (auditoría de Iván Gutiérrez) de un agente.
 *
 *   POST …/<code>/hallazgos
 *   { "refCode": "H-01", "severity": "alto", "title", "detail", "recommendation",
 *     "reportedOn": "YYYY-MM-DD", "idRequest"?: 6212, "source"? }
 *
 * Solo con el permiso de configurar. A diferencia de los hallazgos automáticos
 * del inventario, estos no se cierran solos: se cierran a mano
 * (PATCH …/hallazgos/<id>).
 */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canConfigureAgents(user.email))) {
      return jsonNoStore(
        { error: 'Registrar hallazgos requiere el permiso «Auditoría de agentes · Configurar».' },
        { status: 403 }
      );
    }
    let entrada;
    try {
      entrada = validarHallazgoExterno(await readJsonBody(request));
    } catch (err) {
      if (err instanceof EntradaInvalidaError) return badRequest(err.message);
      throw err;
    }
    const codigo = decodeURIComponent((await params).code).toLowerCase();
    if (!(await agentCodeInScope(await getAuditScope(user.email), codigo))) {
      return jsonNoStore({ error: 'Ese agente está fuera de las empresas que usted puede auditar.' }, { status: 403 });
    }
    const r = await registrarHallazgoExterno(codigo, entrada, user.email);
    if (!r) return jsonNoStore({ error: 'No existe ese agente.' }, { status: 404 });
    return jsonNoStore({ ok: true, id: r.id });
  } catch (error) {
    if (error instanceof VinculoError) return jsonNoStore({ error: error.message }, { status: error.status });
    return serverError('POST /api/chat/auditoria/hoja-de-vida/[code]/hallazgos', error);
  }
}
