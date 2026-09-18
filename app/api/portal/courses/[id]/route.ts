import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { identificar } from '../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../lib/portal/config';
import { calcularProgreso } from '../../../../../lib/portal/formacion';

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

  const esFormador = formadoresDePortal().includes(quien.correo.toLowerCase());

  try {
    const curso = await prisma.portalCourse.findUnique({
      where: { id },
      include: { materials: { orderBy: { orden: 'asc' } } },
    });
    if (!curso) return NextResponse.json({ error: 'Curso no encontrado.' }, { status: 404 });
    if (!curso.active && !esFormador) {
      return NextResponse.json({ error: 'Este curso no está disponible.' }, { status: 404 });
    }

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
        porcentaje,
        materiales: curso.materials.map((m) => ({
          id: m.id,
          tipo: m.type as 'DOCUMENT' | 'LINK',
          titulo: m.title,
          orden: m.orden,
          url: m.url,
          nombreArchivo: m.file_name,
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
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede editar cursos.' }, { status: 403 });
  }

  const id = idDesdeParametro((await params).id);
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

    const curso = await prisma.portalCourse.update({ where: { id }, data });
    return NextResponse.json({ ok: true, curso: { id: curso.id, titulo: curso.title, activo: curso.active } });
  } catch (error) {
    console.error('[portal] PATCH /api/portal/courses/[id]', error);
    return NextResponse.json({ error: 'No se pudo actualizar el curso.' }, { status: 500 });
  }
}
