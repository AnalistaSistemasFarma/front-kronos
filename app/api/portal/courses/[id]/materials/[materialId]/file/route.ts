import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../../lib/prisma';
import { identificar } from '../../../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../../../lib/portal/config';
import {
  FormacionStorageNoConfigurado,
  MENSAJE_NO_CONFIGURADO,
  descargarArchivoFormacion,
} from '../../../../../../../../lib/portal/formacion-storage';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Sirve el ARCHIVO de un material tipo DOCUMENT.
 *
 * Desde 2026-09-30 el archivo vive en SharePoint (FORMACION) y este endpoint
 * hace de PROXY con la sesión del portal: el navegador nunca recibe una URL de
 * SharePoint. Los materiales subidos ANTES del cambio (sin
 * `sp_drive_item_id`) se siguen sirviendo desde `contenido`, en desuso.
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
    const disposicion = `inline; filename*=UTF-8''${encodeURIComponent(material.file_name ?? 'material')}`;

    if (material.sp_drive_item_id) {
      const archivo = await descargarArchivoFormacion(material.sp_drive_item_id);
      const headers: Record<string, string> = {
        'Content-Type': material.mime || archivo.mime || 'application/octet-stream',
        'Content-Disposition': disposicion,
        'Cache-Control': 'private, max-age=300',
      };
      if (archivo.tamano) headers['Content-Length'] = String(archivo.tamano);
      return new NextResponse(archivo.cuerpo, { headers });
    }

    // Material anterior al cambio a SharePoint: bytes en la base (en desuso).
    if (!material.contenido || !material.mime) {
      return NextResponse.json({ error: 'Este material no tiene archivo.' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(material.contenido), {
      headers: {
        'Content-Type': material.mime,
        'Content-Length': String(material.contenido.byteLength),
        'Content-Disposition': disposicion,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Formación sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: MENSAJE_NO_CONFIGURADO }, { status: 503 });
    }
    console.error('[portal] GET .../materials/[materialId]/file', error);
    return NextResponse.json({ error: 'No se pudo abrir el archivo.' }, { status: 502 });
  }
}
