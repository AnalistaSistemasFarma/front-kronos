import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { identificar } from '../../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../../lib/portal/config';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — editar o quitar un material puntual.
 *
 *   PATCH  /api/portal/courses/:id/materials/:materialId  — título, orden,
 *          obligatorio, o la URL (solo materiales tipo LINK). Para cambiar
 *          el ARCHIVO de un documento, se borra y se sube uno nuevo: es más
 *          simple que un segundo camino de multipart dentro de este PATCH.
 *   DELETE /api/portal/courses/:id/materials/:materialId
 *
 * Borrar un material arrastra en cascada el progreso que los estudiantes
 * tenían marcado ahí (ver la migración) — es lo esperado: si el material ya
 * no existe, no hay nada que seguir contando.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; materialId: string }> }
) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede editar materiales.' }, { status: 403 });
  }

  const { id, materialId } = await params;
  const courseId = idDesdeParametro(id);
  const matId = idDesdeParametro(materialId);
  if (!courseId || !matId) return NextResponse.json({ error: 'Parámetros no válidos.' }, { status: 400 });

  try {
    const actual = await prisma.portalCourseMaterial.findFirst({
      where: { id: matId, course_id: courseId },
      select: { id: true, type: true },
    });
    if (!actual) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });

    const body = await request.json().catch(() => null);
    const data: { title?: string; orden?: number; required?: boolean; url?: string } = {};

    if (typeof body?.titulo === 'string') {
      const titulo = body.titulo.trim();
      if (!titulo) return NextResponse.json({ error: 'El título no puede quedar vacío.' }, { status: 400 });
      data.title = titulo.slice(0, 255);
    }
    if (typeof body?.orden === 'number' && Number.isInteger(body.orden)) data.orden = body.orden;
    if (typeof body?.obligatorio === 'boolean') data.required = body.obligatorio;
    if (typeof body?.url === 'string') {
      if (actual.type !== 'LINK') {
        return NextResponse.json({ error: 'Solo un material tipo enlace tiene URL.' }, { status: 400 });
      }
      const url = body.url.trim();
      if (!/^https?:\/\/.+/i.test(url)) {
        return NextResponse.json({ error: 'La URL debe empezar por http:// o https://' }, { status: 400 });
      }
      data.url = url;
    }

    const material = await prisma.portalCourseMaterial.update({ where: { id: matId }, data });
    return NextResponse.json({ ok: true, material: { id: material.id } });
  } catch (error) {
    console.error('[portal] PATCH .../materials/[materialId]', error);
    return NextResponse.json({ error: 'No se pudo actualizar el material.' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; materialId: string }> }
) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede quitar materiales.' }, { status: 403 });
  }

  const { id, materialId } = await params;
  const courseId = idDesdeParametro(id);
  const matId = idDesdeParametro(materialId);
  if (!courseId || !matId) return NextResponse.json({ error: 'Parámetros no válidos.' }, { status: 400 });

  try {
    const borrado = await prisma.portalCourseMaterial.deleteMany({ where: { id: matId, course_id: courseId } });
    if (borrado.count === 0) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[portal] DELETE .../materials/[materialId]', error);
    return NextResponse.json({ error: 'No se pudo quitar el material.' }, { status: 500 });
  }
}
