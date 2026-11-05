import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { esCorreo, normalizarCorreo, puedeAdministrarEmpresa } from '@/lib/formacion/reglas';
import { exigirAdminFormacion, SIN_CACHE } from '@/lib/formacion/sesion';

/**
 * MÓDULO FORMACIÓN — colaboradores por empresa y departamento (2026-10-26).
 *
 *   GET    /api/formacion/colaboradores?empresaId=N
 *   POST   /api/formacion/colaboradores   { empresaId, colaboradores: [{ correo, nombre?, departamentoId }] }
 *   DELETE /api/formacion/colaboradores   { empresaId, correo }
 *
 * Para quien no tiene el departamento en SynerLink (entra con código al
 * correo). El POST sirve para uno o para la carga masiva desde Excel.
 */
function empresaValida(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: NextRequest) {
  const r = await exigirAdminFormacion();
  if (!r.ok) return r.respuesta;
  const empresaId = empresaValida(request.nextUrl.searchParams.get('empresaId'));
  if (!empresaId || !puedeAdministrarEmpresa(r.ctx, empresaId)) {
    return NextResponse.json({ error: 'No tiene el permiso de Formación en esa empresa.' }, { status: 403, headers: SIN_CACHE });
  }
  try {
    const filas = await prisma.formacionColaborador.findMany({
      where: { id_company: empresaId },
      orderBy: [{ email: 'asc' }],
      select: { email: true, nombre: true, id_department: true, updated_at: true },
    });
    return NextResponse.json(
      {
        colaboradores: filas.map((f) => ({
          correo: f.email,
          nombre: f.nombre,
          departamentoId: f.id_department,
          actualizado: f.updated_at,
        })),
      },
      { headers: SIN_CACHE }
    );
  } catch (error) {
    console.error('[formacion] GET /api/formacion/colaboradores', error);
    return NextResponse.json({ error: 'No se pudieron cargar los colaboradores.' }, { status: 502, headers: SIN_CACHE });
  }
}

export async function POST(request: NextRequest) {
  const r = await exigirAdminFormacion();
  if (!r.ok) return r.respuesta;
  const body = await request.json().catch(() => null);
  const empresaId = empresaValida(body?.empresaId);
  if (!empresaId || !puedeAdministrarEmpresa(r.ctx, empresaId)) {
    return NextResponse.json({ error: 'No tiene el permiso de Formación en esa empresa.' }, { status: 403, headers: SIN_CACHE });
  }
  const lista: unknown[] = Array.isArray(body?.colaboradores) ? body.colaboradores : [];
  if (lista.length === 0 || lista.length > 2000) {
    return NextResponse.json({ error: 'Envíe entre 1 y 2000 colaboradores.' }, { status: 400, headers: SIN_CACHE });
  }
  const departamentos = new Set(
    (await prisma.department.findMany({ select: { id_department: true } })).map((d) => d.id_department)
  );
  const errores: string[] = [];
  const validos: Array<{ email: string; nombre: string | null; dep: number }> = [];
  lista.forEach((x, i) => {
    const c = x as { correo?: unknown; nombre?: unknown; departamentoId?: unknown };
    const correo = typeof c.correo === 'string' ? normalizarCorreo(c.correo) : '';
    const dep = Number(c.departamentoId);
    if (!esCorreo(correo)) return void errores.push(`Fila ${i + 1}: correo no válido.`);
    if (!departamentos.has(dep)) return void errores.push(`Fila ${i + 1}: departamento no válido.`);
    const nombre = typeof c.nombre === 'string' && c.nombre.trim() ? c.nombre.trim().slice(0, 255) : null;
    validos.push({ email: correo, nombre, dep });
  });
  try {
    for (const v of validos) {
      await prisma.formacionColaborador.upsert({
        where: { email_id_company: { email: v.email, id_company: empresaId } },
        update: { id_department: v.dep, nombre: v.nombre ?? undefined, updated_by: r.correo, updated_at: new Date() },
        create: { email: v.email, nombre: v.nombre, id_company: empresaId, id_department: v.dep, updated_by: r.correo },
      });
    }
    return NextResponse.json({ ok: true, guardados: validos.length, errores }, { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] POST /api/formacion/colaboradores', error);
    return NextResponse.json({ error: 'No se pudieron guardar los colaboradores.' }, { status: 500, headers: SIN_CACHE });
  }
}

export async function DELETE(request: NextRequest) {
  const r = await exigirAdminFormacion();
  if (!r.ok) return r.respuesta;
  const body = await request.json().catch(() => null);
  const empresaId = empresaValida(body?.empresaId);
  const correo = typeof body?.correo === 'string' ? normalizarCorreo(body.correo) : '';
  if (!empresaId || !puedeAdministrarEmpresa(r.ctx, empresaId)) {
    return NextResponse.json({ error: 'No tiene el permiso de Formación en esa empresa.' }, { status: 403, headers: SIN_CACHE });
  }
  try {
    await prisma.formacionColaborador.deleteMany({ where: { id_company: empresaId, email: correo } });
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] DELETE /api/formacion/colaboradores', error);
    return NextResponse.json({ error: 'No se pudo quitar el colaborador.' }, { status: 500, headers: SIN_CACHE });
  }
}
