import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { identificar } from '../../../../../../lib/portal/acceso';
import {
  calcularProgreso,
  emitirCertificadoSiCorresponde,
  resolverNombreEstudiante,
} from '../../../../../../lib/portal/formacion';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — marcar (o desmarcar) un material como completado.
 *
 *   POST   /api/portal/materials/:materialId/progress  — lo marca.
 *   DELETE /api/portal/materials/:materialId/progress  — lo desmarca.
 *
 * Al marcar, si con eso el estudiante llega al 100% del curso, se emite el
 * certificado en el mismo paso — así la barra de progreso y el botón de
 * "descargar certificado" aparecen sincronizados en la misma respuesta, sin
 * que la interfaz tenga que pedir dos veces.
 */
async function recalcular(materialId: number, correo: string) {
  const material = await prisma.portalCourseMaterial.findUnique({
    where: { id: materialId },
    select: { course_id: true, course: { select: { title: true, active: true } } },
  });
  if (!material) return null;

  const materiales = await prisma.portalCourseMaterial.findMany({
    where: { course_id: material.course_id },
    select: { id: true, required: true },
  });
  const completados = await prisma.portalMaterialProgress.findMany({
    where: { student_email: correo, material_id: { in: materiales.map((m) => m.id) } },
    select: { material_id: true },
  });
  const { porcentaje } = calcularProgreso(materiales, new Set(completados.map((c) => c.material_id)));

  let certificado = null;
  if (material.course.active) {
    const nombre = await resolverNombreEstudiante(correo);
    const emitido = await emitirCertificadoSiCorresponde({
      courseId: material.course_id,
      studentEmail: correo,
      studentName: nombre,
      courseTitle: material.course.title,
      porcentaje,
    });
    if (emitido) certificado = { code: emitido.code, emitidoEl: emitido.issuedAt };
  }

  return { porcentaje, certificado };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const materialId = idDesdeParametro((await params).materialId);
  if (!materialId) return NextResponse.json({ error: 'Material no válido.' }, { status: 400 });

  try {
    await prisma.portalMaterialProgress.upsert({
      where: { material_id_student_email: { material_id: materialId, student_email: quien.correo } },
      update: {},
      create: { material_id: materialId, student_email: quien.correo },
    });

    const resultado = await recalcular(materialId, quien.correo);
    if (!resultado) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    console.error('[portal] POST .../materials/[materialId]/progress', error);
    return NextResponse.json({ error: 'No se pudo marcar el material.' }, { status: 500 });
  }
}

/**
 * Desmarcarlo NO retira un certificado ya emitido — el certificado congela lo
 * que la persona logró en su momento; un clic accidental después no debe
 * poder quitárselo. Sencillamente ya no vuelve a emitirse otro si vuelve a
 * completar el curso (ver el índice único en `portal_certificate`).
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ materialId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const materialId = idDesdeParametro((await params).materialId);
  if (!materialId) return NextResponse.json({ error: 'Material no válido.' }, { status: 400 });

  try {
    await prisma.portalMaterialProgress.deleteMany({
      where: { material_id: materialId, student_email: quien.correo },
    });

    const material = await prisma.portalCourseMaterial.findUnique({
      where: { id: materialId },
      select: { course_id: true },
    });
    if (!material) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });

    const materiales = await prisma.portalCourseMaterial.findMany({
      where: { course_id: material.course_id },
      select: { id: true, required: true },
    });
    const completados = await prisma.portalMaterialProgress.findMany({
      where: { student_email: quien.correo, material_id: { in: materiales.map((m) => m.id) } },
      select: { material_id: true },
    });
    const { porcentaje } = calcularProgreso(materiales, new Set(completados.map((c) => c.material_id)));

    return NextResponse.json({ ok: true, porcentaje });
  } catch (error) {
    console.error('[portal] DELETE .../materials/[materialId]/progress', error);
    return NextResponse.json({ error: 'No se pudo desmarcar el material.' }, { status: 500 });
  }
}
