import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { identificar } from '../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../lib/portal/config';
import {
  MaterialNoValido,
  referenciaDeMaterialSubido,
  subirArchivoDeMaterial,
  validarArchivoMaterial,
  validarRegistroSubido,
  type ReferenciaMaterial,
} from '../../../../../../lib/portal/formacion';
import {
  ArchivoFueraDeCarpeta,
  FormacionStorageNoConfigurado,
  MENSAJE_NO_CONFIGURADO,
} from '../../../../../../lib/portal/formacion-storage';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — agregar un material a un curso.
 *
 *   POST /api/portal/courses/:id/materials   (multipart/form-data o JSON)
 *
 * Campos: `type` ('DOCUMENT' | 'LINK'), `title`, `required` ('true'/'false'),
 * y según el tipo: `file` (DOCUMENT) o `url` (LINK).
 *
 * Desde 2026-10-08 (sin límite de peso, pedido de Cristian) el formulario del
 * formador manda JSON: el archivo ya lo subió el navegador DIRECTO a
 * SharePoint (`POST .../materials/upload-session`) y aquí llegan solo
 * `driveItemId` y `mime`; el servidor comprueba que el archivo esté en
 * FORMACION/<curso>/materiales antes de registrarlo. El camino multipart con
 * `file` se conserva por compatibilidad (pasa por Next/IIS, así que solo
 * sirve para archivos pequeños).
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

    const esJson = (request.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
    const json = esJson ? ((await request.json().catch(() => null)) as Record<string, unknown> | null) : null;
    if (esJson && !json) return NextResponse.json({ error: 'Cuerpo no válido.' }, { status: 400 });
    const form = esJson ? null : await request.formData();
    const campo = (nombre: string) => (json ? json[nombre] : form!.get(nombre));

    const tipo = String(campo('type') ?? '').toUpperCase();
    const titulo = String(campo('title') ?? '').trim();
    const obligatorio = String(campo('required') ?? 'true') !== 'false';

    if (tipo !== 'DOCUMENT' && tipo !== 'LINK') {
      return NextResponse.json({ error: 'El tipo debe ser DOCUMENT o LINK.' }, { status: 400 });
    }
    if (!titulo) return NextResponse.json({ error: 'Falta el título del material.' }, { status: 400 });
    if (titulo.length > 255) {
      return NextResponse.json({ error: 'El título es muy largo (máximo 255 caracteres).' }, { status: 400 });
    }

    const ultimoOrden = await prisma.portalCourseMaterial.aggregate({
      where: { course_id: courseId, eliminado_at: null },
      _max: { orden: true },
    });
    const orden = (ultimoOrden._max.orden ?? -1) + 1;

    if (tipo === 'LINK') {
      const url = String(campo('url') ?? '').trim();
      if (!/^https?:\/\/.+/i.test(url)) {
        return NextResponse.json({ error: 'La URL debe empezar por http:// o https://' }, { status: 400 });
      }
      if (url.length > 1000) return NextResponse.json({ error: 'La URL es muy larga.' }, { status: 400 });

      const material = await prisma.portalCourseMaterial.create({
        data: { course_id: courseId, type: 'LINK', title: titulo, orden, url, required: obligatorio },
      });
      return NextResponse.json({ ok: true, material: { id: material.id } });
    }

    let referencia: ReferenciaMaterial;
    if (json) {
      // Subida directa ya hecha por el navegador: solo se comprueba y registra.
      const registro = validarRegistroSubido(json);
      if (!registro.ok) return NextResponse.json({ error: registro.error }, { status: 400 });
      referencia = await referenciaDeMaterialSubido(courseId, registro.driveItemId, registro.mime);
    } else {
      const archivo = form!.get('file');
      const invalido = validarArchivoMaterial(archivo);
      if (invalido) return NextResponse.json({ error: invalido }, { status: 400 });
      // Si falta la configuración, lanza antes de leer el archivo o tocar nada.
      referencia = await subirArchivoDeMaterial(courseId, archivo as File);
    }

    const material = await prisma.portalCourseMaterial.create({
      data: {
        course_id: courseId,
        type: 'DOCUMENT',
        title: titulo,
        orden,
        required: obligatorio,
        ...referencia,
      },
    });
    return NextResponse.json({ ok: true, material: { id: material.id } });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Formación sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: MENSAJE_NO_CONFIGURADO }, { status: 503 });
    }
    if (error instanceof MaterialNoValido) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ArchivoFueraDeCarpeta) {
      return NextResponse.json({ error: 'El archivo subido no está en la carpeta de este curso.' }, { status: 400 });
    }
    console.error('[portal] POST /api/portal/courses/[id]/materials', error);
    return NextResponse.json({ error: 'No se pudo agregar el material.' }, { status: 500 });
  }
}
