import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { identificar } from '../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../lib/portal/config';
import { MAX_BYTES_DEFINICION, validarDefinicion } from '../../../../lib/portal/formulario';
import { CodigoDeFormularioRepetido, crearFormulario, registrarErrorSinDatos } from '../../../../lib/portal/formulario-servidor';

/**
 * FORMACIÓN — FORMULARIOS PROPIOS (vista formador, Cristian 2026-10-08).
 *
 *   GET  /api/portal/formularios   — lista (código, título, versión, preguntas).
 *   POST /api/portal/formularios   — IMPORTA una definición JSON (ver
 *                                    `lib/portal/formulario.ts`) y crea el
 *                                    formulario con su versión 1. 409 si el
 *                                    código ya existe (para cambiarlo se usa
 *                                    `PUT /api/portal/formularios/:id`).
 *
 * Solo FORMADORES del portal (`PORTAL_TH_FORMADORES`), los mismos que crean
 * cursos y materiales. La definición no trae datos personales.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede ver los formularios.' }, { status: 403 });
  }
  try {
    const lista = await prisma.portalFormulario.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, codigo: true, titulo: true, version_actual: true, updated_at: true, _count: { select: { materiales: true } } },
    });
    return NextResponse.json(
      {
        formularios: lista.map((f) => ({
          id: f.id,
          codigo: f.codigo,
          titulo: f.titulo,
          version: f.version_actual,
          actualizadoEl: f.updated_at,
          materiales: f._count.materiales,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    registrarErrorSinDatos('GET /api/portal/formularios', error);
    return NextResponse.json({ error: 'No se pudieron cargar los formularios.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede crear formularios.' }, { status: 403 });
  }
  const crudo = await request.text().catch(() => '');
  if (Buffer.byteLength(crudo, 'utf8') > MAX_BYTES_DEFINICION) {
    return NextResponse.json({ error: 'La definición es demasiado grande.' }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: 'El archivo no es un JSON válido.', errores: ['JSON mal formado.'] }, { status: 400 });
  }
  const r = validarDefinicion(json);
  if (!r.ok) return NextResponse.json({ error: 'La definición del formulario no es válida.', errores: r.errores }, { status: 400 });
  try {
    const f = await crearFormulario(r.definicion, quien.correo);
    return NextResponse.json({ ok: true, formulario: { id: f.id, codigo: f.codigo, titulo: f.titulo, version: f.version_actual } });
  } catch (error) {
    if (error instanceof CodigoDeFormularioRepetido || (error as { code?: string })?.code === 'P2002') {
      return NextResponse.json(
        { error: `Ya existe un formulario con el código ${r.definicion.codigo}. Para cambiarlo, edítelo (crea una versión nueva).` },
        { status: 409 }
      );
    }
    registrarErrorSinDatos('POST /api/portal/formularios', error);
    return NextResponse.json({ error: 'No se pudo crear el formulario.' }, { status: 500 });
  }
}
