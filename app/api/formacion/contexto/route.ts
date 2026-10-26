import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { exigirAdminFormacion, SIN_CACHE } from '@/lib/formacion/sesion';

/**
 * MÓDULO FORMACIÓN — contexto de quien administra (2026-10-26).
 *
 *   GET /api/formacion/contexto
 *
 * Empresas donde tiene el permiso (GSS = todas), los departamentos de SynerLink
 * y cuáles aplican en cada empresa. Lo usa la pantalla del módulo para los
 * filtros, el alcance de cada curso y la administración de departamentos.
 */
export async function GET() {
  const r = await exigirAdminFormacion();
  if (!r.ok) return r.respuesta;
  try {
    const [empresas, departamentos, porEmpresa] = await Promise.all([
      prisma.company.findMany({ select: { id_company: true, company: true }, orderBy: { company: 'asc' } }),
      prisma.department.findMany({ select: { id_department: true, department: true }, orderBy: { department: 'asc' } }),
      prisma.formacionEmpresaDepartamento.findMany({ select: { id_company: true, id_department: true, activo: true } }),
    ]);
    const visibles = r.ctx.esGlobal ? empresas : empresas.filter((e) => r.ctx.empresas.includes(e.id_company));
    return NextResponse.json(
      {
        esGlobal: r.ctx.esGlobal,
        empresas: visibles.map((e) => ({ id: e.id_company, nombre: e.company.trim() })),
        departamentos: departamentos.map((d) => ({ id: d.id_department, nombre: d.department.trim() })),
        empresaDepartamentos: porEmpresa
          .filter((f) => r.ctx.esGlobal || r.ctx.empresas.includes(f.id_company))
          .map((f) => ({ empresaId: f.id_company, departamentoId: f.id_department, activo: f.activo })),
      },
      { headers: SIN_CACHE }
    );
  } catch (error) {
    console.error('[formacion] GET /api/formacion/contexto', error);
    return NextResponse.json({ error: 'No se pudo cargar la configuración de Formación.' }, { status: 502, headers: SIN_CACHE });
  }
}
