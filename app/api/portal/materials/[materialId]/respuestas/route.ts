import { NextRequest, NextResponse } from 'next/server';
import { registrarErrorSinDatos, tablaDeRespuestas } from '../../../../../../lib/portal/formulario-servidor';
import { SIN_CACHE, autorizarRespuestas } from './_comun';

/**
 * FORMACIÓN — FORMULARIO PROPIO — CONSULTA de respuestas (Cristian, 2026-10-08).
 *
 *   GET /api/portal/materials/:materialId/respuestas
 *
 * Tabla de respuestas del formulario de ese material (es decir, por curso y
 * formulario): columnas = preguntas de la versión vigente (y las de versiones
 * anteriores que ya no estén), una fila por persona.
 *
 * DATOS SENSIBLES (Ley 1581 de 2012): solo las hojas ADMINISTRADORES y
 * FORMADORES del Excel de permisos, verificado aquí en el servidor (403 a los
 * demás). Sin caché y sin escribir nada de esto en los logs.
 * Exportación a Excel: `GET .../respuestas/excel`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  try {
    const acceso = await autorizarRespuestas(request, (await params).materialId);
    if ('error' in acceso) return acceso.error;
    const tabla = await tablaDeRespuestas(acceso.material.id, acceso.material.formulario_id);
    if (!tabla) return NextResponse.json({ error: 'El formulario no está disponible.' }, { status: 404 });
    return NextResponse.json(
      { curso: { id: acceso.material.course.id, titulo: acceso.material.course.title }, material: { id: acceso.material.id, titulo: acceso.material.title }, ...tabla },
      { headers: SIN_CACHE }
    );
  } catch (error) {
    registrarErrorSinDatos('GET .../materials/[materialId]/respuestas', error);
    return NextResponse.json({ error: 'No se pudieron cargar las respuestas.' }, { status: 500 });
  }
}
