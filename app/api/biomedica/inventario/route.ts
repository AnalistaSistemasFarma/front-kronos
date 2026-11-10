import { prisma } from '../../../../lib/prisma';
import { crearEquipo, listEquipos, resumenInventario } from '../../../../lib/biomedica/inventario';
import { errorResponse, jsonNoStore, readJson } from '../../sgc/_lib/context';
import { biomedContext } from '../_acceso';

export const dynamic = 'force-dynamic';

/**
 * INVENTARIO DE EQUIPOS BIOMÉDICOS (fase 2, 2026-11-10).
 * GET ?company=&q=&estado=&cliente=&ciudad=&codigo=&page=&pageSize=[&resumen=1] — equipos (paginados) y,
 *   con resumen=1, el conteo por estado y las listas para los filtros.
 * POST { company, equipo, serie, … , justificacion? } — alta de UN equipo.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const p = url.searchParams;
    const c = await biomedContext(request, p.get('company'));
    if (c instanceof Response) return c;
    const filtro = { q: p.get('q'), estado: p.get('estado'), cliente: p.get('cliente'), ciudad: p.get('ciudad'), codigo: p.get('codigo'), page: p.get('page'), pageSize: p.get('pageSize') };
    const [lista, resumen] = await Promise.all([listEquipos(prisma, c.access, filtro), p.get('resumen') === '1' ? resumenInventario(prisma, c.access) : Promise.resolve(null)]);
    return jsonNoStore({ ...lista, ...(resumen ? { resumen } : {}) });
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario');
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    return jsonNoStore(await crearEquipo(prisma, c.access, body, c.actor), 201);
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:crear');
  }
}
