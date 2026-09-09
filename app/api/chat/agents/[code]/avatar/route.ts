import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { checkAdminPrivileges } from '../../../../../../lib/access-control';
import { getChatAccess } from '../../../../../../lib/chat/access';
import {
  badRequest,
  forbidden,
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../../lib/chat/http';
import {
  AVATAR_MIMES_PERMITIDOS,
  MAX_AVATAR_BYTES,
} from '../../../../../../lib/chat/client';

/**
 * FOTO DE UN AGENTE — leer y reemplazar.
 *
 *   GET  /api/chat/agents/<code>/avatar        → la imagen
 *   POST /api/chat/agents/<code>/avatar        → la reemplaza (solo administradores)
 *
 * Por qué la imagen se sirve desde aquí y no desde /public: Next resuelve esa
 * carpeta con una lista armada en tiempo de compilación, así que un archivo
 * copiado al servidor da 404 hasta el siguiente despliegue. Con eso, un botón
 * de "cambiar la foto" sería mentira. Ver la migración agent_avatar_blob.
 */

/** Un agente que la persona pueda ver, resuelto por `code`. */
async function agenteVisible(code: string, userEmail: string) {
  const access = await getChatAccess(userEmail);
  if (!access.canUseChat) return null;
  // El alcance sale de getChatAccess, no del `code` que llegó por la URL: así
  // nadie puede sondear la existencia de agentes que no le corresponden.
  return access.agents.find((a) => a.code === code) ?? null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const { code } = await params;
    if (!(await agenteVisible(code, user.email))) return forbidden();

    const row = await prisma.agent.findUnique({
      where: { code },
      select: { avatar_blob: true, avatar_mime: true, avatar_updated_at: true },
    });

    if (!row?.avatar_blob || !row.avatar_updated_at) {
      // 404 y no un error: la interfaz cae al avatar por inicial, que es el
      // camino normal de casi todos los agentes.
      return NextResponse.json({ error: 'Este agente no tiene foto.' }, { status: 404 });
    }

    const bytes = Buffer.from(row.avatar_blob);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': row.avatar_mime ?? 'image/jpeg',
        'Content-Length': String(bytes.byteLength),
        // Caché agresiva Y correcta: la URL lleva ?v=<fecha de subida>, así que
        // al reemplazar la foto cambia la URL y el navegador pide la nueva. Es
        // privada porque la imagen solo la puede ver quien tenga el agente.
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: `"${row.avatar_updated_at.getTime()}"`,
      },
    });
  } catch (error) {
    return serverError('GET /api/chat/agents/[code]/avatar', error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    // La reja de verdad: cambiarle la cara a un agente lo ve TODA la empresa,
    // así que es cosa de administradores. Esconder el botón no protege nada.
    if (!(await checkAdminPrivileges(user.email))) {
      return forbidden('Solo un administrador puede cambiar la foto de un asistente.');
    }

    const { code } = await params;
    const agente = await prisma.agent.findUnique({ where: { code }, select: { id_agent: true } });
    if (!agente) return badRequest('Ese asistente no existe.');

    const form = await request.formData();
    const archivo = form.get('file');
    if (!(archivo instanceof File)) return badRequest('Falta la imagen.');

    const mime = (archivo.type || '').toLowerCase();
    if (!AVATAR_MIMES_PERMITIDOS.includes(mime)) {
      return badRequest(`Formato no admitido (${mime || 'desconocido'}). Use JPG, PNG o WebP.`);
    }
    if (archivo.size > MAX_AVATAR_BYTES) {
      // El navegador ya la reduce a 512×512 antes de subirla; si llega grande,
      // es que la subió otra cosa. Se rechaza en el servidor de todas formas:
      // una validación que solo vive en el cliente no es una validación.
      return badRequest('La imagen es muy grande. El tope es 512 KB.');
    }
    if (archivo.size === 0) return badRequest('La imagen llegó vacía.');

    const bytes = Buffer.from(await archivo.arrayBuffer());
    const cuando = new Date();

    await prisma.agent.update({
      where: { id_agent: agente.id_agent },
      data: { avatar_blob: bytes, avatar_mime: mime, avatar_updated_at: cuando },
    });

    // Se devuelve la versión para que la interfaz refresque la imagen sin
    // recargar: la URL nueva (?v=…) es distinta de la que tenía en caché.
    return jsonNoStore({ ok: true, avatarVersion: cuando.getTime() });
  } catch (error) {
    return serverError('POST /api/chat/agents/[code]/avatar', error);
  }
}
