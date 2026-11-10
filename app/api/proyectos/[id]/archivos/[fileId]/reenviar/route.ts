import { NextRequest } from 'next/server';
import { jsonNoStore, serverError } from '../../../../../../../lib/chat/http';
import { destinosDe, reenviarArchivo } from '../../../../../../../lib/chat/reenviar-archivo';
import { archivoDeProyectoVisible } from '../../../../../../../lib/proyectos/archivo-visible';

export const dynamic = 'force-dynamic';

/**
 * COMPARTIR un archivo del proyecto por el chat (2026-11-05): lo mismo que
 * /api/chat/attachments/[id]/reenviar (lib/chat/reenviar-archivo.ts).
 *
 *   GET  → { destinos }   personas, grupos y conversaciones de proyecto donde puede escribir
 *   POST { idConversation, body? } → 201 { message }   copia el archivo y publica el mensaje
 *
 * ORIGEN: miembro del proyecto (la misma puerta de la descarga). DESTINO: la puerta de
 * siempre de la conversación elegida (dentro de reenviarArchivo).
 */
const noEncontrado = () => jsonNoStore({ error: 'Archivo no encontrado.' }, { status: 404 });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const { id, fileId } = await params;
    const r = await archivoDeProyectoVisible(id, fileId);
    if (!r) return noEncontrado();
    if ('response' in r) return r.response;
    return jsonNoStore({ destinos: await destinosDe(r.user, null) });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/archivos/[fileId]/reenviar', error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const { id, fileId } = await params;
    const r = await archivoDeProyectoVisible(id, fileId);
    if (!r) return noEncontrado();
    if ('response' in r) return r.response;
    return await reenviarArchivo(request, r.archivo, null);
  } catch (error) {
    return serverError('POST /api/proyectos/[id]/archivos/[fileId]/reenviar', error);
  }
}
