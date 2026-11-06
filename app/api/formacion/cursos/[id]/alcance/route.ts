import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { puedeAdministrarEmpresa } from '@/lib/formacion/reglas';
import { puedeAdministrarCursoId } from '@/lib/formacion/servidor';
import { exigirAdminFormacion, SIN_CACHE } from '@/lib/formacion/sesion';

/**
 * MÓDULO FORMACIÓN — alcance de un curso por empresa y departamento (2026-10-26).
 *
 *   GET /api/formacion/cursos/:id/alcance
 *   PUT /api/formacion/cursos/:id/alcance   { alcances: [{ empresaId, departamentoId | null, activo }] }
 *
 * Sin filas = el curso es para todas las empresas y departamentos.
 * `departamentoId: null` = todos los departamentos de esa empresa.
 * El PUT reemplaza las filas de las empresas que quien guarda administra; las
 * de otras empresas no se tocan.
 */
function idCurso(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await exigirAdminFormacion();
  if (!r.ok) return r.respuesta;
  const id = idCurso((await params).id);
  if (!id) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400, headers: SIN_CACHE });
  const filas = await prisma.formacionCursoAlcance.findMany({
    where: { course_id: id },
    select: { id_company: true, id_department: true, activo: true },
  });
  return NextResponse.json(
    { alcances: filas.map((f) => ({ empresaId: f.id_company, departamentoId: f.id_department, activo: f.activo })) },
    { headers: SIN_CACHE }
  );
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await exigirAdminFormacion();
  if (!r.ok) return r.respuesta;
  const id = idCurso((await params).id);
  if (!id) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400, headers: SIN_CACHE });
  if (!(await puedeAdministrarCursoId(r.correo, id))) {
    return NextResponse.json({ error: 'Este curso es de otra empresa: no tiene el permiso de Formación para configurarlo.' }, { status: 403, headers: SIN_CACHE });
  }
  const body = await request.json().catch(() => null);
  const lista: unknown[] = Array.isArray(body?.alcances) ? body.alcances : [];
  if (lista.length > 2000) return NextResponse.json({ error: 'Demasiadas filas de alcance.' }, { status: 400, headers: SIN_CACHE });
  const vistas = new Set<string>();
  const filas: Array<{ empresaId: number; departamentoId: number | null; activo: boolean }> = [];
  for (const x of lista) {
    const a = x as { empresaId?: unknown; departamentoId?: unknown; activo?: unknown };
    const empresaId = Number(a.empresaId);
    const departamentoId = a.departamentoId === null || a.departamentoId === undefined ? null : Number(a.departamentoId);
    if (!Number.isInteger(empresaId) || empresaId <= 0) continue;
    if (departamentoId !== null && (!Number.isInteger(departamentoId) || departamentoId <= 0)) continue;
    if (!puedeAdministrarEmpresa(r.ctx, empresaId)) {
      return NextResponse.json({ error: 'No tiene el permiso de Formación en una de las empresas.' }, { status: 403, headers: SIN_CACHE });
    }
    const clave = `${empresaId}:${departamentoId ?? '*'}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    filas.push({ empresaId, departamentoId, activo: a.activo !== false });
  }
  try {
    const curso = await prisma.portalCourse.findFirst({ where: { id, eliminado_at: null }, select: { id: true } });
    if (!curso) return NextResponse.json({ error: 'Curso no encontrado.' }, { status: 404, headers: SIN_CACHE });
    await prisma.$transaction([
      prisma.formacionCursoAlcance.deleteMany({
        where: { course_id: id, ...(r.ctx.esGlobal ? {} : { id_company: { in: r.ctx.empresas } }) },
      }),
      prisma.formacionCursoAlcance.createMany({
        data: filas.map((f) => ({
          course_id: id,
          id_company: f.empresaId,
          id_department: f.departamentoId,
          activo: f.activo,
          updated_by: r.correo,
        })),
      }),
    ]);
    return NextResponse.json({ ok: true, guardados: filas.length }, { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] PUT /api/formacion/cursos/[id]/alcance', error);
    return NextResponse.json({ error: 'No se pudo guardar el alcance del curso.' }, { status: 500, headers: SIN_CACHE });
  }
}
