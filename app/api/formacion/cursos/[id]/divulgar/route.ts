import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizarCorreo } from '@/lib/formacion/reglas';
import { destinatariosDeCurso, puedeAdministrarCursoId } from '@/lib/formacion/servidor';
import { exigirAdminFormacion, SIN_CACHE } from '@/lib/formacion/sesion';
import { avisarDivulgacionPorCorreo } from '@/lib/formacion/aviso-correo';

/**
 * MÓDULO FORMACIÓN — divulgar un curso o un material (video) nuevo (2026-10-26).
 *
 *   GET  /api/formacion/cursos/:id/divulgar   historial de divulgaciones del curso
 *   POST /api/formacion/cursos/:id/divulgar   { materialId?, mensaje?, avisarPorCorreo? }
 *
 * Deja a cada destinatario del alcance del curso un pendiente que aparece en el
 * ícono de Formación del header, hasta que abre el curso o el material. Quien
 * no tiene usuario de SynerLink recibe además un correo (si se pide).
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
  const filas = await prisma.formacionDivulgacion.findMany({
    where: { course_id: id },
    orderBy: { id: 'desc' },
    take: 50,
    select: {
      id: true,
      material_id: true,
      mensaje: true,
      divulgado_por: true,
      divulgado_at: true,
      _count: { select: { destinatarios: true } },
    },
  });
  const vistos = filas.length
    ? await prisma.formacionDivulgacionDestinatario.groupBy({
        by: ['divulgacion_id'],
        where: { divulgacion_id: { in: filas.map((f) => f.id) }, visto_at: { not: null } },
        _count: { _all: true },
      })
    : [];
  const vistosPor = new Map(vistos.map((v) => [v.divulgacion_id, v._count._all]));
  return NextResponse.json(
    {
      divulgaciones: filas.map((f) => ({
        id: f.id,
        materialId: f.material_id,
        mensaje: f.mensaje,
        divulgadoPor: f.divulgado_por,
        divulgadoAt: f.divulgado_at,
        destinatarios: f._count.destinatarios,
        vistos: vistosPor.get(f.id) ?? 0,
      })),
    },
    { headers: SIN_CACHE }
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await exigirAdminFormacion();
  if (!r.ok) return r.respuesta;
  const id = idCurso((await params).id);
  if (!id) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400, headers: SIN_CACHE });
  if (!(await puedeAdministrarCursoId(r.correo, id))) {
    return NextResponse.json({ error: 'Este curso es de otra empresa: no tiene el permiso de Formación para divulgarlo.' }, { status: 403, headers: SIN_CACHE });
  }
  const body = await request.json().catch(() => null);
  const materialId = Number.isInteger(body?.materialId) && body.materialId > 0 ? (body.materialId as number) : null;
  const mensaje = typeof body?.mensaje === 'string' && body.mensaje.trim() ? body.mensaje.trim().slice(0, 1000) : null;
  const avisarPorCorreo = body?.avisarPorCorreo === true;

  try {
    const curso = await prisma.portalCourse.findFirst({
      where: { id, eliminado_at: null },
      select: { id: true, title: true, active: true },
    });
    if (!curso) return NextResponse.json({ error: 'Curso no encontrado.' }, { status: 404, headers: SIN_CACHE });
    if (!curso.active) {
      return NextResponse.json({ error: 'Publique el curso antes de divulgarlo.' }, { status: 409, headers: SIN_CACHE });
    }
    let material: { id: number; title: string } | null = null;
    if (materialId) {
      material = await prisma.portalCourseMaterial.findFirst({
        where: { id: materialId, course_id: id, eliminado_at: null },
        select: { id: true, title: true },
      });
      if (!material) return NextResponse.json({ error: 'Material no encontrado en este curso.' }, { status: 404, headers: SIN_CACHE });
    }

    const destinatarios = (await destinatariosDeCurso(id)).filter((c) => c !== normalizarCorreo(r.correo));
    if (destinatarios.length === 0) {
      return NextResponse.json(
        { error: 'El alcance del curso no tiene destinatarios: revise las empresas y departamentos activos.' },
        { status: 409, headers: SIN_CACHE }
      );
    }

    const divulgacion = await prisma.formacionDivulgacion.create({
      data: { course_id: id, material_id: material?.id ?? null, mensaje, divulgado_por: r.correo },
      select: { id: true },
    });
    // SQL Server admite ~2100 parámetros por consulta: se inserta por tandas.
    for (let i = 0; i < destinatarios.length; i += 500) {
      await prisma.formacionDivulgacionDestinatario.createMany({
        data: destinatarios.slice(i, i + 500).map((email) => ({ divulgacion_id: divulgacion.id, email })),
      });
    }

    let correo: { enviados: number; fallidos: number } | null = null;
    if (avisarPorCorreo) {
      const conUsuario = new Set(
        (
          await prisma.user.findMany({
            where: { email: { in: destinatarios }, isActive: true },
            select: { email: true },
          })
        ).map((u) => normalizarCorreo(u.email))
      );
      const sinUsuario = destinatarios.filter((c) => !conUsuario.has(c));
      if (sinUsuario.length > 0) {
        correo = await avisarDivulgacionPorCorreo({
          correos: sinUsuario,
          cursoId: id,
          cursoTitulo: curso.title,
          material: material?.title ?? null,
          mensaje,
        });
      }
    }

    return NextResponse.json({ ok: true, divulgacionId: divulgacion.id, destinatarios: destinatarios.length, correo }, { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] POST /api/formacion/cursos/[id]/divulgar', error);
    return NextResponse.json({ error: 'No se pudo divulgar.' }, { status: 500, headers: SIN_CACHE });
  }
}
