import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { identificar } from '../../../../lib/portal/acceso';
import {
  BANNER_MIMES_PERMITIDOS,
  MAX_BANNER_BYTES,
  editoresDeBanners,
} from '../../../../lib/portal/config';

/**
 * ANUNCIOS del portal — cargar uno nuevo.
 *
 *   POST /api/portal/banners   (multipart con `file`)
 *
 * Pedido de Cristian (2026-09-09): poder alimentar la cartelera desde el
 * portal, y que solo él la pueda modificar.
 *
 * ⚠️ VER un anuncio lo puede cualquiera que entre al portal; CARGARLO, solo
 * quien esté en la lista de editores. Son dos permisos distintos a propósito:
 * el portal es de consulta para toda la empresa y la cartelera la maneja
 * Talento Humano.
 */
export async function POST(request: NextRequest) {
  try {
    const quien = await identificar(request);
    if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

    if (!editoresDeBanners().includes(quien.correo.toLowerCase())) {
      return NextResponse.json(
        { error: 'Solo Talento Humano puede cargar anuncios.' },
        { status: 403 }
      );
    }

    const form = await request.formData();
    const archivo = form.get('file');
    if (!(archivo instanceof File)) {
      return NextResponse.json({ error: 'Falta la imagen.' }, { status: 400 });
    }

    const mime = (archivo.type || '').toLowerCase();
    if (!BANNER_MIMES_PERMITIDOS.includes(mime)) {
      return NextResponse.json(
        { error: `Formato no admitido (${mime || 'desconocido'}). Use JPG, PNG o WebP.` },
        { status: 400 }
      );
    }
    if (archivo.size === 0) return NextResponse.json({ error: 'La imagen llegó vacía.' }, { status: 400 });
    if (archivo.size > MAX_BANNER_BYTES) {
      // El navegador ya la reduce antes de subirla; si llega grande es que la
      // subió otra cosa. Se valida igual acá: una comprobación que solo vive
      // en el cliente no es una comprobación.
      return NextResponse.json({ error: 'La imagen es muy grande. El tope es 2 MB.' }, { status: 400 });
    }

    const creado = await prisma.portalBanner.create({
      data: {
        file_name: archivo.name.slice(0, 255) || 'anuncio',
        mime,
        contenido: Buffer.from(await archivo.arrayBuffer()),
        uploaded_by: quien.correo,
      },
      select: { id: true, file_name: true, created_at: true },
    });

    return NextResponse.json({ ok: true, banner: creado }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[portal] POST /api/portal/banners', error);
    return NextResponse.json({ error: 'No se pudo cargar el anuncio.' }, { status: 500 });
  }
}
