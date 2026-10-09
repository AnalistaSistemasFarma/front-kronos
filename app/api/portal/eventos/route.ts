import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { identificar } from '../../../../lib/portal/acceso';
import { editoresDeBanners } from '../../../../lib/portal/config';
import { MAX_EVENTOS_POR_DIA, desdeIso, fechaValida, validarEvento } from '../../../../lib/portal/calendario';

/**
 * PORTAL TH — EVENTOS DE LA EMPRESA del calendario (Cristian Baldión, 2026-10-09).
 *
 *   GET  /api/portal/eventos?desde=AAAA-MM-DD&hasta=AAAA-MM-DD  — los eventos de un rango (máx. 70 días).
 *   POST /api/portal/eventos   { fecha, titulo, descripcion? }   — crea uno.
 *
 * VER lo puede cualquiera que entre al portal; CREAR y BORRAR, solo los editores del portal (los mismos que
 * cargan anuncios: `editoresDeBanners`). Son dos permisos distintos a propósito. Los festivos y las fechas
 * importantes no pasan por aquí: se calculan en el navegador (`lib/portal/calendario.ts`).
 */
const SIN_CACHE = { 'Cache-Control': 'no-store' };
const MAX_DIAS_RANGO = 70;

export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const desde = request.nextUrl.searchParams.get('desde');
  const hasta = request.nextUrl.searchParams.get('hasta');
  if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde) {
    return NextResponse.json({ error: 'El rango de fechas no es válido.' }, { status: 400 });
  }
  const dias = (desdeIso(hasta).getTime() - desdeIso(desde).getTime()) / 86_400_000;
  if (dias > MAX_DIAS_RANGO) return NextResponse.json({ error: `El rango admite máximo ${MAX_DIAS_RANGO} días.` }, { status: 400 });

  try {
    const filas = await prisma.portalEvento.findMany({
      where: { eliminado_at: null, fecha: { gte: desdeIso(desde), lte: desdeIso(hasta) } },
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
      select: { id: true, fecha: true, titulo: true, descripcion: true },
    });
    return NextResponse.json(
      {
        eventos: filas.map((e) => ({ id: e.id, fecha: e.fecha.toISOString().slice(0, 10), titulo: e.titulo, descripcion: e.descripcion, tipo: 'empresa' })),
        puedeEditar: editoresDeBanners().includes(quien.correo.toLowerCase()),
      },
      { headers: SIN_CACHE }
    );
  } catch (error) {
    console.error('[portal] GET /api/portal/eventos:', (error as Error).name);
    return NextResponse.json({ error: 'No se pudieron cargar los eventos.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!editoresDeBanners().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo Talento Humano puede agregar eventos.' }, { status: 403 });
  }
  let cuerpo: unknown = null;
  try {
    cuerpo = JSON.parse(await request.text());
  } catch {
    cuerpo = null;
  }
  const v = validarEvento(cuerpo);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  try {
    const ese = await prisma.portalEvento.count({ where: { eliminado_at: null, fecha: desdeIso(v.fecha) } });
    if (ese >= MAX_EVENTOS_POR_DIA) return NextResponse.json({ error: `Ese día ya tiene ${MAX_EVENTOS_POR_DIA} eventos.` }, { status: 409 });
    const creado = await prisma.portalEvento.create({
      data: { fecha: desdeIso(v.fecha), titulo: v.titulo, descripcion: v.descripcion, created_by: quien.correo },
      select: { id: true, fecha: true, titulo: true, descripcion: true },
    });
    return NextResponse.json(
      { ok: true, evento: { id: creado.id, fecha: creado.fecha.toISOString().slice(0, 10), titulo: creado.titulo, descripcion: creado.descripcion, tipo: 'empresa' } },
      { status: 201, headers: SIN_CACHE }
    );
  } catch (error) {
    console.error('[portal] POST /api/portal/eventos:', (error as Error).name);
    return NextResponse.json({ error: 'No se pudo guardar el evento.' }, { status: 500 });
  }
}
