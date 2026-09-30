import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { identificar } from '../../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../../lib/portal/config';
import { moverArchivoDeMaterialAEliminados } from '../../../../../../../lib/portal/formacion';
import { FormacionStorageNoConfigurado, MENSAJE_NO_CONFIGURADO } from '../../../../../../../lib/portal/formacion-storage';

const MENSAJE_NO_SE_MOVIO =
  'su archivo no se pudo mover a la carpeta FORMACION/ELIMINADOS de SharePoint. ' +
  'El material quedó como estaba; intente de nuevo o avise a Tecnología.';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — editar o quitar un material puntual.
 *
 *   PATCH  /api/portal/courses/:id/materials/:materialId  (JSON) — título,
 *          obligatorio, orden (`orden` numérico o `mover: 'arriba'|'abajo'`),
 *          la URL, y el TIPO: pasar un documento a enlace (`tipo: 'LINK'` +
 *          `url`) mueve su archivo a FORMACION/ELIMINADOS. Pasar un enlace a
 *          documento, o REEMPLAZAR el archivo, va por
 *          `PUT .../materials/:materialId/file` (multipart).
 *
 * CRITERIO DE PROGRESO al editar (Cristian, 2026-09-30): editar un material
 * NUNCA borra progreso ni certificados. Quien ya lo marcó como completado lo
 * conserva aunque cambie el archivo, el tipo o la marca de obligatorio; el %
 * se recalcula en vivo con los materiales obligatorios vigentes, y un
 * certificado ya emitido queda congelado (ver `emitirCertificadoSiCorresponde`).
 *   DELETE /api/portal/courses/:id/materials/:materialId
 *
 * Quitar un material es un borrado LÓGICO (`eliminado_at`/`eliminado_por`):
 * deja de verse y de contar para el progreso, pero la fila queda para
 * trazabilidad. Si tiene archivo en SharePoint, el archivo NO se borra: se
 * MUEVE a FORMACION/ELIMINADOS/<curso>/materiales (pedido de Cristian,
 * 2026-09-30). Si el movimiento falla, la eliminación falla también — no se
 * dejan archivos huérfanos en la carpeta del curso.
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
      where: { id: matId, course_id: courseId, eliminado_at: null },
      select: { id: true, type: true, orden: true, sp_drive_item_id: true, file_name: true },
    });
    if (!actual) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });

    const body = await request.json().catch(() => null);
    const data: {
      title?: string;
      orden?: number;
      required?: boolean;
      url?: string | null;
      type?: string;
      file_name?: string | null;
      mime?: string | null;
      sp_drive_item_id?: string | null;
      sp_web_url?: string | null;
      file_size?: bigint | null;
    } = {};

    const tipo = typeof body?.tipo === 'string' ? body.tipo.toUpperCase() : actual.type;
    if (tipo !== 'DOCUMENT' && tipo !== 'LINK') {
      return NextResponse.json({ error: 'El tipo debe ser DOCUMENT o LINK.' }, { status: 400 });
    }
    if (tipo === 'DOCUMENT' && actual.type === 'LINK') {
      return NextResponse.json(
        { error: 'Para pasar un enlace a documento, suba el archivo (reemplazar archivo).' },
        { status: 400 }
      );
    }

    if (typeof body?.titulo === 'string') {
      const titulo = body.titulo.trim();
      if (!titulo) return NextResponse.json({ error: 'El título no puede quedar vacío.' }, { status: 400 });
      data.title = titulo.slice(0, 255);
    }
    if (typeof body?.orden === 'number' && Number.isInteger(body.orden)) data.orden = body.orden;
    if (typeof body?.obligatorio === 'boolean') data.required = body.obligatorio;
    if (typeof body?.url === 'string') {
      if (tipo !== 'LINK') {
        return NextResponse.json({ error: 'Solo un material tipo enlace tiene URL.' }, { status: 400 });
      }
      const url = body.url.trim();
      if (!/^https?:\/\/.+/i.test(url)) {
        return NextResponse.json({ error: 'La URL debe empezar por http:// o https://' }, { status: 400 });
      }
      if (url.length > 1000) return NextResponse.json({ error: 'La URL es muy larga.' }, { status: 400 });
      data.url = url;
    }

    // Documento → enlace: el archivo deja de ser parte del curso y se mueve a
    // ELIMINADOS (nada se borra de SharePoint). Si no se mueve, no se cambia.
    if (tipo === 'LINK' && actual.type === 'DOCUMENT') {
      if (!data.url) return NextResponse.json({ error: 'Falta la URL del enlace.' }, { status: 400 });
      if (actual.sp_drive_item_id) {
        try {
          await moverArchivoDeMaterialAEliminados(courseId, actual.sp_drive_item_id, actual.file_name);
        } catch (error) {
          if (error instanceof FormacionStorageNoConfigurado) throw error;
          console.error('[portal] No se pudo mover el material a ELIMINADOS', matId, error);
          return NextResponse.json({ error: `No se pudo cambiar el tipo: ${MENSAJE_NO_SE_MOVIO}` }, { status: 502 });
        }
      }
      Object.assign(data, {
        type: 'LINK',
        file_name: null,
        mime: null,
        sp_drive_item_id: null,
        sp_web_url: null,
        file_size: null,
      });
    }

    // Subir/bajar un puesto: se renumera TODO el curso (0, 1, 2…) con el
    // intercambio aplicado, en una transacción. Así nunca quedan dos
    // materiales con el mismo `orden` ni huecos que confundan el siguiente.
    if (body?.mover === 'arriba' || body?.mover === 'abajo') {
      const lista = await prisma.portalCourseMaterial.findMany({
        where: { course_id: courseId, eliminado_at: null },
        orderBy: [{ orden: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const i = lista.findIndex((m) => m.id === matId);
      const j = body.mover === 'arriba' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < lista.length) [lista[i], lista[j]] = [lista[j], lista[i]];
      await prisma.$transaction(
        lista.map((m, orden) =>
          prisma.portalCourseMaterial.update({
            where: { id: m.id },
            data: m.id === matId ? { ...data, orden } : { orden },
          })
        )
      );
      return NextResponse.json({ ok: true, material: { id: matId } });
    }

    const material = await prisma.portalCourseMaterial.update({ where: { id: matId }, data });
    return NextResponse.json({ ok: true, material: { id: material.id } });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Formación sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: MENSAJE_NO_CONFIGURADO }, { status: 503 });
    }
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
    const material = await prisma.portalCourseMaterial.findFirst({
      where: { id: matId, course_id: courseId, eliminado_at: null },
      select: { id: true, sp_drive_item_id: true, file_name: true },
    });
    if (!material) return NextResponse.json({ error: 'Material no encontrado.' }, { status: 404 });

    const data: {
      eliminado_at: Date;
      eliminado_por: string;
      sp_drive_item_id?: string;
      sp_web_url?: string | null;
      file_name?: string;
    } = { eliminado_at: new Date(), eliminado_por: quien.correo };

    if (material.sp_drive_item_id) {
      try {
        const movido = await moverArchivoDeMaterialAEliminados(courseId, material.sp_drive_item_id, material.file_name);
        data.sp_drive_item_id = movido.driveItemId;
        data.sp_web_url = movido.webUrl;
        if (movido.nombre) data.file_name = movido.nombre.slice(0, 255);
      } catch (error) {
        if (error instanceof FormacionStorageNoConfigurado) throw error;
        console.error('[portal] No se pudo mover el material a ELIMINADOS', matId, error);
        return NextResponse.json(
          { error: `No se pudo quitar el material: ${MENSAJE_NO_SE_MOVIO}` },
          { status: 502 }
        );
      }
    }

    await prisma.portalCourseMaterial.update({ where: { id: matId }, data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Formación sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: MENSAJE_NO_CONFIGURADO }, { status: 503 });
    }
    console.error('[portal] DELETE .../materials/[materialId]', error);
    return NextResponse.json({ error: 'No se pudo quitar el material.' }, { status: 500 });
  }
}
