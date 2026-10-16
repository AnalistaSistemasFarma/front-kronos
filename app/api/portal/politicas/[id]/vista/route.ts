import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { esIdValido, urlVistaPreviaPolitica } from '@/lib/portal/politicas-storage';
import { mensajeErrorPoliticas } from '../../mensajes';

/**
 * URL de VISTA PREVIA embebible de un archivo de POLITICAS Y REGLAMENTOS.
 *
 *   GET /api/portal/politicas/:id/vista  →  { url }
 *
 * La `url` es la que entrega Graph (`driveItem/preview` → `getUrl`): una URL
 * de SharePoint de corta duración, hecha para un <iframe>, que no exige sesión
 * de Microsoft (la mayoría de quienes entran al portal no la tienen). No es el
 * token de la app ni un enlace de descarga.
 *
 * El id se valida contra el listado de la carpeta: no sirve para
 * previsualizar ningún otro archivo del sitio. No se cachea.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const { id } = await params;
  if (!esIdValido(id)) return NextResponse.json({ error: 'Archivo no válido.' }, { status: 400 });

  try {
    const url = await urlVistaPreviaPolitica(id);
    if (!url) return NextResponse.json({ error: 'El documento ya no está en la carpeta de políticas.' }, { status: 404 });
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('[portal] GET /api/portal/politicas/[id]/vista', error);
    const { status, mensaje } = mensajeErrorPoliticas(error, 'vista');
    return NextResponse.json({ error: mensaje }, { status });
  }
}
