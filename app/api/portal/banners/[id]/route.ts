import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { identificar } from '../../../../../lib/portal/acceso';
import { editoresDeBanners } from '../../../../../lib/portal/config';

/**
 * UN anuncio: verlo o quitarlo.
 *
 *   GET    /api/portal/banners/3   → la imagen (cualquiera con sesión)
 *   DELETE /api/portal/banners/3   → lo quita (solo editores)
 */
async function idDeLaRuta(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params;
  const n = Number.parseInt(id, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const quien = await identificar(request);
    if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

    const id = await idDeLaRuta(params);
    if (id === null) return NextResponse.json({ error: 'Anuncio no válido.' }, { status: 400 });

    const fila = await prisma.portalBanner.findUnique({
      where: { id },
      select: { contenido: true, mime: true, created_at: true },
    });
    if (!fila) return NextResponse.json({ error: 'No existe ese anuncio.' }, { status: 404 });

    const bytes = Buffer.from(fila.contenido);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': fila.mime,
        'Content-Length': String(bytes.byteLength),
        // Un anuncio no cambia: si lo reemplazan, es otro id. Por eso se puede
        // cachear fuerte sin quedar mostrando algo viejo.
        'Cache-Control': 'private, max-age=86400',
        ETag: `"${fila.created_at.getTime()}"`,
      },
    });
  } catch (error) {
    console.error('[portal] GET /api/portal/banners/[id]', error);
    return NextResponse.json({ error: 'No se pudo abrir el anuncio.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const quien = await identificar(request);
    if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

    if (!editoresDeBanners().includes(quien.correo.toLowerCase())) {
      return NextResponse.json({ error: 'Solo Talento Humano puede quitar anuncios.' }, { status: 403 });
    }

    const id = await idDeLaRuta(params);
    if (id === null) return NextResponse.json({ error: 'Anuncio no válido.' }, { status: 400 });

    // deleteMany y no delete: borrar uno que ya no está no es un error que
    // valga la pena mostrarle a nadie.
    const { count } = await prisma.portalBanner.deleteMany({ where: { id } });
    console.warn(`[portal] anuncio ${id} quitado por ${quien.correo} (filas: ${count})`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[portal] DELETE /api/portal/banners/[id]', error);
    return NextResponse.json({ error: 'No se pudo quitar el anuncio.' }, { status: 500 });
  }
}
