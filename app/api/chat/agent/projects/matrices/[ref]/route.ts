import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent } from '../../../../../../../lib/chat/agent-auth';
import { jsonNoStore, NO_STORE, serverError, unauthorized } from '../../../../../../../lib/chat/http';
import { buildContentDisposition } from '../../../../../../../lib/chat/attachments';
import { whereProyectoDelAgente } from '../../../../../../../lib/chat/projects';
import { cargarConfigProyectos } from '../../../../../../../lib/proyectos/config-agentes';
import { contenidoParaAgente } from '../../../../../../../lib/proyectos/matrices';

export const dynamic = 'force-dynamic';

/**
 * MATRICES para el PUENTE DE HILOS (llave de alcance 'projects'): el CSV de una hoja
 * (`hoja-<idSheet>`) o la ficha de una versión (`ficha-<idVersion>`). Aparecen como
 * archivos del proyecto en el contexto (lib/proyectos/matrices.ts → archivosParaAgente).
 *
 * ANCLA DE SEGURIDAD: proyecto activo donde el agente de la llave está designado, en una
 * empresa donde está habilitado para Proyectos. Si no, 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    const noEncontrado = () => jsonNoStore({ error: 'Archivo no encontrado.' }, { status: 404 });
    if (agent.scope !== 'projects') return noEncontrado();
    const config = await cargarConfigProyectos();
    if (!config.habilitadoEnAlguna(agent.code)) return noEncontrado();

    const { ref } = await params;
    const c = await contenidoParaAgente(ref, {
      ...whereProyectoDelAgente(agent.idAgent),
      ...config.filtroEmpresas(agent.code),
    });
    if (!c) return noEncontrado();
    const headers = new Headers(NO_STORE);
    headers.set('Content-Type', c.tipo);
    headers.set('Content-Disposition', buildContentDisposition(c.nombre));
    headers.set('X-Content-Type-Options', 'nosniff');
    return new NextResponse(c.texto, { status: 200, headers });
  } catch (error) {
    return serverError('GET /api/chat/agent/projects/matrices/[ref]', error);
  }
}
