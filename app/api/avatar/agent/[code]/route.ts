import { NextResponse } from 'next/server';
import { isStoreUnavailable, svgResponse } from '../../../../../lib/avatar/http';
import { readAvatarConfig } from '../../../../../lib/avatar/store';
import { resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import { prisma } from '../../../../../lib/prisma';

/**
 * GET /api/avatar/agent/<code>?v=<versión> → SVG del avatar estilo Notion de un agente.
 *
 * Basta con sesión: la cara de un agente aparece en grupos y menciones de
 * personas que no necesariamente tienen permiso para chatear con él (igual
 * que hoy pasa con las imágenes de /public/agents).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const viewer = await resolveSessionUser();
    if (!viewer) return unauthorized();

    const { code } = await params;
    if (!code || code.length > 60) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });

    const agente = await prisma.agent.findUnique({ where: { code }, select: { id_agent: true, display_name: true } });
    if (!agente) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });

    const fila = await readAvatarConfig('agent', String(agente.id_agent));
    if (!fila) return NextResponse.json({ error: 'Este agente no tiene avatar.' }, { status: 404 });

    return svgResponse(fila.configJson, agente.display_name, fila.updatedAt.getTime(), 'agent');
  } catch (error) {
    if (isStoreUnavailable(error)) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });
    return serverError('GET /api/avatar/agent/[code]', error);
  }
}
