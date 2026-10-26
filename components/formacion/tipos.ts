/** MÓDULO FORMACIÓN — tipos compartidos por las pantallas (2026-10-26). */
export interface Opcion {
  id: number;
  nombre: string;
}

export interface ContextoFormacion {
  esGlobal: boolean;
  empresas: Opcion[];
  departamentos: Opcion[];
  empresaDepartamentos: Array<{ empresaId: number; departamentoId: number; activo: boolean }>;
}

export interface CursoModulo {
  id: number;
  titulo: string;
  descripcion: string | null;
  activo: boolean;
  creadoPor: string;
  creadoEl: string;
  empresaId: number | null;
  empresa: string | null;
  alcance: 'todas' | 'definido';
  alcancesActivos: number;
  totalMateriales: number;
  totalInscritos: number;
}

export async function leerJsonSeguro(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Departamentos que aplican en una empresa: los configurados; si no hay ninguno, todos los de SynerLink. */
export function departamentosDeEmpresa(ctx: ContextoFormacion, empresaId: number): Opcion[] {
  const activos = new Set(
    ctx.empresaDepartamentos.filter((d) => d.empresaId === empresaId && d.activo).map((d) => d.departamentoId)
  );
  const configurados = ctx.empresaDepartamentos.some((d) => d.empresaId === empresaId);
  return configurados ? ctx.departamentos.filter((d) => activos.has(d.id)) : ctx.departamentos;
}
