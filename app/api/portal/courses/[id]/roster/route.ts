import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { identificar } from '../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../lib/portal/config';
import { calcularProgreso, nombreDesdeCorreo } from '../../../../../../lib/portal/formacion';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — vista del FORMADOR: progreso de TODOS los inscritos en un
 * curso, uno por fila, con qué materiales tiene marcados cada uno.
 *
 *   GET /api/portal/courses/:id/roster
 *
 * Aparte del detalle del curso (que ya trae el progreso PROPIO de quien
 * pide) para no cargarle a un estudiante, en cada `GET` del curso, los datos
 * de sus compañeros — información que no necesita y que no debería poder
 * pedir sin ser formador.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede ver este listado.' }, { status: 403 });
  }

  const courseId = idDesdeParametro((await params).id);
  if (!courseId) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400 });

  try {
    const curso = await prisma.portalCourse.findUnique({
      where: { id: courseId },
      include: {
        materials: { orderBy: { orden: 'asc' }, select: { id: true, title: true, required: true } },
        enrollments: { orderBy: { enrolled_at: 'asc' }, select: { student_email: true, enrolled_at: true } },
      },
    });
    if (!curso) return NextResponse.json({ error: 'Curso no encontrado.' }, { status: 404 });

    const correos = curso.enrollments.map((e) => e.student_email);
    const [progresos, certificados, usuarios] = await Promise.all([
      prisma.portalMaterialProgress.findMany({
        where: { student_email: { in: correos }, material_id: { in: curso.materials.map((m) => m.id) } },
        select: { student_email: true, material_id: true },
      }),
      prisma.portalCertificate.findMany({
        where: { course_id: courseId, student_email: { in: correos } },
        select: { student_email: true, code: true },
      }),
      prisma.user.findMany({ where: { email: { in: correos } }, select: { email: true, name: true } }),
    ]);

    const nombrePorCorreo = new Map(usuarios.map((u) => [u.email, u.name]));
    const certificadoPorCorreo = new Map(certificados.map((c) => [c.student_email, c.code]));
    const completadosPorCorreo = new Map<string, Set<number>>();
    for (const p of progresos) {
      const set = completadosPorCorreo.get(p.student_email) ?? new Set<number>();
      set.add(p.material_id);
      completadosPorCorreo.set(p.student_email, set);
    }

    return NextResponse.json(
      {
        curso: { id: curso.id, titulo: curso.title },
        materiales: curso.materials.map((m) => ({ id: m.id, titulo: m.title, obligatorio: m.required })),
        estudiantes: curso.enrollments.map((e) => {
          const completadosIds = completadosPorCorreo.get(e.student_email) ?? new Set<number>();
          const { porcentaje } = calcularProgreso(curso.materials, completadosIds);
          return {
            correo: e.student_email,
            nombre: nombrePorCorreo.get(e.student_email) || nombreDesdeCorreo(e.student_email),
            inscritoEl: e.enrolled_at,
            porcentaje,
            materialesCompletados: [...completadosIds],
            certificado: certificadoPorCorreo.get(e.student_email) ?? null,
          };
        }),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[portal] GET /api/portal/courses/[id]/roster', error);
    return NextResponse.json({ error: 'No se pudo cargar el listado.' }, { status: 502 });
  }
}
