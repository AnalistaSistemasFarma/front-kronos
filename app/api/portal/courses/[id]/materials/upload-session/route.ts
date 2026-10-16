import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { identificar } from '../../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../../lib/portal/config';
import { abrirSubidaDeMaterial, validarDeclaracionMaterial } from '../../../../../../../lib/portal/formacion';
import {
  FormacionStorageNoConfigurado,
  MENSAJE_NO_CONFIGURADO,
} from '../../../../../../../lib/portal/formacion-storage';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * FORMACIÓN — abrir la subida DIRECTA de un archivo a SharePoint.
 *
 *   POST /api/portal/courses/:id/materials/upload-session
 *   JSON: { nombre, mime, tamano }
 *   → { uploadUrl, expiracion, nombre }
 *
 * Pedido de Cristian Baldión (2026-10-08): sin límite de peso. El navegador
 * sube los bytes directo a SharePoint por la `uploadUrl` (preautorizada por
 * Graph, temporal y válida solo para ese archivo); el token de la app NUNCA
 * sale del servidor. Después registra el material con
 * `POST .../materials` (JSON con `driveItemId`) o, si es un reemplazo, con
 * `PUT .../materials/:materialId/file`.
 *
 * Solo formadores. Se valida el formato (mismos tipos de siempre) y, si
 * Talento Humano lo configura, el tope `PORTAL_TH_MAX_UPLOAD_MB`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede subir archivos.' }, { status: 403 });
  }

  const courseId = idDesdeParametro((await params).id);
  if (!courseId) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400 });

  try {
    const cuerpo = await request.json().catch(() => null);
    const declaracion = validarDeclaracionMaterial(cuerpo);
    if (!declaracion.ok) return NextResponse.json({ error: declaracion.error }, { status: 400 });

    const curso = await prisma.portalCourse.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!curso) return NextResponse.json({ error: 'Curso no encontrado.' }, { status: 404 });

    const sesion = await abrirSubidaDeMaterial(courseId, declaracion.valor);
    return NextResponse.json(
      { uploadUrl: sesion.uploadUrl, expiracion: sesion.expiracion, nombre: sesion.nombre },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Formación sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: MENSAJE_NO_CONFIGURADO }, { status: 503 });
    }
    console.error('[portal] POST .../materials/upload-session', error);
    return NextResponse.json({ error: 'No se pudo preparar la subida a SharePoint.' }, { status: 502 });
  }
}
