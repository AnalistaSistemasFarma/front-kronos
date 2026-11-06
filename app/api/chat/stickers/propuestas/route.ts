import { checkAdminPrivileges } from '../../../../../lib/access-control';
import { forbidden, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import { MisStickersNoDisponibles, propuestasPendientes } from '../../../../../lib/chat/stickers-personales';

export const dynamic = 'force-dynamic';

/**
 * Propuestas de stickers por revisar (2026-10-21). SOLO administradores
 * (checkAdminPrivileges, la misma reja del mensaje masivo).
 *
 *   GET /api/chat/stickers/propuestas   -> { propuestas: PropuestaDto[] }
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await checkAdminPrivileges(user.email))) return forbidden('Solo un administrador revisa las propuestas.');
    const lista = await propuestasPendientes();
    if (!lista) return jsonNoStore({ error: new MisStickersNoDisponibles().message }, { status: 503 });
    return jsonNoStore({ propuestas: lista });
  } catch (error) {
    return serverError('GET /api/chat/stickers/propuestas', error);
  }
}
