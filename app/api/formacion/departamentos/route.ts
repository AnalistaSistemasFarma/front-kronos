import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { puedeAdministrarEmpresa } from '@/lib/formacion/reglas';
import { exigirAdminFormacion, SIN_CACHE } from '@/lib/formacion/sesion';

/**
 * MÓDULO FORMACIÓN — departamentos de SynerLink que aplican en una empresa (2026-10-26).
 *
 *   PUT /api/formacion/departamentos   { empresaId, departamentos: [{ id, activo }] }
 *
 * Guarda (upsert) cada departamento de la lista para esa empresa. Solo quien
 * tiene el permiso de Formación en esa empresa (o en GSS).
 */
export async function PUT(request: NextRequest) {
  const r = await exigirAdminFormacion();
  if (!r.ok) return r.respuesta;
  const body = await request.json().catch(() => null);
  const empresaId = Number(body?.empresaId);
  const lista: unknown[] = Array.isArray(body?.departamentos) ? body.departamentos : [];
  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    return NextResponse.json({ error: 'Empresa no válida.' }, { status: 400, headers: SIN_CACHE });
  }
  if (!puedeAdministrarEmpresa(r.ctx, empresaId)) {
    return NextResponse.json({ error: 'No tiene el permiso de Formación en esa empresa.' }, { status: 403, headers: SIN_CACHE });
  }
  const filas = lista
    .map((x) => x as { id?: unknown; activo?: unknown })
    .filter((x) => Number.isInteger(x.id) && (x.id as number) > 0)
    .map((x) => ({ id: x.id as number, activo: x.activo !== false }));
  if (filas.length === 0 || filas.length > 500) {
    return NextResponse.json({ error: 'Lista de departamentos no válida.' }, { status: 400, headers: SIN_CACHE });
  }
  try {
    await prisma.$transaction(
      filas.map((f) =>
        prisma.formacionEmpresaDepartamento.upsert({
          where: { id_company_id_department: { id_company: empresaId, id_department: f.id } },
          update: { activo: f.activo, updated_by: r.correo, updated_at: new Date() },
          create: { id_company: empresaId, id_department: f.id, activo: f.activo, updated_by: r.correo },
        })
      )
    );
    return NextResponse.json({ ok: true, guardados: filas.length }, { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] PUT /api/formacion/departamentos', error);
    return NextResponse.json({ error: 'No se pudieron guardar los departamentos.' }, { status: 500, headers: SIN_CACHE });
  }
}
