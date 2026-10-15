import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { isFirmaRequestCategoryOrProcess } from '../orion/access';
import type { ProcesoOpcion } from './rules';

/**
 * Consultas a las tablas de Solicitudes Generales (mssql, como el resto de ese
 * módulo): procesos por empresa, responsables, acceso a una solicitud y notas.
 */

export interface ProcesoEmpresa extends ProcesoOpcion {
  categoria: string;
  responsables: string[];
}

/** Procesos ACTIVOS de la empresa (por sus categorías activas), con los responsables de sus tareas. */
export async function procesosEmpresa(idCompany: number): Promise<ProcesoEmpresa[]> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('company', sql.Int, idCompany)
      .query<{ id: number; process: string; description: string | null; category: string }>(`
        SELECT DISTINCT pc.id, pc.process, pc.description, cr.category
        FROM process_category pc
        INNER JOIN category_request cr ON cr.id = pc.id_category_request
        INNER JOIN company_category_request ccr ON ccr.id_category_request = cr.id
        WHERE ccr.id_company = @company AND pc.active = 1 AND cr.active = 1
        ORDER BY cr.category, pc.process
      `);
    const procesos = r.recordset.filter((p) => !isFirmaRequestCategoryOrProcess(p.category, p.process));
    if (procesos.length === 0) return [];
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
    return procesos.map((p) => ({
      id: p.id,
      nombre: p.process,
      descripcion: p.description,
      categoria: p.category,
      responsables: porProceso.get(p.id) ?? [],
    }));
  });
}

/** ¿El proceso está activo y pertenece a la empresa? */
export async function procesoEnEmpresa(idProcess: number, idCompany: number): Promise<boolean> {
  const lista = await procesosEmpresa(idCompany);
  return lista.some((p) => p.id === idProcess);
}

export interface SolicitudVisible {
  id: number;
  asunto: string;
  idCompany: number;
  estado: number;
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
      .query<{ id: number; subject_request: string; id_company: number; status_req: number }>(`
        SELECT TOP 1 rg.id, rg.subject_request, rg.id_company, rg.status_req
        FROM requests_general rg
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
    return x ? { id: x.id, asunto: x.subject_request, idCompany: x.id_company, estado: x.status_req } : null;
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
