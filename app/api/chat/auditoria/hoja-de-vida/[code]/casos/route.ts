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
import { EntradaInvalidaError, validarVinculoCaso } from '../../../../../../../lib/agent-audit/cv-completa';
import { desvincularCaso, vincularCaso, VinculoError } from '../../../../../../../lib/agent-audit/cv-completa-db';

export const dynamic = 'force-dynamic';

/**
 * CASOS DE SYNERLINK VINCULADOS a un agente (hoja de vida, incremento 1).
 *
 *   POST   …/<code>/casos   { "idRequest": 6212, "relation": "gobierno-ia" }
 *   DELETE …/<code>/casos?caso=6212
 *
 * Solo con el permiso de configurar. El caso debe existir en esta base. La
 * ficha muestra número, proceso, asunto, estado y tareas; nunca la descripción.
 */
async function preparar(request: Request, params: Promise<{ code: string }>) {
  const user = await resolveSessionUser();
  if (!user) return { error: unauthorized() };
  if (!(await canConfigureAgents(user.email))) {
    return {
      error: jsonNoStore(
        { error: 'Vincular casos requiere el permiso «Auditoría de agentes · Configurar».' },
        { status: 403 }
      ),
    };
  }
  const codigo = decodeURIComponent((await params).code).toLowerCase();
  if (!(await agentCodeInScope(await getAuditScope(user.email), codigo))) {
    return { error: jsonNoStore({ error: 'Ese agente está fuera de las empresas que usted puede auditar.' }, { status: 403 }) };
  }
  return { user, codigo };
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const p = await preparar(request, params);
    if ('error' in p) return p.error;
    let entrada;
    try {
      entrada = validarVinculoCaso(await readJsonBody(request));
    } catch (err) {
      if (err instanceof EntradaInvalidaError) return badRequest(err.message);
      throw err;
    }
    const r = await vincularCaso(p.codigo, entrada.idRequest, entrada.relation, p.user.email);
    if (!r) return jsonNoStore({ error: 'No existe ese agente.' }, { status: 404 });
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof VinculoError) return jsonNoStore({ error: error.message }, { status: error.status });
    return serverError('POST /api/chat/auditoria/hoja-de-vida/[code]/casos', error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const p = await preparar(request, params);
    if ('error' in p) return p.error;
    const caso = Number(new URL(request.url).searchParams.get('caso'));
    if (!Number.isInteger(caso) || caso <= 0) return badRequest('Número de caso inválido.');
    const r = await desvincularCaso(p.codigo, caso, p.user.email);
    if (!r) return jsonNoStore({ error: 'No existe ese agente.' }, { status: 404 });
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof VinculoError) return jsonNoStore({ error: error.message }, { status: error.status });
    return serverError('DELETE /api/chat/auditoria/hoja-de-vida/[code]/casos', error);
  }
}
