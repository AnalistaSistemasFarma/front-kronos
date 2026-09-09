import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '../../../../lib/portal/acceso';
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
    const contenido = await leerContenido();
    return NextResponse.json(
      { ...contenido, email: quien.correo, via: quien.via },
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
