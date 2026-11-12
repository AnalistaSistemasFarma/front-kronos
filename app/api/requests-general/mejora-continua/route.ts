import { NextRequest } from 'next/server';
import { forbidden, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';
import { decidir, decisionesDelFlujo, diagnosticoDelFlujo, MejoraError, puedeMejorarFlujos } from '../../../../lib/workflow/mejora-continua';
import { calificarFlujo } from '../../../../lib/workflow/mejora-continua-rules';

export const dynamic = 'force-dynamic';

/**
 * MEJORA CONTINUA de un flujo de trabajo (2026-11-09). Diseño: docs/flujos-mejora-continua.md.
 *
 *   GET  ?id_process_category=N[&refrescar=1]  → diagnóstico (6 meses), semáforo, sugerencias y decisiones
 *   POST { id_process_category, clave, estado: 'aplicada' | 'descartada', motivo?, titulo?, metricaAntes? }
 *
 * Solo administradores o quien tenga el subproceso de Flujos de trabajo / Administración de flujos.
 * Lectura de solicitudes y tareas; lo único que escribe es la decisión.
 */
function idFlujo(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function puerta() {
  const user = await resolveSessionUser();
  if (!user) return { response: unauthorized() };
  if (!(await puedeMejorarFlujos(user))) return { response: forbidden('Necesita permiso de administración de flujos de trabajo.') };
  return { user };
}

export async function GET(request: NextRequest) {
  try {
    const g = await puerta();
    if ('response' in g) return g.response;
    const id = idFlujo(request.nextUrl.searchParams.get('id_process_category'));
    if (!id) return jsonNoStore({ error: 'Indique el flujo.' }, { status: 400 });
    const r = await diagnosticoDelFlujo(id, { refrescar: request.nextUrl.searchParams.get('refrescar') === '1' });
    if (!r.habilitado) return jsonNoStore(r);
    // Los ciclos crudos son para el indicador de la empresa; la pantalla del flujo usa la tendencia.
    const { ciclos: _ciclos, ...diagnostico } = r.diagnostico;
    void _ciclos;
    const decisiones = await decisionesDelFlujo(id);
    // La MISMA calificación que muestra el indicador del panel de flujos (coherencia, 2026-11-09).
    const decididas = new Set(decisiones.map((x) => x.clave));
    const pendientes = r.diagnostico.sugerencias.filter((x) => !decididas.has(x.clave)).length;
    return jsonNoStore({ ...r, diagnostico, decisiones, calificacion: calificarFlujo(r.diagnostico, pendientes) });
  } catch (error) {
    if (error instanceof MejoraError) return jsonNoStore({ error: error.message }, { status: error.status });
    return serverError('GET /api/requests-general/mejora-continua', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const g = await puerta();
    if ('response' in g) return g.response;
    const datos = await readJsonBody(request);
    if (!datos) return jsonNoStore({ error: 'El cuerpo debe ser un objeto JSON.' }, { status: 400 });
    const id = idFlujo(datos.id_process_category);
    if (!id) return jsonNoStore({ error: 'Indique el flujo.' }, { status: 400 });
    return jsonNoStore(await decidir(g.user, id, datos));
  } catch (error) {
    if (error instanceof MejoraError) return jsonNoStore({ error: error.message }, { status: error.status });
    return serverError('POST /api/requests-general/mejora-continua', error);
  }
}
