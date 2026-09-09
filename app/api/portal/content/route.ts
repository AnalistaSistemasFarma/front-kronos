import { NextRequest, NextResponse } from 'next/server';
import { leerSesion } from '../../../../lib/portal/auth';
import { COOKIE_SESION } from '../../../../lib/portal/config';
import { leerContenido } from '../../../../lib/portal/sharepoint';

/**
 * El contenido del portal: documentos con su portada, y banners.
 *
 *   GET /api/portal/content
 *
 * Exige la sesión del portal. No se cachea en el navegador: Talento Humano
 * sube un anuncio y tiene que verse, no aparecer mañana.
 */
export async function GET(request: NextRequest) {
  const correo = leerSesion(request.cookies.get(COOKIE_SESION)?.value);
  if (!correo) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const contenido = await leerContenido();
    return NextResponse.json(
      { ...contenido, email: correo },
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
