import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { recalcularProgresoDeMaterial } from '../../../../../../../lib/portal/formacion';
import { registrarErrorSinDatos } from '../../../../../../../lib/portal/formulario-servidor';
import { SIN_CACHE, autorizarRespuestas, idDesdeParametro } from '../_comun';

/**
 * FORMACIÓN — FORMULARIO PROPIO — REABRIR una respuesta.
 *
 *   DELETE /api/portal/materials/:materialId/respuestas/:respuestaId
 *
 * La persona envía el formulario UNA vez y no lo puede editar. Si necesita
 * corregir algo, un administrador/formador (hojas del Excel de permisos) lo
 * REABRE: se borra su respuesta y la marca de completado de ese material, y la
 * persona vuelve a responder. Sirve también para atender una solicitud de
 * SUPRESIÓN de datos (Ley 1581 de 2012, art. 8). Un certificado ya emitido no
 * se retira (queda congelado, igual que al desmarcar a mano).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ materialId: string; respuestaId: string }> }
) {
  try {
    const { materialId, respuestaId: crudo } = await params;
    const acceso = await autorizarRespuestas(request, materialId);
    if ('error' in acceso) return acceso.error;
    const respuestaId = idDesdeParametro(crudo);
    if (!respuestaId) return NextResponse.json({ error: 'Respuesta no válida.' }, { status: 400 });

    const respuesta = await prisma.portalFormularioRespuesta.findFirst({
      where: { id: respuestaId, material_id: acceso.material.id },
      select: { id: true, student_email: true },
    });
    if (!respuesta) return NextResponse.json({ error: 'Respuesta no encontrada.' }, { status: 404 });

    await prisma.$transaction([
      prisma.portalFormularioRespuesta.delete({ where: { id: respuesta.id } }),
      prisma.portalMaterialProgress.deleteMany({
        where: { material_id: acceso.material.id, student_email: respuesta.student_email },
      }),
    ]);
    // Trazabilidad SIN datos personales del formulario: quién reabrió cuál.
    console.info(`[portal] Formulario reabierto: material ${acceso.material.id}, respuesta ${respuesta.id}, por ${acceso.correo}`);
    await recalcularProgresoDeMaterial(acceso.material.id, respuesta.student_email, { emitirCertificado: false });
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
  } catch (error) {
    registrarErrorSinDatos('DELETE .../materials/[materialId]/respuestas/[respuestaId]', error);
    return NextResponse.json({ error: 'No se pudo reabrir el formulario.' }, { status: 500 });
  }
}
