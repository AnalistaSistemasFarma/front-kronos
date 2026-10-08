import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { leerExtensionesCorporativas } from '@/lib/portal/extensiones';

/**
 * Extensiones telefónicas corporativas, del Excel de Talento Humano en
 * SharePoint (ver `lib/portal/extensiones.ts`).
 *
 *   GET /api/portal/contactos/extensiones
 *
 * Exige la misma identidad que el resto del contenido del portal, igual que
 * los correos corporativos: es directorio interno.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const { extensiones, origen } = await leerExtensionesCorporativas();
    return NextResponse.json({ extensiones, origen }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('[portal] GET /api/portal/contactos/extensiones', error);
    return NextResponse.json(
      { error: 'No se pudo leer las extensiones corporativas. Intente en un momento.' },
      { status: 502 }
    );
  }
}
