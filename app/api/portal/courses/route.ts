import { NextRequest, NextResponse } from 'next/server';
import { contextoAdmin, esFormadorFormacion, perfilColaborador } from '@/lib/formacion/servidor';
import { cursoVisiblePara, puedeAdministrarCurso, puedeAdministrarEmpresa } from '@/lib/formacion/reglas';
import { prisma } from '../../../../lib/prisma';
import { identificar } from '../../../../lib/portal/acceso';
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

  const esFormador = (await esFormadorFormacion(quien.correo));
  // Módulo Formación (2026-10-26): el formador ve los cursos de las empresas
  // donde tiene el permiso (GSS: todos); el estudiante, los de su empresa y
  // departamento (alcance del curso) más aquellos en los que está inscrito.
  const vistaEstudiante = request.nextUrl.searchParams.get('vista') === 'estudiante';

  try {
    const ctx = esFormador ? await contextoAdmin(quien.correo).catch(() => null) : null;
    const perfil = await perfilColaborador(quien.correo).catch(() => null);
    const empresas = await prisma.company.findMany({ select: { id_company: true, company: true } }).catch(() => []);
    const nombreEmpresa = new Map(empresas.map((e) => [e.id_company, e.company.trim()]));
    const todos = await prisma.portalCourse.findMany({
      // Los cursos ELIMINADOS (borrado lógico, 2026-10-22) no aparecen para nadie.
      where: esFormador ? { eliminado_at: null } : { active: true, eliminado_at: null },
      orderBy: [{ id: 'desc' }],
      include: {
        materials: { where: { eliminado_at: null }, select: { id: true, required: true } },
        enrollments: { where: { student_email: quien.correo }, select: { id: true } },
        certificates: { where: { student_email: quien.correo }, select: { code: true, issued_at: true } },
        _count: { select: { enrollments: true } },
        alcances: { select: { id_company: true, id_department: true, activo: true } },
      },
    });
    const cursos = todos.filter((c) => {
      if (esFormador && !vistaEstudiante) {
        // Transición (PORTAL_TH_FORMADORES sin permiso del módulo): ve todos.
        const transicion = !ctx || (!ctx.esGlobal && ctx.empresas.length === 0);
        return transicion || puedeAdministrarCurso(ctx, c.id_company_owner ?? null);
      }
      if (!c.active) return false;
      if (c.enrollments.length > 0) return true;
      return perfil ? cursoVisiblePara(c.alcances, perfil) : c.alcances.length === 0;
    });

    const progresoPorCurso = esFormador && !vistaEstudiante
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
          empresaId: c.id_company_owner ?? null,
          empresa: c.id_company_owner ? (nombreEmpresa.get(c.id_company_owner) ?? null) : null,
          alcance: c.alcances.length === 0 ? 'todas' : 'definido',
          alcancesActivos: c.alcances.filter((a) => a.activo).length,
          creadoEl: c.created_at,
          totalMateriales: c.materials.length,
          totalInscritos: c._count.enrollments,
          inscrito: c.enrollments.length > 0,
          porcentaje: esFormador && !vistaEstudiante ? null : (progresoPorCurso.get(c.id)?.porcentaje ?? 0),
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
  if (!(await esFormadorFormacion(quien.correo))) {
    return NextResponse.json({ error: 'Solo un formador puede crear cursos.' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null);
    const titulo = typeof body?.titulo === 'string' ? body.titulo.trim() : '';
    const descripcion = typeof body?.descripcion === 'string' ? body.descripcion.trim() : '';

    if (!titulo) return NextResponse.json({ error: 'Falta el título del curso.' }, { status: 400 });
    // Empresa dueña: null = todas las empresas (solo con el permiso en GSS).
    const empresaId = Number.isInteger(body?.empresaId) && body.empresaId > 0 ? (body.empresaId as number) : null;
    const ctx = await contextoAdmin(quien.correo).catch(() => null);
    const transicion = !ctx || (!ctx.esGlobal && ctx.empresas.length === 0);
    if (!transicion && (empresaId === null ? !ctx.esGlobal : !puedeAdministrarEmpresa(ctx, empresaId))) {
      return NextResponse.json(
        { error: empresaId === null ? 'Solo quien tiene Formación en GSS crea cursos para todas las empresas.' : 'No tiene el permiso de Formación en esa empresa.' },
        { status: 403 }
      );
    }
    if (titulo.length > 255) {
      return NextResponse.json({ error: 'El título es muy largo (máximo 255 caracteres).' }, { status: 400 });
    }

    const curso = await prisma.portalCourse.create({
      data: {
        title: titulo,
        description: descripcion || null,
        id_company_owner: empresaId,
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
