import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../lib/portal/config';
import { MAX_BYTES_DEFINICION, validarDefinicion } from '../../../../../lib/portal/formulario';
import {
  CodigoDeFormularioRepetido,
  guardarVersionNueva,
  registrarErrorSinDatos,
  versionVigente,
} from '../../../../../lib/portal/formulario-servidor';

function idDesdeParametro(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function soloFormador(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return { error: NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 }) };
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return { error: NextResponse.json({ error: 'Solo un formador puede gestionar formularios.' }, { status: 403 }) };
  }
  return { correo: quien.correo };
}

/**
 * FORMACIÓN — un formulario propio (vista formador).
 *
 *   GET /api/portal/formularios/:id  — definición VIGENTE (vista previa y
 *                                      edición del JSON).
 *   PUT /api/portal/formularios/:id  — guarda una VERSIÓN NUEVA con la
 *                                      definición enviada (el código no cambia).
 *                                      Las respuestas ya enviadas conservan la
 *                                      versión con la que se respondieron.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ formularioId: string }> }) {
  const acceso = await soloFormador(request);
  if ('error' in acceso) return acceso.error;
  const id = idDesdeParametro((await params).formularioId);
  if (!id) return NextResponse.json({ error: 'Formulario no válido.' }, { status: 400 });
  try {
    const vigente = await versionVigente(id);
    if (!vigente) return NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 });
    return NextResponse.json(
      { formulario: { id: vigente.formularioId, versionId: vigente.versionId, version: vigente.version, definicion: vigente.definicion } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    registrarErrorSinDatos('GET /api/portal/formularios/[id]', error);
    return NextResponse.json({ error: 'No se pudo cargar el formulario.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ formularioId: string }> }) {
  const acceso = await soloFormador(request);
  if ('error' in acceso) return acceso.error;
  const id = idDesdeParametro((await params).formularioId);
  if (!id) return NextResponse.json({ error: 'Formulario no válido.' }, { status: 400 });
  const crudo = await request.text().catch(() => '');
  if (Buffer.byteLength(crudo, 'utf8') > MAX_BYTES_DEFINICION) {
    return NextResponse.json({ error: 'La definición es demasiado grande.' }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: 'El JSON no es válido.', errores: ['JSON mal formado.'] }, { status: 400 });
  }
  const r = validarDefinicion(json);
  if (!r.ok) return NextResponse.json({ error: 'La definición del formulario no es válida.', errores: r.errores }, { status: 400 });
  try {
    const f = await guardarVersionNueva(id, r.definicion, acceso.correo);
    if (!f) return NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, formulario: { id: f.id, codigo: f.codigo, titulo: f.titulo, version: f.version_actual } });
  } catch (error) {
    if (error instanceof CodigoDeFormularioRepetido) {
      return NextResponse.json({ error: 'El código del formulario no se puede cambiar al editarlo.' }, { status: 400 });
    }
    registrarErrorSinDatos('PUT /api/portal/formularios/[id]', error);
    return NextResponse.json({ error: 'No se pudo guardar la versión nueva.' }, { status: 500 });
  }
}
