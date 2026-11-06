import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { identificar } from '@/lib/portal/acceso';
import { accesoAlCurso } from '@/lib/formacion/servidor';

/**
 * FORMACIÓN — eliminar una pregunta o respuesta (borrado lógico, 2026-10-26).
 *   DELETE /api/portal/preguntas/:preguntaId
 * Su autor o el formador del curso.
 */
const SIN_CACHE = { 'Cache-Control': 'no-store' };

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ preguntaId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401, headers: SIN_CACHE });
  const id = Number((await params).preguntaId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Pregunta no válida.' }, { status: 400, headers: SIN_CACHE });
  try {
    const p = await prisma.formacionPregunta.findFirst({
      where: { id, eliminado_at: null },
      select: { id: true, email: true, course_id: true },
    });
    if (!p) return NextResponse.json({ error: 'No encontrada.' }, { status: 404, headers: SIN_CACHE });
    const propia = p.email.toLowerCase() === quien.correo.toLowerCase();
    if (!propia && !(await accesoAlCurso(quien.correo, p.course_id)).modera) {
      return NextResponse.json({ error: 'Solo su autor o el formador del curso pueden eliminarla.' }, { status: 403, headers: SIN_CACHE });
    }
    await prisma.formacionPregunta.update({
      where: { id },
      data: { eliminado_at: new Date(), eliminado_por: quien.correo.toLowerCase() },
    });
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] DELETE pregunta', error);
    return NextResponse.json({ error: 'No se pudo eliminar.' }, { status: 500, headers: SIN_CACHE });
  }
}
