import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { esIdValido, leerConfigCapacitaciones, urlVistaPreviaPolitica } from '@/lib/portal/politicas-storage';
import { mensajeErrorPoliticas } from '../../../politicas/mensajes';

/**
 * URL de VISTA PREVIA embebible de un archivo de CAPACITACIONES (carpeta FORMACION/CAPACITACIONES).
 *
 *   GET /api/portal/capacitaciones/:id/vista  →  { url }
 *
 * Igual que la de AYUDAS: el id se valida contra el listado de ESA carpeta, así que no sirve para previsualizar ningún
 * otro archivo del sitio. No se cachea.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const { id } = await params;
  if (!esIdValido(id)) return NextResponse.json({ error: 'Archivo no válido.' }, { status: 400 });

  try {
    const url = await urlVistaPreviaPolitica(id, { config: leerConfigCapacitaciones() });
    if (!url) return NextResponse.json({ error: 'El archivo ya no está en la carpeta de capacitaciones.' }, { status: 404 });
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('[portal] GET /api/portal/capacitaciones/[id]/vista', error);
    const { status, mensaje } = mensajeErrorPoliticas(error, 'vista', 'de capacitaciones');
    return NextResponse.json({ error: mensaje }, { status });
  }
}
