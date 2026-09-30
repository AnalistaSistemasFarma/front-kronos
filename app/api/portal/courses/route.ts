import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { identificar } from '../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../lib/portal/config';
import { calcularProgreso } from '../../../../lib/portal/formacion';

/**
 * FORMACIÓN — lista de cursos.
 *
 *   GET  /api/portal/courses   — cursos visibles para quien pide, con SU
 *                                 propio progreso.
 *   POST /api/portal/courses   — crea un curso (solo formadores).
 *
 * Un estudiante ve solo los cursos PUBLICADOS (`active = true`). Un formador
 * ve además los que tiene en borrador (`active = false`), porque es quien
 * los está armando.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const esFormador = formadoresDePortal().includes(quien.correo.toLowerCase());

  try {
    const cursos = await prisma.portalCourse.findMany({
      where: esFormador ? {} : { active: true },
      orderBy: [{ id: 'desc' }],
      include: {
        materials: { select: { id: true, required: true } },
        enrollments: { where: { student_email: quien.correo }, select: { id: true } },
        certificates: { where: { student_email: quien.correo }, select: { code: true, issued_at: true } },
        _count: { select: { enrollments: true } },
      },
    });

    const progresoPorCurso = esFormador
      ? new Map<number, { porcentaje: number }>()
      : await (async () => {
          const materialIds = cursos.flatMap((c) => c.materials.map((m) => m.id));
          const completados = materialIds.length
            ? await prisma.portalMaterialProgress.findMany({
                where: { student_email: quien.correo, material_id: { in: materialIds } },
                select: { material_id: true },
              })
            : [];
          const completadosIds = new Set(completados.map((c) => c.material_id));
          const mapa = new Map<number, { porcentaje: number }>();
          for (const curso of cursos) {
            mapa.set(curso.id, calcularProgreso(curso.materials, completadosIds));
          }
          return mapa;
        })();

    return NextResponse.json(
      {
        esFormador,
        cursos: cursos.map((c) => ({
          id: c.id,
          titulo: c.title,
          descripcion: c.description,
          activo: c.active,
          creadoPor: c.created_by,
          creadoEl: c.created_at,
          totalMateriales: c.materials.length,
          totalInscritos: c._count.enrollments,
          inscrito: c.enrollments.length > 0,
          porcentaje: esFormador ? null : (progresoPorCurso.get(c.id)?.porcentaje ?? 0),
          certificado: c.certificates[0]
            ? { code: c.certificates[0].code, emitidoEl: c.certificates[0].issued_at }
            : null,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[portal] GET /api/portal/courses', error);
    return NextResponse.json({ error: 'No se pudieron cargar los cursos.' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede crear cursos.' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null);
    const titulo = typeof body?.titulo === 'string' ? body.titulo.trim() : '';
    const descripcion = typeof body?.descripcion === 'string' ? body.descripcion.trim() : '';

    if (!titulo) return NextResponse.json({ error: 'Falta el título del curso.' }, { status: 400 });
    if (titulo.length > 255) {
      return NextResponse.json({ error: 'El título es muy largo (máximo 255 caracteres).' }, { status: 400 });
    }

    const curso = await prisma.portalCourse.create({
      data: {
        title: titulo,
        description: descripcion || null,
        created_by: quien.correo,
        // Arranca en borrador: el formador agrega materiales antes de
        // publicarlo, así ningún estudiante ve un curso vacío a medio armar.
        active: false,
      },
    });

    return NextResponse.json({ ok: true, curso: { id: curso.id, titulo: curso.title } });
  } catch (error) {
    console.error('[portal] POST /api/portal/courses', error);
    return NextResponse.json({ error: 'No se pudo crear el curso.' }, { status: 500 });
  }
}
