import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { identificar } from '@/lib/portal/acceso';
import { accesoAlCurso } from '@/lib/formacion/servidor';

/**
 * FORMACIÓN — «me gusta» de una pregunta o respuesta (2026-10-26).
 *   POST /api/portal/preguntas/:preguntaId/like   alterna (pone o quita)
 */
const SIN_CACHE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest, { params }: { params: Promise<{ preguntaId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401, headers: SIN_CACHE });
  const id = Number((await params).preguntaId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Pregunta no válida.' }, { status: 400, headers: SIN_CACHE });
  try {
    const p = await prisma.formacionPregunta.findFirst({ where: { id, eliminado_at: null }, select: { course_id: true } });
    if (!p || !(await accesoAlCurso(quien.correo, p.course_id)).puede) {
      return NextResponse.json({ error: 'No encontrada.' }, { status: 404, headers: SIN_CACHE });
    }
    const email = quien.correo.toLowerCase();
    const borrados = await prisma.formacionPreguntaLike.deleteMany({ where: { pregunta_id: id, email } });
    if (borrados.count === 0) await prisma.formacionPreguntaLike.create({ data: { pregunta_id: id, email } });
    const likes = await prisma.formacionPreguntaLike.count({ where: { pregunta_id: id } });
    return NextResponse.json({ ok: true, meGusta: borrados.count === 0, likes }, { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] POST like', error);
    return NextResponse.json({ error: 'No se pudo registrar.' }, { status: 500, headers: SIN_CACHE });
  }
}
