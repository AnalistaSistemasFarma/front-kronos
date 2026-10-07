import { NextResponse } from 'next/server';
import { isStoreUnavailable, svgResponse } from '../../../../../lib/avatar/http';
import { readAvatarConfig } from '../../../../../lib/avatar/store';
import { resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import { prisma } from '../../../../../lib/prisma';

/**
 * GET /api/avatar/user/<id>?v=<versión> → SVG del avatar estilo Notion de una persona.
 *
 * Lo pinta cualquier pantalla que muestre `user.image` (encabezado, chat,
 * grupos), así que basta con tener sesión: es la misma cara que ya ve
 * cualquiera que comparta un chat con esa persona.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await resolveSessionUser();
    if (!viewer) return unauthorized();

    const { id } = await params;
    if (!id || id.length > 200) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });

    const fila = await readAvatarConfig('user', id);
    if (!fila) return NextResponse.json({ error: 'Esta persona no tiene avatar.' }, { status: 404 });

    const persona = await prisma.user.findUnique({ where: { id }, select: { name: true } });
    return svgResponse(fila.configJson, persona?.name ?? 'Avatar', fila.updatedAt.getTime());
  } catch (error) {
    if (isStoreUnavailable(error)) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });
    return serverError('GET /api/avatar/user/[id]', error);
  }
}
