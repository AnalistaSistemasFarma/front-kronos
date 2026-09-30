import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../../lib/prisma';
import { identificar } from '../../../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../../../lib/portal/config';
import {
  moverArchivoDeMaterialAEliminados,
  subirArchivoDeMaterial,
  validarArchivoMaterial,
} from '../../../../../../../../lib/portal/formacion';
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
      where: { id: matId, course_id: courseId, type: 'DOCUMENT', eliminado_at: null },
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

/**
 * REEMPLAZA el archivo de un material (o convierte un enlace en documento).
 *
 *   PUT /api/portal/courses/:id/materials/:materialId/file   (multipart: `file`)
 *
 * Orden de los pasos, para no dejar huérfanos:
 *   1. se sube el archivo nuevo a FORMACION/<curso>/materiales;
 *   2. se mueve el anterior a FORMACION/ELIMINADOS/<curso>/materiales;
 *   3. recién entonces se actualiza la fila.
 * Si (2) falla, el nuevo también se manda a ELIMINADOS y la fila queda como
 * estaba: el curso sigue mostrando el archivo anterior, sin duplicados.
 *
 * El progreso de quien ya lo había marcado se CONSERVA (ver el criterio en
 * `PATCH .../materials/:materialId`).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede reemplazar archivos.' }, { status: 403 });
  }

  const { id, materialId } = await params;
  const courseId = idDesdeParametro(id);
  const matId = idDesdeParametro(materialId);
  if (!courseId || !matId) return NextResponse.json({ error: 'Parámetros no válidos.' }, { status: 400 });

  try {
    const actual = await prisma.portalCourseMaterial.findFirst({
      where: { id: matId, course_id: courseId, eliminado_at: null },
      select: { id: true, sp_drive_item_id: true, file_name: true },
    });
    if (!actual) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });

    const form = await request.formData();
    const archivo = form.get('file');
    const invalido = validarArchivoMaterial(archivo);
    if (invalido) return NextResponse.json({ error: invalido }, { status: 400 });

    const nuevo = await subirArchivoDeMaterial(courseId, archivo as File);

    if (actual.sp_drive_item_id) {
      try {
        await moverArchivoDeMaterialAEliminados(courseId, actual.sp_drive_item_id, actual.file_name);
      } catch (error) {
        console.error('[portal] No se pudo mover el archivo anterior a ELIMINADOS', matId, error);
        await moverArchivoDeMaterialAEliminados(courseId, nuevo.sp_drive_item_id, nuevo.file_name).catch((e) =>
          console.error('[portal] Tampoco se pudo retirar el archivo nuevo', nuevo.sp_drive_item_id, e)
        );
        return NextResponse.json(
          {
            error:
              'No se pudo reemplazar el archivo: el anterior no se pudo mover a la carpeta FORMACION/ELIMINADOS de ' +
              'SharePoint. El material quedó como estaba; intente de nuevo o avise a Tecnología.',
          },
          { status: 502 }
        );
      }
    }

    await prisma.portalCourseMaterial.update({
      where: { id: matId },
      data: { type: 'DOCUMENT', url: null, ...nuevo },
    });
    return NextResponse.json({ ok: true, material: { id: matId } });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Formación sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: MENSAJE_NO_CONFIGURADO }, { status: 503 });
    }
    console.error('[portal] PUT .../materials/[materialId]/file', error);
    return NextResponse.json({ error: 'No se pudo reemplazar el archivo.' }, { status: 500 });
  }
}
