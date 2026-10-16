import { listManagedAgents } from '../../../../../lib/avatar/service';
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';

/**
 * GET /api/profile/avatar/agents → agentes cuyo avatar puede cambiar la persona
 * (es su responsable o es administrador; ver listManagedAgents).
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const agentes = await listManagedAgents(user.email);
    return jsonNoStore({ agentes });
  } catch (error) {
    return serverError('GET /api/profile/avatar/agents', error);
  }
}
