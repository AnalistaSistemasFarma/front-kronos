import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { excelDeRespuestas, registrarErrorSinDatos } from '@/lib/portal/formulario-servidor';
import { formularioSstActual } from '@/lib/portal/formularios-sst-catalogo';
import { LIMITE_EXCEL_SST } from '@/lib/portal/formularios-sst';
import { puedeVerRespuestasSst } from '@/lib/portal/formularios-sst-permisos';
import { listarEnviosSst } from '@/lib/portal/formularios-sst-servidor';

/**
 * FORMULARIOS SST — Excel con las respuestas de un formulario (Cristian Baldión, 2026-10-20).
 *
 *   GET /api/portal/formularios-sst/:codigo/respuestas/excel   →   .xlsx (una fila por envío; hasta `LIMITE_EXCEL_SST`, los más recientes primero)
 *
 * Misma regla de permisos que la tabla: solo el administrador y los lectores SST (403 para los demás). Usa el mismo libro de Formación
 * (celdas a prueba de fórmulas, hoja «Información» con el aviso de la Ley 1581). Nunca en caché.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ codigo: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!puedeVerRespuestasSst(quien.correo)) return NextResponse.json({ error: 'No tiene permiso para exportar estas respuestas.' }, { status: 403 });
  const formulario = await formularioSstActual((await params).codigo);
  if (!formulario) return NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 });
  try {
    const tabla = await listarEnviosSst(formulario, LIMITE_EXCEL_SST);
    const libro = await excelDeRespuestas(
      {
        formulario: { id: 0, codigo: formulario.codigo, titulo: formulario.titulo, version: 1 },
        evaluacion: false,
        notaMinima: null,
        columnas: tabla.columnas,
        filas: tabla.filas.map((f, i) => ({ id: i + 1, correo: f.correo, enviadaEl: f.enviadaEl, version: 1, autorizacionVersion: f.autorizacionVersion, autorizadoEl: f.autorizacionVersion ? f.enviadaEl : null, respuestas: f.respuestas })),
      },
      'Formularios SST'
    );
    const nombre = `${formulario.codigo}-respuestas.xlsx`;
    return new NextResponse(new Uint8Array(libro), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    registrarErrorSinDatos('GET .../formularios-sst/[codigo]/respuestas/excel', error);
    if (error instanceof FormacionStorageNoConfigurado) return NextResponse.json({ error: 'Los formularios SST no están configurados en este ambiente. Avise a Tecnología.' }, { status: 503 });
    const permiso = error instanceof FormacionStorageError && (error.status === 401 || error.status === 403);
    return NextResponse.json({ error: permiso ? 'El portal no tiene permiso para leer FORMULARIOS SST en SharePoint. Avise a Tecnología.' : 'No se pudo generar el Excel. Intente de nuevo.' }, { status: 502 });
  }
}
