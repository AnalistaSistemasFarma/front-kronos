import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { resolverNombreEstudiante } from '@/lib/portal/formacion';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { MENSAJE_AUTORIZACION, definicionPublica, validarRespuestas } from '@/lib/portal/formulario';
import { registrarErrorSinDatos } from '@/lib/portal/formulario-servidor';
import { formularioSst } from '@/lib/portal/formularios-sst';
import { ErrorEnvioSst, guardarEnvioSst } from '@/lib/portal/formularios-sst-servidor';

/**
 * FORMULARIOS SST — abrir y enviar un formulario (Cristian Baldión, 2026-10-20).
 *
 *   GET  /api/portal/formularios-sst/:codigo   → la definición (con el mismo formato del formulario de un curso), el correo y el nombre de
 *                                                la sesión para prellenar. NUNCA devuelve respuestas de nadie.
 *   POST /api/portal/formularios-sst/:codigo   → JSON `{ autorizaDatos, respuestas }`. Valida en el servidor (obligatorias, tipos, opciones y
 *                                                la autorización de datos del formulario de salud) y guarda UN archivo en SharePoint.
 *
 * A diferencia de un formulario de curso, SE PUEDE ENVIAR VARIAS VECES (cada reporte y cada episodio de síntomas es nuevo), con un tope
 * diario por persona. El correo que se guarda es el de la SESIÓN, aunque el formulario diga otra cosa. Los errores no traen detalles
 * internos ni respuestas (datos sensibles, Ley 1581).
 */
const MAX_BYTES_CUERPO = 512 * 1024;
const SIN_CACHE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ codigo: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  const formulario = formularioSst((await params).codigo);
  if (!formulario) return NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 });
  try {
    return NextResponse.json(
      {
        material: { id: 0, titulo: formulario.titulo },
        formulario: { versionId: 1, version: 1, definicion: definicionPublica(formulario.definicion) },
        prellenado: { correo: quien.correo, nombre: await resolverNombreEstudiante(quien.correo) },
        enviadaEl: null,
      },
      { headers: SIN_CACHE }
    );
  } catch (error) {
    registrarErrorSinDatos('GET /api/portal/formularios-sst/[codigo]', error);
    return NextResponse.json({ error: 'No se pudo cargar el formulario.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ codigo: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  const formulario = formularioSst((await params).codigo);
  if (!formulario) return NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 });

  const crudo = await request.text().catch(() => '');
  if (Buffer.byteLength(crudo, 'utf8') > MAX_BYTES_CUERPO) return NextResponse.json({ error: 'Las respuestas son demasiado largas.' }, { status: 413 });
  let cuerpo: { autorizaDatos?: unknown; respuestas?: unknown } | null = null;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    cuerpo = null;
  }
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return NextResponse.json({ error: 'Cuerpo no válido.' }, { status: 400 });

  const { definicion } = formulario;
  if (definicion.autorizacion && cuerpo.autorizaDatos !== true) {
    return NextResponse.json({ error: MENSAJE_AUTORIZACION, errores: [{ id: 'autorizacion', mensaje: MENSAJE_AUTORIZACION }] }, { status: 422 });
  }

  // El correo es el de la sesión: no se puede responder «a nombre de» otra persona.
  const entrada = { ...((cuerpo.respuestas && typeof cuerpo.respuestas === 'object' && !Array.isArray(cuerpo.respuestas) ? cuerpo.respuestas : {}) as Record<string, unknown>) };
  for (const p of definicion.preguntas) if (p.prellenar === 'correo') entrada[p.id] = quien.correo;

  const validacion = validarRespuestas(definicion, entrada);
  if (!validacion.ok) {
    return NextResponse.json({ error: 'Faltan respuestas obligatorias o hay respuestas no válidas.', errores: validacion.errores }, { status: 422 });
  }

  try {
    const { enviadoEl } = await guardarEnvioSst({ formulario, correo: quien.correo, autorizaDatos: cuerpo.autorizaDatos === true, respuestas: validacion.respuestas });
    return NextResponse.json({ ok: true, completado: true, enviadaEl: enviadoEl }, { status: 201, headers: SIN_CACHE });
  } catch (error) {
    if (error instanceof ErrorEnvioSst) return NextResponse.json({ error: error.message }, { status: error.estado, headers: SIN_CACHE });
    if (error instanceof FormacionStorageNoConfigurado) {
      registrarErrorSinDatos('POST /api/portal/formularios-sst/[codigo] (sin configurar)', error);
      return NextResponse.json({ error: 'Los formularios SST no están configurados en este ambiente. Avise a Tecnología.' }, { status: 503, headers: SIN_CACHE });
    }
    registrarErrorSinDatos('POST /api/portal/formularios-sst/[codigo]', error);
    const permiso = error instanceof FormacionStorageError && (error.status === 401 || error.status === 403);
    return NextResponse.json(
      { error: permiso ? 'El portal no tiene permiso para guardar el formulario en SharePoint. Avise a Tecnología.' : 'No se pudieron guardar las respuestas. Intente de nuevo.' },
      { status: 502, headers: SIN_CACHE }
    );
  }
}
