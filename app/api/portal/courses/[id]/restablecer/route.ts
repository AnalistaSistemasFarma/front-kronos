import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '../../../../../../lib/portal/acceso';
import { puedeMarcarManual } from '../../../../../../lib/portal/permisos-formacion';
import { restablecerCursoDeEstudiante } from '../../../../../../lib/portal/restablecer-curso';

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MENSAJE_SIN_PERMISO = 'Solo los administradores y formadores de Formación pueden restablecer un curso.';

/**
 * FORMACIÓN — restablecer un curso para un estudiante (Cristian Baldión, 2026-10-14).
 *
 *   POST /api/portal/courses/:id/restablecer   { correo }
 *
 * Solo quienes están en las hojas ADMINISTRADORES o FORMADORES del Excel de permisos (los mismos que marcan a mano).
 * Deja al estudiante sin progreso, sin respuestas de los formularios del curso y sin certificado; conserva la inscripción
 * y el historial de intentos. Ver `lib/portal/restablecer-curso.ts`. Nunca se escriben en los logs el correo ni las respuestas.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    if (!(await puedeMarcarManual(quien.correo))) {
      return NextResponse.json({ error: MENSAJE_SIN_PERMISO }, { status: 403 });
    }
    const courseId = Number((await params).id);
    if (!Number.isInteger(courseId) || courseId <= 0) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400 });

    let cuerpo: { correo?: unknown } | null = null;
    try {
      cuerpo = JSON.parse(await request.text());
    } catch {
      cuerpo = null;
    }
    const correo = typeof cuerpo?.correo === 'string' ? cuerpo.correo.trim().toLowerCase() : '';
    if (!CORREO.test(correo) || correo.length > 255) return NextResponse.json({ error: 'Indique el correo del estudiante.' }, { status: 400 });

    const r = await restablecerCursoDeEstudiante(courseId, correo);
    if (!r) return NextResponse.json({ error: 'Ese estudiante no está inscrito en el curso.' }, { status: 404 });
    // Solo conteos: nada de correos ni respuestas en el registro.
    console.info('[portal] curso restablecido', { courseId, progresos: r.progresos, respuestas: r.respuestas, certificados: r.certificados });
    return NextResponse.json({ ok: true, ...r }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[portal] POST .../courses/[id]/restablecer:', (error as Error).name);
    return NextResponse.json({ error: 'No se pudo restablecer el curso.' }, { status: 500 });
  }
}
