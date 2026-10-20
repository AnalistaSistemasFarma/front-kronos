import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { registrarErrorSinDatos } from '@/lib/portal/formulario-servidor';
import { LIMITE_TABLA_SST, formularioSst } from '@/lib/portal/formularios-sst';
import { puedeVerRespuestasSst } from '@/lib/portal/formularios-sst-permisos';
import { listarEnviosSst } from '@/lib/portal/formularios-sst-servidor';

/**
 * FORMULARIOS SST — respuestas de un formulario (Cristian Baldión, 2026-10-20).
 *
 *   GET /api/portal/formularios-sst/:codigo/respuestas   →   { formulario, columnas, filas, total, truncado }
 *
 * SOLO para el administrador y los lectores SST (`formularios-sst-permisos.ts`): cualquier otra persona recibe 403, haya o no
 * respuestas. Trae las `LIMITE_TABLA_SST` más recientes; el Excel llega más lejos. Datos personales SENSIBLES (Ley 1581): nunca en caché
 * y nunca en los logs.
 */
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ codigo: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!puedeVerRespuestasSst(quien.correo)) return NextResponse.json({ error: 'No tiene permiso para ver estas respuestas.' }, { status: 403 });
  const formulario = formularioSst((await params).codigo);
  if (!formulario) return NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 });
  try {
    return NextResponse.json(await listarEnviosSst(formulario, LIMITE_TABLA_SST), { headers: SIN_CACHE });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      registrarErrorSinDatos('GET .../formularios-sst/[codigo]/respuestas (sin configurar)', error);
      return NextResponse.json({ error: 'Los formularios SST no están configurados en este ambiente. Avise a Tecnología.' }, { status: 503, headers: SIN_CACHE });
    }
    registrarErrorSinDatos('GET .../formularios-sst/[codigo]/respuestas', error);
    const permiso = error instanceof FormacionStorageError && (error.status === 401 || error.status === 403);
    return NextResponse.json(
      { error: permiso ? 'El portal no tiene permiso para leer FORMULARIOS SST en SharePoint. Avise a Tecnología.' : 'No se pudieron cargar las respuestas. Intente de nuevo.' },
      { status: 502, headers: SIN_CACHE }
    );
  }
}
