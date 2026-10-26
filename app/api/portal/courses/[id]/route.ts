import { NextRequest, NextResponse } from 'next/server';
import { esFormadorFormacion, marcarDivulgacionVista, perfilColaborador, puedeAdministrarCursoId } from '@/lib/formacion/servidor';
import { cursoVisiblePara } from '@/lib/formacion/reglas';
import { prisma } from '../../../../../lib/prisma';
import { identificar } from '../../../../../lib/portal/acceso';
import { calcularProgreso } from '../../../../../lib/portal/formacion';
import { puedeMarcarManual } from '../../../../../lib/portal/permisos-formacion';
import { conteosDelCurso, eliminarCurso } from '../../../../../lib/portal/eliminar-curso';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — detalle de un curso.
 *
 *   GET   /api/portal/courses/:id  — materiales, progreso propio, y si es
 *                                     formador, además el listado de
 *                                     inscritos (sin su detalle: eso vive en
 *                                     /roster para no cargar la vista de
 *                                     estudio con datos que no necesita).
 *   PATCH /api/portal/courses/:id  — edita título/descripción/publicado.
 *   DELETE /api/portal/courses/:id — elimina el curso (borrado LÓGICO, solo
 *                                     formadores; ver lib/portal/eliminar-curso).
 *
 * AUTOINSCRIPCIÓN: pedido explícito — "cualquier usuario autenticado del
 * portal puede autoinscribirse". Por eso este GET, cuando lo pide un
 * estudiante y el curso está publicado, crea la inscripción si todavía no
 * existe. No hace falta un botón "inscribirme" aparte: abrir el curso YA es
 * la inscripción.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const id = idDesdeParametro((await params).id);
  if (!id) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400 });

  const esFormador = (await esFormadorFormacion(quien.correo));

  try {
    const curso = await prisma.portalCourse.findUnique({
      where: { id, eliminado_at: null },
      include: { materials: { where: { eliminado_at: null }, orderBy: { orden: 'asc' } } },
    });
    if (!curso) return NextResponse.json({ error: 'Curso no encontrado.' }, { status: 404 });
    if (!curso.active && !esFormador) {
      return NextResponse.json({ error: 'Este curso no está disponible.' }, { status: 404 });
    }

    // Alcance por empresa y departamento (módulo Formación, 2026-10-26): quien
    // no está en el alcance y no estaba inscrito no lo ve.
    if (!esFormador) {
      const [alcances, inscrito] = await Promise.all([
        prisma.formacionCursoAlcance.findMany({ where: { course_id: id }, select: { id_company: true, id_department: true, activo: true } }),
        prisma.portalCourseEnrollment.findUnique({
          where: { course_id_student_email: { course_id: id, student_email: quien.correo } },
          select: { id: true },
        }),
      ]);
      if (alcances.length > 0 && !inscrito && !cursoVisiblePara(alcances, await perfilColaborador(quien.correo))) {
        return NextResponse.json({ error: 'Este curso no está disponible.' }, { status: 404 });
      }
    }
    // Abrir el curso quita su pendiente del ícono de Formación del header.
    await marcarDivulgacionVista(quien.correo, { courseId: id });

    // Autoinscripción silenciosa — ver nota arriba. `upsert` porque abrirlo
    // de nuevo no debe fallar ni duplicar la fila.
    if (curso.active) {
      await prisma.portalCourseEnrollment.upsert({
        where: { course_id_student_email: { course_id: id, student_email: quien.correo } },
        update: {},
        create: { course_id: id, student_email: quien.correo },
      });
    }

    const completados = await prisma.portalMaterialProgress.findMany({
      where: { student_email: quien.correo, material_id: { in: curso.materials.map((m) => m.id) } },
      select: { material_id: true, completed_at: true },
    });
    const completadosMapa = new Map(completados.map((c) => [c.material_id, c.completed_at]));

    const { porcentaje } = calcularProgreso(curso.materials, new Set(completadosMapa.keys()));

    const certificado = await prisma.portalCertificate.findUnique({
      where: { course_id_student_email: { course_id: id, student_email: quien.correo } },
      select: { code: true, issued_at: true },
    });

    // Casillas editables a mano solo para ADMINISTRADORES/FORMADORES del
    // Excel de permisos (Cristian, 2026-10-08). El servidor lo vuelve a
    // verificar en /progress: esto solo decide cómo se pinta la casilla.
    const marcadoManual = await puedeMarcarManual(quien.correo);
    // Lo que el formador ve en la confirmación de «Eliminar curso».
    const conteos = esFormador ? await conteosDelCurso(id) : null;

    return NextResponse.json(
      {
        curso: {
          id: curso.id,
          titulo: curso.title,
          descripcion: curso.description,
          activo: curso.active,
          creadoPor: curso.created_by,
        },
        esFormador,
        puedeMarcarManual: marcadoManual,
        conteos,
        porcentaje,
        materiales: curso.materials.map((m) => ({
          id: m.id,
          tipo: m.type as 'DOCUMENT' | 'LINK' | 'FORM',
          formularioId: m.formulario_id,
          titulo: m.title,
          orden: m.orden,
          url: m.url,
          nombreArchivo: m.file_name,
          mime: m.mime,
          obligatorio: m.required,
          completadoEl: completadosMapa.get(m.id) ?? null,
        })),
        certificado: certificado ? { code: certificado.code, emitidoEl: certificado.issued_at } : null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[portal] GET /api/portal/courses/[id]', error);
    return NextResponse.json({ error: 'No se pudo cargar el curso.' }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!(await esFormadorFormacion(quien.correo))) {
    return NextResponse.json({ error: 'Solo un formador puede editar cursos.' }, { status: 403 });
  }

  const id = idDesdeParametro((await params).id);
  if (id && !(await puedeAdministrarCursoId(quien.correo, id))) {
    return NextResponse.json({ error: 'Este curso es de otra empresa: no tiene el permiso de Formación para configurarlo.' }, { status: 403 });
  }
  if (!id) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400 });

  try {
    const body = await request.json().catch(() => null);
    const data: { title?: string; description?: string | null; active?: boolean } = {};

    if (typeof body?.titulo === 'string') {
      const titulo = body.titulo.trim();
      if (!titulo) return NextResponse.json({ error: 'El título no puede quedar vacío.' }, { status: 400 });
      data.title = titulo.slice(0, 255);
    }
    if (typeof body?.descripcion === 'string') data.description = body.descripcion.trim() || null;
    if (typeof body?.activo === 'boolean') data.active = body.activo;

    // Un curso eliminado no se edita ni se vuelve a publicar.
    const existe = await prisma.portalCourse.findUnique({ where: { id, eliminado_at: null }, select: { id: true } });
    if (!existe) return NextResponse.json({ error: 'Curso no encontrado.' }, { status: 404 });
    if (typeof body?.descripcion === 'string' && body.descripcion.length > 4000) {
      return NextResponse.json({ error: 'La descripción es muy larga (máximo 4.000 caracteres).' }, { status: 400 });
    }

    const curso = await prisma.portalCourse.update({ where: { id }, data });
    return NextResponse.json({ ok: true, curso: { id: curso.id, titulo: curso.title, activo: curso.active } });
  } catch (error) {
    console.error('[portal] PATCH /api/portal/courses/[id]', error);
    return NextResponse.json({ error: 'No se pudo actualizar el curso.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  // El mismo permiso que crear y editar cursos: la lista de formadores del portal.
  if (!(await esFormadorFormacion(quien.correo))) {
    return NextResponse.json({ error: 'Solo un formador puede eliminar cursos.' }, { status: 403 });
  }

  const id = idDesdeParametro((await params).id);
  if (id && !(await puedeAdministrarCursoId(quien.correo, id))) {
    return NextResponse.json({ error: 'Este curso es de otra empresa: no tiene el permiso de Formación para configurarlo.' }, { status: 403 });
  }
  if (!id) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400 });

  try {
    const r = await eliminarCurso(id, quien.correo.toLowerCase());
    if (!r) return NextResponse.json({ error: 'Curso no encontrado o ya eliminado.' }, { status: 404 });
    // Solo id y conteos: el correo de quien lo eliminó queda en la base (eliminado_por), no en los registros.
    console.info('[portal] curso eliminado', { courseId: id, inscritos: r.inscritos, certificados: r.certificados });
    return NextResponse.json({ ok: true, curso: { id, titulo: r.titulo }, inscritos: r.inscritos, certificados: r.certificados });
  } catch (error) {
    console.error('[portal] DELETE /api/portal/courses/[id]:', (error as Error).name);
    return NextResponse.json({ error: 'No se pudo eliminar el curso.' }, { status: 500 });
  }
}
