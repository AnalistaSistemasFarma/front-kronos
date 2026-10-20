import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { FORMULARIOS_SST } from '@/lib/portal/formularios-sst';
import { puedeVerRespuestasSst } from '@/lib/portal/formularios-sst-permisos';

/**
 * FORMULARIOS SST — lista de los formularios disponibles (Cristian Baldión, 2026-10-20).
 *
 *   GET /api/portal/formularios-sst   →   { formularios: [{ codigo, titulo, descripcion, datosSensibles }], puedeVerRespuestas }
 *
 * Cualquier persona con sesión del portal puede ver la lista y responder. `puedeVerRespuestas` dice si ESTA sesión es de quienes pueden
 * ver y exportar las respuestas (administrador o lector SST); el servidor lo vuelve a exigir en cada ruta de respuestas.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  return NextResponse.json(
    {
      formularios: FORMULARIOS_SST.map((f) => ({ codigo: f.codigo, titulo: f.titulo, descripcion: f.descripcion, datosSensibles: f.datosSensibles })),
      puedeVerRespuestas: puedeVerRespuestasSst(quien.correo),
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
