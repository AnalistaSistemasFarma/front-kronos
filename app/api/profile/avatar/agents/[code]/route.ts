import { NextRequest } from 'next/server';
import { parseAvatarConfig } from '../../../../../../lib/avatar/compose';
import { isStoreUnavailable, storeUnavailable } from '../../../../../../lib/avatar/http';
import { findManagedAgent, removeAgentAvatar, saveAgentAvatar } from '../../../../../../lib/avatar/service';
import {
  badRequest,
  forbidden,
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../../lib/chat/http';

/**
 * AVATAR ESTILO NOTION DE UN AGENTE.
 *
 *   PUT    /api/profile/avatar/agents/<code>  → guarda { config } (animal o persona)
 *   DELETE /api/profile/avatar/agents/<code>  → vuelve a la imagen anterior
 *
 * La reja de verdad es findManagedAgent (responsable o administrador): que el
 * botón no aparezca en el Perfil no protege nada.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const { code } = await params;
    const agente = await findManagedAgent(user.email, code);
    if (!agente) return forbidden('No tiene permiso para cambiar el avatar de este asistente.');

    const body = (await request.json().catch(() => null)) as { config?: unknown } | null;
    const config = parseAvatarConfig(body?.config);
    if (!config) return badRequest('La configuración del avatar no es válida.');

    const avatarUrl = await saveAgentAvatar(agente, user.email, config);
    return jsonNoStore({ ok: true, avatarUrl, config });
  } catch (error) {
    if (isStoreUnavailable(error)) return storeUnavailable();
    return serverError('PUT /api/profile/avatar/agents/[code]', error);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const { code } = await params;
    const agente = await findManagedAgent(user.email, code);
    if (!agente) return forbidden('No tiene permiso para cambiar el avatar de este asistente.');

    const avatarUrl = await removeAgentAvatar(agente, user.email);
    return jsonNoStore({ ok: true, avatarUrl });
  } catch (error) {
    if (isStoreUnavailable(error)) return storeUnavailable();
    return serverError('DELETE /api/profile/avatar/agents/[code]', error);
  }
}
