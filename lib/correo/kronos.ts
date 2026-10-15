import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { catalogoCreacionEmpresa, type CategoriaCreacion } from '../requests-general/catalogoCreacion';
import type { ProcesoOpcion } from './rules';

/**
 * Consultas a las tablas de Solicitudes Generales (mssql, como el resto de ese
 * módulo): catálogo de creación por empresa, responsables, acceso a una solicitud y notas.
 */

export interface ProcesoEmpresa extends ProcesoOpcion {
  idCategoria: number;
  categoria: string;
  responsables: string[];
}

export interface CatalogoEmpresa {
  categorias: CategoriaCreacion[];
  procesos: ProcesoEmpresa[];
}

/**
 * Categorías y procesos en los que se puede crear una solicitud en la empresa: la
 * MISMA regla y consultas de «Nueva solicitud» (lib/requests-general/catalogoCreacion),
 * más los responsables de las tareas de cada proceso (para mostrar a quién llega).
 */
export async function catalogoEmpresa(idCompany: number): Promise<CatalogoEmpresa> {
  return withMssqlPool(async (pool) => {
    const { categorias, procesos } = await catalogoCreacionEmpresa(pool, idCompany);
    if (procesos.length === 0) return { categorias, procesos: [] };
    const resp = await pool.request().query<{ id_process_category: number; name: string }>(`
      SELECT DISTINCT tpc.id_process_category, COALESCE(NULLIF(LTRIM(RTRIM(u.name)), N''), u.email) AS name
      FROM task_process_category tpc
      INNER JOIN user_task_request_general utrg ON utrg.id_task = tpc.id
      INNER JOIN [user] u ON u.id = utrg.id_user
      WHERE tpc.active = 1 AND tpc.id_process_category IN (${procesos.map((p) => Number(p.id)).join(',')})
    `);
    const porProceso = new Map<number, string[]>();
    for (const x of resp.recordset) {
      const l = porProceso.get(x.id_process_category) ?? [];
      if (l.length < 5) l.push(x.name);
      porProceso.set(x.id_process_category, l);
    }
    return { categorias, procesos: procesos.map((p) => ({ ...p, responsables: porProceso.get(p.id) ?? [] })) };
  });
}

export interface SolicitudVisible {
  id: number;
  asunto: string;
  idCompany: number;
  estado: number;
  /** Datos para la tarjeta del acuse (opcionales: el acuse sale aunque falten). */
  empresa?: string | null;
  categoria?: string | null;
  proceso?: string | null;
  creada?: Date | string | null;
  responsable?: string | null;
}

/**
 * La solicitud si el usuario participa en ella (solicitante, responsable de una tarea o
 * responsable del proceso); si no, null. Se usa al vincular un hilo a una solicitud
 * existente y al agregar notas (anti-IDOR).
 */
export async function solicitudVisible(idUser: string, idRequest: number): Promise<SolicitudVisible | null> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('id', sql.Int, idRequest)
      .input('user', sql.NVarChar(255), idUser)
      .query<{
        id: number;
        subject_request: string;
        id_company: number;
        status_req: number;
        company: string | null;
        category: string | null;
        process: string | null;
        created_at: Date | null;
        responsables: string | null;
      }>(`
        SELECT TOP 1 rg.id, rg.subject_request, rg.id_company, rg.status_req, rg.created_at,
          c.company, cr.category, pc.process, resp.responsables
        FROM requests_general rg
        LEFT JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
        LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
        LEFT JOIN category_request cr ON cr.id = pc.id_category_request
        OUTER APPLY (
          SELECT STUFF((
            SELECT ', ' + up.name
            FROM user_process_category_request_general upcrg
            INNER JOIN [user] up ON up.id = upcrg.id_user
            WHERE upcrg.id_process_category = pc.id
            FOR XML PATH(''), TYPE
          ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS responsables
        ) resp
        WHERE rg.id = @id AND (
          rg.id_requester = @user
          OR EXISTS (SELECT 1 FROM task_request_general t WHERE t.id_request_general = rg.id AND t.id_assigned = @user)
          OR EXISTS (
            SELECT 1 FROM process_category_request_general pcr
            INNER JOIN user_process_category_request_general up ON up.id_process_category = pcr.id_process_category
            WHERE pcr.id_request_general = rg.id AND up.id_user = @user
          )
        )
      `);
    const x = r.recordset[0];
    return x
      ? {
          id: x.id,
          asunto: x.subject_request,
          idCompany: x.id_company,
          estado: x.status_req,
          empresa: x.company,
          categoria: x.category,
          proceso: x.process,
          creada: x.created_at,
          responsable: x.responsables,
        }
      : null;
  });
}

/** Agrega una nota a la solicitud (misma tabla que la vista de la solicitud). */
export async function insertarNota(idRequest: number, nota: string, idUser: string): Promise<number> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('note', sql.NVarChar(sql.MAX), nota)
      .input('id_request', sql.Int, idRequest)
      .input('created_by', sql.NVarChar(255), idUser)
      .query<{ id_note: number }>(`
        INSERT INTO notes (note, id_request, created_by)
        OUTPUT INSERTED.id_note
        VALUES (@note, @id_request, @created_by);
      `);
    return r.recordset[0]?.id_note ?? 0;
  });
}
