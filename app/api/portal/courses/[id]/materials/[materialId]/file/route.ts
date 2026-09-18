import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../../lib/prisma';
import { identificar } from '../../../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../../../lib/portal/config';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Sirve el ARCHIVO de un material tipo DOCUMENT — mismo patrón que
 * `/api/portal/file`, pero leyendo `portal_course_material.contenido` en vez
 * de SharePoint (ver la migración: es el mismo mecanismo que `portal_banner`,
 * bytes en la base).
 *
 *   GET /api/portal/courses/:id/materials/:materialId/file
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const { id, materialId } = await params;
  const courseId = idDesdeParametro(id);
  const matId = idDesdeParametro(materialId);
  if (!courseId || !matId) return NextResponse.json({ error: 'Parámetros no válidos.' }, { status: 400 });

  const esFormador = formadoresDePortal().includes(quien.correo.toLowerCase());

  try {
    const material = await prisma.portalCourseMaterial.findFirst({
      where: { id: matId, course_id: courseId, type: 'DOCUMENT' },
      include: { course: { select: { active: true } } },
    });
    if (!material) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });
    if (!material.course.active && !esFormador) {
      return NextResponse.json({ error: 'Este curso no está disponible.' }, { status: 404 });
    }
    if (!material.contenido || !material.mime) {
      return NextResponse.json({ error: 'Este material no tiene archivo.' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(material.contenido), {
      headers: {
        'Content-Type': material.mime,
        'Content-Length': String(material.contenido.byteLength),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(material.file_name ?? 'material')}`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[portal] GET .../materials/[materialId]/file', error);
    return NextResponse.json({ error: 'No se pudo abrir el archivo.' }, { status: 502 });
  }
}
