import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { registrarErrorSinDatos } from '@/lib/portal/formulario-servidor';
import { ErrorCatalogoSst, catalogoParaAdministrar, guardarDefinicionSst, retirarFormularioSst } from '@/lib/portal/formularios-sst-catalogo';
import { esAdministradorSst } from '@/lib/portal/formularios-sst-permisos';

/**
 * FORMULARIOS SST — administrar los formularios: crear, editar y retirar (Cristian Baldión, 2026-10-20).
 *
 *   GET    /api/portal/formularios-sst/definiciones           → { formularios: [{ codigo, titulo, origen, editado, guardadoEl, definicion }] }
 *   POST   /api/portal/formularios-sst/definiciones           → { definicion, nuevo }   guarda un formulario nuevo o una versión nueva
 *   DELETE /api/portal/formularios-sst/definiciones?codigo=…  → retira un formulario creado por el administrador
 *
 * SOLO el ADMINISTRADOR (`formularios-sst-permisos.ts`): los lectores SST y cualquier otra sesión reciben 403 y SharePoint ni se toca.
 * Cada guardado es una versión nueva en SharePoint (`FORMULARIOS SST/DEFINICIONES/<código>/`); nada se borra. Las definiciones se validan
 * con las mismas reglas de los formularios de Formación y deben ser encuestas. Los errores no traen detalles internos.
 */
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };
const MAX_BYTES_CUERPO = 512 * 1024;

async function soloAdministrador(request: NextRequest): Promise<{ correo: string } | NextResponse> {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!esAdministradorSst(quien.correo)) return NextResponse.json({ error: 'Solo el administrador puede crear o editar formularios.' }, { status: 403 });
  return { correo: quien.correo };
}

function responderError(error: unknown, contexto: string) {
  if (error instanceof ErrorCatalogoSst) {
    return NextResponse.json({ error: error.message, ...(error.errores.length > 0 ? { errores: error.errores } : {}) }, { status: error.estado, headers: SIN_CACHE });
  }
  if (error instanceof FormacionStorageNoConfigurado) {
    registrarErrorSinDatos(`${contexto} (sin configurar)`, error);
    return NextResponse.json({ error: 'Los formularios SST no están configurados en este ambiente. Avise a Tecnología.' }, { status: 503, headers: SIN_CACHE });
  }
  registrarErrorSinDatos(contexto, error);
  const permiso = error instanceof FormacionStorageError && (error.status === 401 || error.status === 403);
  return NextResponse.json(
    { error: permiso ? 'El portal no tiene permiso para guardar en la carpeta FORMULARIOS SST de SharePoint. Avise a Tecnología.' : 'No se pudo completar la operación. Intente de nuevo.' },
    { status: 502, headers: SIN_CACHE }
  );
}

export async function GET(request: NextRequest) {
  const quien = await soloAdministrador(request);
  if (quien instanceof NextResponse) return quien;
  try {
    const { formularios } = await catalogoParaAdministrar();
    return NextResponse.json(
      { formularios: formularios.map((f) => ({ codigo: f.codigo, titulo: f.titulo, origen: f.origen, editado: f.editado, guardadoEl: f.guardadoEl, definicion: f.definicion })) },
      { headers: SIN_CACHE }
    );
  } catch (error) {
    return responderError(error, 'GET /api/portal/formularios-sst/definiciones');
  }
}

export async function POST(request: NextRequest) {
  const quien = await soloAdministrador(request);
  if (quien instanceof NextResponse) return quien;
  const crudo = await request.text().catch(() => '');
  if (Buffer.byteLength(crudo, 'utf8') > MAX_BYTES_CUERPO) return NextResponse.json({ error: 'El formulario es demasiado grande.' }, { status: 413 });
  let cuerpo: { definicion?: unknown; nuevo?: unknown } | null = null;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    cuerpo = null;
  }
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo) || typeof cuerpo.nuevo !== 'boolean') {
    return NextResponse.json({ error: 'La solicitud no es válida.' }, { status: 400 });
  }
  try {
    const f = await guardarDefinicionSst({ definicion: cuerpo.definicion, nuevo: cuerpo.nuevo, correo: quien.correo });
    return NextResponse.json({ formulario: { codigo: f.codigo, titulo: f.titulo, origen: f.origen, guardadoEl: f.guardadoEl } }, { status: cuerpo.nuevo ? 201 : 200, headers: SIN_CACHE });
  } catch (error) {
    return responderError(error, 'POST /api/portal/formularios-sst/definiciones');
  }
}

export async function DELETE(request: NextRequest) {
  const quien = await soloAdministrador(request);
  if (quien instanceof NextResponse) return quien;
  try {
    await retirarFormularioSst({ codigo: request.nextUrl.searchParams.get('codigo'), correo: quien.correo });
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
  } catch (error) {
    return responderError(error, 'DELETE /api/portal/formularios-sst/definiciones');
  }
}
