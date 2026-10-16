import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { esIdValido, leerConfigAyudas, urlVistaPreviaPolitica } from '@/lib/portal/politicas-storage';
import { mensajeErrorPoliticas } from '../../../politicas/mensajes';

/**
 * URL de VISTA PREVIA embebible de un video de AYUDAS (carpeta FORMACION/AYUDAS).
 *
 *   GET /api/portal/ayudas/:id/vista  →  { url }
 *
 * Igual que la de Políticas: la `url` es la de Graph (`driveItem/preview`), de corta duración y hecha para un <iframe>, sin
 * pedir sesión de Microsoft. El id se valida contra el listado de ESA carpeta: no sirve para previsualizar ningún otro
 * archivo del sitio (ni siquiera uno de Políticas). No se cachea.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const { id } = await params;
  if (!esIdValido(id)) return NextResponse.json({ error: 'Archivo no válido.' }, { status: 400 });

  try {
    const url = await urlVistaPreviaPolitica(id, { config: leerConfigAyudas() });
    if (!url) return NextResponse.json({ error: 'El video ya no está en la carpeta de ayudas.' }, { status: 404 });
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('[portal] GET /api/portal/ayudas/[id]/vista', error);
    const { status, mensaje } = mensajeErrorPoliticas(error, 'vista', 'de ayudas');
    return NextResponse.json({ error: mensaje }, { status });
  }
}
