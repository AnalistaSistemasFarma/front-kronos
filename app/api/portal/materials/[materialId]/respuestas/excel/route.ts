import { NextRequest, NextResponse } from 'next/server';
import { excelDeRespuestas, registrarErrorSinDatos, tablaDeRespuestas } from '../../../../../../../lib/portal/formulario-servidor';
import { SIN_CACHE, autorizarRespuestas } from '../_comun';

const nombreSeguro = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'formulario';

/**
 * FORMACIÓN — FORMULARIO PROPIO — EXPORTACIÓN a Excel.
 *
 *   GET /api/portal/materials/:materialId/respuestas/excel
 *
 * Mismo permiso que la consulta (hojas ADMINISTRADORES y FORMADORES, validado
 * en el servidor). Las celdas que empiezan por = + - @ se neutralizan para que
 * una respuesta no pueda ejecutarse como fórmula al abrir el archivo.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  try {
    const acceso = await autorizarRespuestas(request, (await params).materialId);
    if ('error' in acceso) return acceso.error;
    const tabla = await tablaDeRespuestas(acceso.material.id, acceso.material.formulario_id);
    if (!tabla) return NextResponse.json({ error: 'El formulario no está disponible.' }, { status: 404 });
    const archivo = await excelDeRespuestas(tabla, acceso.material.course.title);
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = `${nombreSeguro(tabla.formulario.codigo)}-respuestas-curso-${acceso.material.course.id}-${fecha}.xlsx`;
    return new NextResponse(new Uint8Array(archivo), {
      status: 200,
      headers: {
        ...SIN_CACHE,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    registrarErrorSinDatos('GET .../materials/[materialId]/respuestas/excel', error);
    return NextResponse.json({ error: 'No se pudo generar el Excel.' }, { status: 500 });
  }
}
