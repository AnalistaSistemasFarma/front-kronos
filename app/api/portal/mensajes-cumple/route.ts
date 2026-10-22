import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { resolverNombreEstudiante } from '@/lib/portal/formacion';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { ErrorMensaje, borrarMensaje, enviarMensaje, mensajesVisibles } from '@/lib/portal/mensajes-cumple-servidor';

/**
 * MENSAJES DE CUMPLEAÑOS (Cristian Baldión, 2026-10-20). Detalle de reglas en `lib/portal/mensajes-cumple-servidor.ts`.
 *
 *   GET    ?fecha=AAAA-MM-DD            → { mensajes, puedeModerar }  lo que ESTA sesión puede leer (el cumpleañero, lo suyo; el
 *                                          administrador, todo; cualquier otra persona, una lista vacía)
 *   POST   { fecha, nombre, empresa, texto }  → 201   deja un mensaje a quien cumple años ese día
 *   DELETE ?fecha=AAAA-MM-DD&id=…       → 200   solo el administrador
 *
 * Misma identidad que el resto del portal. Nunca se guarda en caché del navegador. Los errores no traen detalles internos.
 */
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

function responderError(error: unknown, contexto: string) {
  if (error instanceof ErrorMensaje) return NextResponse.json({ error: error.message }, { status: error.estado, headers: SIN_CACHE });
  if (error instanceof FormacionStorageNoConfigurado) {
    console.error('[portal] Mensajes de cumpleaños sin SharePoint configurado:', error.detalle);
    return NextResponse.json({ error: 'Los mensajes de cumpleaños no están configurados en este ambiente. Avise a Tecnología.' }, { status: 503, headers: SIN_CACHE });
  }
  console.error(`[portal] ${contexto}:`, error instanceof FormacionStorageError ? error.message : (error as Error).name);
  const permiso = error instanceof FormacionStorageError && (error.status === 401 || error.status === 403);
  return NextResponse.json(
    {
      error: permiso
        ? 'El portal no tiene permiso para guardar mensajes en SharePoint. Avise a Tecnología.'
        : 'No se pudo completar la operación con los mensajes. Intente en un momento.',
    },
    { status: 502, headers: SIN_CACHE }
  );
}

export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  try {
    const r = await mensajesVisibles({ correo: quien.correo, fecha: request.nextUrl.searchParams.get('fecha') });
    return NextResponse.json(r, { headers: SIN_CACHE });
  } catch (error) {
    return responderError(error, 'GET /api/portal/mensajes-cumple');
  }
}

export async function POST(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!cuerpo || typeof cuerpo !== 'object') return NextResponse.json({ error: 'La solicitud no es válida.' }, { status: 400 });
  try {
    await enviarMensaje({
      correo: quien.correo,
      nombreRemitente: await resolverNombreEstudiante(quien.correo),
      fecha: cuerpo.fecha,
      nombre: cuerpo.nombre,
      empresa: cuerpo.empresa,
      texto: cuerpo.texto,
    });
    return NextResponse.json({ ok: true }, { status: 201, headers: SIN_CACHE });
  } catch (error) {
    return responderError(error, 'POST /api/portal/mensajes-cumple');
  }
}

export async function DELETE(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  try {
    await borrarMensaje({ correo: quien.correo, fecha: request.nextUrl.searchParams.get('fecha'), id: request.nextUrl.searchParams.get('id') });
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
  } catch (error) {
    return responderError(error, 'DELETE /api/portal/mensajes-cumple');
  }
}
