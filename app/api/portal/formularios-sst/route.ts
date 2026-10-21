import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { esAdministradorSst, puedeVerRespuestasSst } from '@/lib/portal/formularios-sst-permisos';
import { listarFormulariosSst } from '@/lib/portal/formularios-sst-catalogo';

/**
 * FORMULARIOS SST — lista de los formularios disponibles (Cristian Baldión, 2026-10-20).
 *
 *   GET /api/portal/formularios-sst   →   { formularios: [{ codigo, titulo, descripcion, datosSensibles, origen }], puedeVerRespuestas, puedeAdministrar }
 *
 * La lista incluye los del código (B1 y B2) y los que el administrador creó en el constructor (`formularios-sst-catalogo.ts`).
 * `puedeAdministrar` (solo el administrador) muestra los botones de crear, editar y retirar; el servidor lo vuelve a exigir en su ruta.
 *
 * Cualquier persona con sesión del portal puede ver la lista y responder. `puedeVerRespuestas` dice si ESTA sesión es de quienes pueden
 * ver y exportar las respuestas (administrador o lector SST); el servidor lo vuelve a exigir en cada ruta de respuestas.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  const formularios = await listarFormulariosSst();
  return NextResponse.json(
    {
      formularios: formularios.map((f) => ({ codigo: f.codigo, titulo: f.titulo, descripcion: f.descripcion, datosSensibles: f.datosSensibles, origen: f.origen })),
      puedeVerRespuestas: puedeVerRespuestasSst(quien.correo),
      puedeAdministrar: esAdministradorSst(quien.correo),
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
