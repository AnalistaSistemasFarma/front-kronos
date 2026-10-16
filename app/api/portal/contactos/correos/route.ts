import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { leerCorreosCorporativos } from '@/lib/portal/contactos';

/**
 * Correos corporativos con licencia activa de M365, por empresa.
 *
 *   GET /api/portal/contactos/correos
 *
 * Exige la misma identidad que el resto del contenido del portal: es
 * directorio corporativo completo, no algo para dejar abierto sin sesión.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const grupos = await leerCorreosCorporativos();
    return NextResponse.json({ grupos }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('[portal] GET /api/portal/contactos/correos', error);
    return NextResponse.json(
      { error: 'No se pudo leer los correos corporativos. Intente en un momento.' },
      { status: 502 }
    );
  }
}
