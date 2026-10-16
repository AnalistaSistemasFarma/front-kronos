import type { CategoriaCorreo, ProcesoCorreo } from './correoClient';

/**
 * Opciones de la cascada Categoría → Proceso de la simulación del Correo, igual
 * que en «Nueva solicitud»: primero la categoría de la empresa y luego los
 * procesos activos de esa categoría (etiqueta «proceso - descripción»).
 */

export type Opcion = { value: string; label: string };

export function etiquetaProceso(p: Pick<ProcesoCorreo, 'nombre' | 'descripcion'>): string {
  return p.descripcion ? `${p.nombre} - ${p.descripcion}` : p.nombre;
}

export function opcionesCategorias(categorias: CategoriaCorreo[]): Opcion[] {
  return categorias.map((c) => ({ value: String(c.id), label: c.categoria }));
}

export function opcionesProcesos(procesos: ProcesoCorreo[], idCategoria: number | null): Opcion[] {
  if (!idCategoria) return [];
  return procesos.filter((p) => p.idCategoria === idCategoria).map((p) => ({ value: String(p.id), label: etiquetaProceso(p) }));
}

/** Todos los procesos agrupados por categoría (selector «Proceso por defecto»). */
export function opcionesProcesosAgrupadas(categorias: CategoriaCorreo[], procesos: ProcesoCorreo[]): Array<{ group: string; items: Opcion[] }> {
  return categorias
    .map((c) => ({ group: c.categoria, items: opcionesProcesos(procesos, c.id) }))
    .filter((g) => g.items.length > 0);
}

export function categoriaDeProceso(procesos: ProcesoCorreo[], idProcess: number | null): number | null {
  if (!idProcess) return null;
  return procesos.find((p) => p.id === idProcess)?.idCategoria ?? null;
}
