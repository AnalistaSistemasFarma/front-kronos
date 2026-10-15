import { sql } from '../mssqlPool';
import { isFirmaRequestCategoryOrProcess } from '../orion/access';

/**
 * Catálogo de «Nueva solicitud» (create-request): qué categorías y procesos se
 * ofrecen al crear una solicitud en una empresa. Es la MISMA regla de la pantalla
 * normal, compartida con /api/requests-general/consult-request (que usa estas
 * consultas) y con el módulo Correo (que usa catalogoCreacionEmpresa):
 *
 *  - categorías: las de la empresa (company_category_request) con cr.active = 1;
 *  - procesos: pc.active = 1 de esas categorías;
 *  - se oculta solo el leftover técnico Orion (FIRMA / Firma digital).
 */

/** Categorías activas por empresa. Quien la usa agrega filtros (`AND ...`) y el ORDER BY. */
export const SQL_CATEGORIAS_CREACION = `
      SELECT
        c.id_company, cr.id, c.company, cr.category
      FROM company_category_request ccr
      INNER JOIN company c
        ON c.id_company = ccr.id_company
      INNER JOIN category_request cr
        ON cr.id = ccr.id_category_request
      WHERE cr.active = 1
    `;

/** Todos los procesos con su categoría (la pantalla filtra active = 1 y la categoría elegida). */
export const SQL_PROCESOS_CREACION = `
      SELECT
        pc.id as id_process,
        pc.process,
        pc.id_category_request,
        cr.category,
        u.email,
        pc.description,
        pc.active
      FROM process_category pc
      INNER JOIN category_request cr
        ON cr.id = pc.id_category_request
      LEFT JOIN [user] u
        ON u.id = pc.assigned
      ORDER BY pc.process
    `;

export interface CategoriaCreacion {
  id: number;
  categoria: string;
}

export interface ProcesoCreacion {
  id: number;
  nombre: string;
  descripcion: string | null;
  idCategoria: number;
  categoria: string;
}

export interface CatalogoCreacion {
  categorias: CategoriaCreacion[];
  procesos: ProcesoCreacion[];
}

export interface FilaCategoria {
  id: number;
  category: string;
}
export interface FilaProceso {
  id_process: number;
  process: string;
  id_category_request: number;
  category: string;
  description: string | null;
  active: number | boolean | null;
}

/** Regla pura: lo que la pantalla normal deja elegir en la empresa (sin base). */
export function armarCatalogo(categoriasEmpresa: FilaCategoria[], procesos: FilaProceso[]): CatalogoCreacion {
  const categorias = new Map<number, CategoriaCreacion>();
  for (const c of categoriasEmpresa) {
    if (isFirmaRequestCategoryOrProcess(c.category, null)) continue;
    if (!categorias.has(c.id)) categorias.set(c.id, { id: c.id, categoria: c.category });
  }
  const lista: ProcesoCreacion[] = [];
  for (const p of procesos) {
    if (Number(p.active) !== 1) continue;
    const cat = categorias.get(p.id_category_request);
    if (!cat) continue;
    if (isFirmaRequestCategoryOrProcess(p.category, p.process)) continue;
    lista.push({ id: p.id_process, nombre: p.process, descripcion: p.description ?? null, idCategoria: cat.id, categoria: cat.categoria });
  }
  const orden = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
  return {
    categorias: [...categorias.values()].sort((a, b) => orden(a.categoria, b.categoria)),
    procesos: lista.sort((a, b) => orden(a.categoria, b.categoria) || orden(a.nombre, b.nombre)),
  };
}

/** Categorías y procesos que la pantalla «Nueva solicitud» ofrece en la empresa. */
export async function catalogoCreacionEmpresa(pool: sql.ConnectionPool, idCompany: number): Promise<CatalogoCreacion> {
  const [cats, procs] = await Promise.all([
    pool.request().input('companyId', sql.Int, idCompany).query<FilaCategoria>(`${SQL_CATEGORIAS_CREACION} AND c.id_company = @companyId ORDER BY cr.category`),
    pool.request().query<FilaProceso>(SQL_PROCESOS_CREACION),
  ]);
  return armarCatalogo(cats.recordset, procs.recordset);
}
