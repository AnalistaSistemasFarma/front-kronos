import { prisma } from '../../../../../lib/prisma';
import { cargarModelo3d } from '../../../../../lib/vitrina/mediosDb';
import { vitrinaImageStorage } from '../../../../../lib/vitrina/storage';
import { VITRINA_MODELO3D_MAX_BYTES } from '../../../../../lib/vitrina/constants';
import { errorResponse, getVitrinaContext, jsonNoStore, parseId, requireGestion } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Carga o reemplaza el modelo 3D (multipart: company, presentacion, archivo .glb y, opcionales,
 * ancho_cm, alto_cm, profundo_cm) en el almacenamiento de adjuntos de SynerLink. El anterior
 * deja de ser vigente y queda en el historial.
 */
export async function POST(request: Request) {
  const ctx = await getVitrinaContext();
  if (ctx instanceof Response) return ctx;
  const form = await request.formData().catch(() => null);
  if (!form) return jsonNoStore({ error: 'Cuerpo de la petición no válido' }, 400);
  const actor = requireGestion(ctx, parseId(form.get('company')));
  if (actor instanceof Response) return actor;
  const archivo = form.get('archivo');
  if (!(archivo instanceof Blob)) return jsonNoStore({ error: 'Adjunte el modelo 3D (.glb).' }, 400);
  if (archivo.size > VITRINA_MODELO3D_MAX_BYTES) return jsonNoStore({ error: 'El modelo 3D supera el tamaño máximo (25 MB).' }, 400);
  try {
    const contenido = new Uint8Array(await archivo.arrayBuffer());
    const nombreOriginal = archivo instanceof File ? archivo.name : null;
    return jsonNoStore(
      await cargarModelo3d(prisma, vitrinaImageStorage, actor, {
        idPresentacion: parseId(form.get('presentacion')),
        contenido,
        nombreOriginal,
        ancho_cm: form.get('ancho_cm'),
        alto_cm: form.get('alto_cm'),
        profundo_cm: form.get('profundo_cm'),
      }),
      201
    );
  } catch (error) {
    return errorResponse(error, 'modelo3d:cargar');
  }
}
