import { NextRequest } from 'next/server';
import { parseAvatarConfig } from '../../../../lib/avatar/compose';
import { isStoreUnavailable, storeUnavailable } from '../../../../lib/avatar/http';
import { getUserAvatar, removeUserAvatar, saveUserAvatar } from '../../../../lib/avatar/service';
import { badRequest, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';

/**
 * AVATAR ESTILO NOTION DE LA PROPIA PERSONA (Perfil).
 *
 *   GET    /api/profile/avatar  → { disponible, config, image }
 *   PUT    /api/profile/avatar  → guarda { config }; responde la nueva `image`
 *   DELETE /api/profile/avatar  → quita el avatar y vuelve a la foto anterior
 *
 * El usuario sale SIEMPRE de la sesión: nadie puede cambiar el avatar de otro.
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    try {
      const estado = await getUserAvatar(user.id);
      return jsonNoStore({ disponible: true, ...estado });
    } catch (error) {
      if (isStoreUnavailable(error)) return jsonNoStore({ disponible: false, config: null, image: null });
      throw error;
    }
  } catch (error) {
    return serverError('GET /api/profile/avatar', error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const body = (await request.json().catch(() => null)) as { config?: unknown } | null;
    const config = parseAvatarConfig(body?.config);
    if (!config) return badRequest('La configuración del avatar no es válida.');
    if (config.tipo !== 'persona') return badRequest('El avatar de una persona debe ser de tipo persona.');

    const image = await saveUserAvatar(user.id, user.email, config);
    return jsonNoStore({ ok: true, image, config });
  } catch (error) {
    if (isStoreUnavailable(error)) return storeUnavailable();
    return serverError('PUT /api/profile/avatar', error);
  }
}

export async function DELETE() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const image = await removeUserAvatar(user.id, user.email);
    return jsonNoStore({ ok: true, image });
  } catch (error) {
    if (isStoreUnavailable(error)) return storeUnavailable();
    return serverError('DELETE /api/profile/avatar', error);
  }
}
