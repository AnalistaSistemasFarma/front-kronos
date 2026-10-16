import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { identificar } from '../../../../../lib/portal/acceso';
import { editoresDeBanners } from '../../../../../lib/portal/config';

/**
 * PORTAL TH — quitar un evento de la empresa del calendario.
 *
 *   DELETE /api/portal/eventos/:id   — solo los editores del portal. Borrado LÓGICO: queda quién lo quitó y cuándo.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ eventoId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!editoresDeBanners().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo Talento Humano puede quitar eventos.' }, { status: 403 });
  }
  const id = Number((await params).eventoId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Evento no válido.' }, { status: 400 });
  try {
    const r = await prisma.portalEvento.updateMany({
      where: { id, eliminado_at: null },
      data: { eliminado_at: new Date(), eliminado_by: quien.correo },
    });
    if (r.count === 0) return NextResponse.json({ error: 'Evento no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[portal] DELETE /api/portal/eventos/[id]:', (error as Error).name);
    return NextResponse.json({ error: 'No se pudo quitar el evento.' }, { status: 500 });
  }
}
