import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { imagenParaVer } from '../../../../../lib/vitrina/consulta';
import { formatoImagen } from '../../../../../lib/vitrina/medios';
import { companyVitrinaAccess } from '../../../../../lib/vitrina/rules';
import { vitrinaImageStorage } from '../../../../../lib/vitrina/storage';
import { errorResponse, getVitrinaContext, jsonNoStore, parseId } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Imagen de empaque. Pasa por el servidor, que verifica el permiso de la Vitrina en la
 * empresa de la presentación: la URL de OneDrive nunca llega al navegador. Se entrega
 * en línea (sin descarga); cada carga nueva tiene otro id, así que se puede guardar en caché privada.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Imagen no válida' }, 400);
  const ctx = await getVitrinaContext();
  if (ctx instanceof Response) return ctx;
  try {
    const img = await imagenParaVer(prisma, id);
    if (!img || !companyVitrinaAccess(ctx.access, img.idCompany, 'canConsultar')) return jsonNoStore({ error: 'Imagen no encontrada' }, 404);
    const bytes = await vitrinaImageStorage.bajar(img.itemId);
    const formato = bytes ? formatoImagen(bytes) : null;
    if (!bytes || !formato) return jsonNoStore({ error: 'No se pudo obtener la imagen del almacenamiento.' }, 502);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': formato.mime,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error, 'imagen');
  }
}
