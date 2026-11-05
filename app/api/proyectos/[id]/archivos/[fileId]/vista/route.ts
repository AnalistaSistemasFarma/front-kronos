import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, serverError } from '../../../../../../../lib/chat/http';
import { responderVista } from '../../../../../../../lib/chat/vista-respuesta';
import { archivoDeProyectoVisible } from '../../../../../../../lib/proyectos/archivo-visible';

export const dynamic = 'force-dynamic';

/**
 * VISTA PREVIA de un archivo del proyecto (2026-11-05, Nicolás Rivera: «en el tab de
 * archivos debe poderse previsualizar y compartir idéntico como lo tenemos en el chat»).
 * Misma respuesta que /api/chat/attachments/[id]/vista (lib/chat/vista-respuesta.ts); la
 * puerta es la del proyecto: cualquier miembro, como la descarga.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const { id, fileId } = await params;
    const r = await archivoDeProyectoVisible(id, fileId);
    if (!r) return NextResponse.json({ error: 'Archivo no encontrado.' }, { status: 404, headers: NO_STORE });
    if ('response' in r) return r.response;
    return await responderVista(request, {
      itemId: r.archivo.onedrive_item_id,
      nombre: r.archivo.file_name,
      contentType: r.archivo.content_type,
      etiqueta: 'proyectos/visor',
    });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/archivos/[fileId]/vista', error);
  }
}
