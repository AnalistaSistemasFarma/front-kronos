import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { leerEmpresasHeinsohn } from '@/lib/portal/heinsohn';

/**
 * HEINSOHN NÓMINA: empresas y su enlace de acceso (Cristian Baldión, 2026-10-15).
 *
 *   GET /api/portal/heinsohn   →   { empresas: [{ nombre, url }], omitidas: [nombre] }
 *
 * Lee el Excel «PORTAL NOMINA» de SharePoint (solo lectura). Exige la misma identidad que el resto del portal. Solo se entregan
 * enlaces https; las filas con un enlace que no sirve se avisan en `omitidas` y no llevan botón.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const { empresas, omitidas } = await leerEmpresasHeinsohn();
    return NextResponse.json({ empresas, omitidas }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Heinsohn sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: 'Heinsohn Nómina no está configurado en este ambiente. Avise a Tecnología.' }, { status: 503 });
    }
    console.error('[portal] GET /api/portal/heinsohn:', error instanceof FormacionStorageError ? error.message : (error as Error).name);
    const permiso = error instanceof FormacionStorageError && (error.status === 401 || error.status === 403);
    const falta = error instanceof FormacionStorageError && error.status === 404;
    return NextResponse.json(
      {
        error: permiso
          ? 'El portal no tiene permiso para leer el Excel de nómina en SharePoint. Avise a Tecnología.'
          : falta
            ? 'No se encontró el Excel de nómina en SharePoint. Avise a Tecnología.'
            : 'No se pudieron cargar las empresas. Intente en un momento.',
      },
      { status: 502 }
    );
  }
}
