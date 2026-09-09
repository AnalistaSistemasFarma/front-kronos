import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { identificar } from '../../../../lib/portal/acceso';
import { editoresDeBanners } from '../../../../lib/portal/config';
import { leerContenido } from '../../../../lib/portal/sharepoint';

/**
 * El contenido del portal: documentos con su portada, y banners.
 *
 *   GET /api/portal/content
 *
 * Exige identidad: la sesión de SynerLink con el módulo asignado, o el código
 * del portal abierto. No se cachea en el navegador: Talento Humano sube un
 * anuncio y tiene que verse, no aparecer mañana.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    // Los documentos vienen de SharePoint; los anuncios, de la base — se
    // cargan desde el propio portal. Se piden a la vez: son independientes y
    // esperar uno detrás del otro solo haría la página más lenta.
    const [contenido, banners] = await Promise.all([
      leerContenido(),
      prisma.portalBanner.findMany({
        orderBy: [{ orden: 'asc' }, { id: 'desc' }],
        select: { id: true, file_name: true, created_at: true },
      }),
    ]);

    return NextResponse.json(
      {
        ...contenido,
        banners: banners.map((b) => ({
          id: b.id,
          titulo: b.file_name.replace(/\.[^.]+$/, ''),
          url: `/api/portal/banners/${b.id}`,
        })),
        email: quien.correo,
        via: quien.via,
        // Para saber si pintar el botón de cargar. La reja de verdad está en
        // el endpoint: esconder un botón no protege nada.
        puedeEditar: editoresDeBanners().includes(quien.correo.toLowerCase()),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('[portal] GET /api/portal/content', error);
    return NextResponse.json(
      { error: 'No se pudo leer el contenido. Intente en un momento.' },
      { status: 502 }
    );
  }
}
