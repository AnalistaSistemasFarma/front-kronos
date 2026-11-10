import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { modelo3dParaVer } from '../../../../../lib/vitrina/consulta';
import { VITRINA_MODELO3D_MIME } from '../../../../../lib/vitrina/constants';
import { cabeceraGlb, puedeVerModelo3d } from '../../../../../lib/vitrina/medios';
import { vitrinaImageStorage } from '../../../../../lib/vitrina/storage';
import { errorResponse, getVitrinaContext, jsonNoStore, parseId } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Modelo 3D (GLB) de una presentación. Igual que las imágenes: pasa por el servidor, que verifica
 * el permiso de la Vitrina en la empresa DUEÑA de la presentación (el enlace de OneDrive nunca
 * llega al navegador). El vigente lo ve quien consulta; uno anterior o retirado, solo Gestión.
 * Cada carga tiene otro id, así que se puede guardar en caché privada.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Modelo no válido' }, 400);
  const ctx = await getVitrinaContext();
  if (ctx instanceof Response) return ctx;
  try {
    const m = await modelo3dParaVer(prisma, id);
    if (!m || !puedeVerModelo3d(ctx.access, m)) return jsonNoStore({ error: 'Modelo no encontrado' }, 404);
    const bytes = await vitrinaImageStorage.bajar(m.itemId);
    const glb = bytes ? cabeceraGlb(bytes) : null;
    if (!bytes || !glb || glb.version !== 2) return jsonNoStore({ error: 'No se pudo obtener el modelo del almacenamiento.' }, 502);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': VITRINA_MODELO3D_MIME,
        'Content-Length': String(bytes.length),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error, 'modelo3d');
  }
}
