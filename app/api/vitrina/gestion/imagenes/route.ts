import { prisma } from '../../../../../lib/prisma';
import { cargarImagen } from '../../../../../lib/vitrina/mediosDb';
import { vitrinaImageStorage } from '../../../../../lib/vitrina/storage';
import { VITRINA_IMAGEN_MAX_BYTES } from '../../../../../lib/vitrina/constants';
import { errorResponse, getVitrinaContext, jsonNoStore, parseId, requireGestion } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Carga una imagen de empaque (multipart: company, presentacion, tipo, archivo) al
 * almacenamiento de adjuntos de SynerLink. La anterior del mismo tipo deja de ser vigente.
 */
export async function POST(request: Request) {
  const ctx = await getVitrinaContext();
  if (ctx instanceof Response) return ctx;
  const form = await request.formData().catch(() => null);
  if (!form) return jsonNoStore({ error: 'Cuerpo de la petición no válido' }, 400);
  const actor = requireGestion(ctx, parseId(form.get('company')));
  if (actor instanceof Response) return actor;
  const archivo = form.get('archivo');
  if (!(archivo instanceof Blob)) return jsonNoStore({ error: 'Adjunte la imagen.' }, 400);
  if (archivo.size > VITRINA_IMAGEN_MAX_BYTES) return jsonNoStore({ error: 'La imagen supera el tamaño máximo (10 MB).' }, 400);
  try {
    const contenido = new Uint8Array(await archivo.arrayBuffer());
    return jsonNoStore(await cargarImagen(prisma, vitrinaImageStorage, actor, { idPresentacion: parseId(form.get('presentacion')), tipo: form.get('tipo'), contenido }), 201);
  } catch (error) {
    return errorResponse(error, 'imagen:cargar');
  }
}
