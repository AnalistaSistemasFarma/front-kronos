import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { identificar } from '../../../../../../lib/portal/acceso';
import {
  MATERIAL_MIMES_PERMITIDOS,
  MAX_MATERIAL_BYTES,
  formadoresDePortal,
} from '../../../../../../lib/portal/config';
import { carpetaSharePointDelCurso } from '../../../../../../lib/portal/formacion';
import {
  FormacionStorageNoConfigurado,
  MENSAJE_NO_CONFIGURADO,
  leerConfigFormacion,
  subirArchivoFormacion,
} from '../../../../../../lib/portal/formacion-storage';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — agregar un material a un curso.
 *
 *   POST /api/portal/courses/:id/materials   (multipart/form-data)
 *
 * Campos: `type` ('DOCUMENT' | 'LINK'), `title`, `required` ('true'/'false'),
 * y según el tipo: `file` (DOCUMENT) o `url` (LINK).
 *
 * Siempre multipart, aunque un enlace no suba nada: así el formulario del
 * formador es uno solo y no dos caminos distintos según el tipo.
 *
 * El ARCHIVO de un DOCUMENT se guarda en SharePoint (TalentoHumano /
 * FORMACION / <curso> / materiales) — pedido de Cristian, 2026-09-30. La base
 * solo guarda la referencia. Si SharePoint no está configurado, se responde
 * 503 con un mensaje claro: NUNCA se cae en silencio a guardar en la base.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede agregar materiales.' }, { status: 403 });
  }

  const courseId = idDesdeParametro((await params).id);
  if (!courseId) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400 });

  try {
    const curso = await prisma.portalCourse.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!curso) return NextResponse.json({ error: 'Curso no encontrado.' }, { status: 404 });

    const form = await request.formData();
    const tipo = String(form.get('type') ?? '').toUpperCase();
    const titulo = String(form.get('title') ?? '').trim();
    const obligatorio = String(form.get('required') ?? 'true') !== 'false';

    if (tipo !== 'DOCUMENT' && tipo !== 'LINK') {
      return NextResponse.json({ error: 'El tipo debe ser DOCUMENT o LINK.' }, { status: 400 });
    }
    if (!titulo) return NextResponse.json({ error: 'Falta el título del material.' }, { status: 400 });
    if (titulo.length > 255) {
      return NextResponse.json({ error: 'El título es muy largo (máximo 255 caracteres).' }, { status: 400 });
    }

    const ultimoOrden = await prisma.portalCourseMaterial.aggregate({
      where: { course_id: courseId },
      _max: { orden: true },
    });
    const orden = (ultimoOrden._max.orden ?? -1) + 1;

    if (tipo === 'LINK') {
      const url = String(form.get('url') ?? '').trim();
      if (!/^https?:\/\/.+/i.test(url)) {
        return NextResponse.json({ error: 'La URL debe empezar por http:// o https://' }, { status: 400 });
      }
      if (url.length > 1000) return NextResponse.json({ error: 'La URL es muy larga.' }, { status: 400 });

      const material = await prisma.portalCourseMaterial.create({
        data: { course_id: courseId, type: 'LINK', title: titulo, orden, url, required: obligatorio },
      });
      return NextResponse.json({ ok: true, material: { id: material.id } });
    }

    const archivo = form.get('file');
    if (!(archivo instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo del documento.' }, { status: 400 });
    }
    const mime = (archivo.type || '').toLowerCase();
    if (!MATERIAL_MIMES_PERMITIDOS.includes(mime)) {
      return NextResponse.json({ error: `Formato no admitido (${mime || 'desconocido'}).` }, { status: 400 });
    }
    if (archivo.size === 0) return NextResponse.json({ error: 'El archivo llegó vacío.' }, { status: 400 });
    if (archivo.size > MAX_MATERIAL_BYTES) {
      return NextResponse.json({ error: 'El archivo es muy grande. El tope es 25 MB.' }, { status: 400 });
    }

    // Antes de leer el archivo y tocar nada: si falta la configuración, el
    // formador se entera de una vez.
    leerConfigFormacion();

    const carpetaCurso = await carpetaSharePointDelCurso(courseId);
    const subido = await subirArchivoFormacion({
      carpetaCurso,
      subcarpeta: 'materiales',
      nombreArchivo: archivo.name,
      contenido: new Uint8Array(await archivo.arrayBuffer()),
      mime,
    });

    const material = await prisma.portalCourseMaterial.create({
      data: {
        course_id: courseId,
        type: 'DOCUMENT',
        title: titulo,
        orden,
        required: obligatorio,
        file_name: (subido.nombre || archivo.name).slice(0, 255) || 'material',
        mime,
        sp_drive_item_id: subido.driveItemId,
        sp_web_url: subido.webUrl,
        file_size: BigInt(subido.tamano),
      },
    });
    return NextResponse.json({ ok: true, material: { id: material.id } });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Formación sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: MENSAJE_NO_CONFIGURADO }, { status: 503 });
    }
    console.error('[portal] POST /api/portal/courses/[id]/materials', error);
    return NextResponse.json({ error: 'No se pudo agregar el material.' }, { status: 500 });
  }
}
