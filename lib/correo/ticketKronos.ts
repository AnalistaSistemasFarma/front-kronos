import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { HELP_DESK_TECHNICIAN_SUBPROCESS_ID, isHelpDeskTechnician, listHelpDeskTechnicians } from '../help-desk/technicians';
import type { CasoNuevo, CatalogoTicket, ClasificacionTicket } from './ticket';

/**
 * Consultas de mesa de ayuda para «Crear ticket» desde el Correo (mssql, como el resto de
 * ese módulo). El INSERT es el MISMO de app/api/help-desk/create_ticket ([case] + category_case
 * en una transacción, estado 1 = abierto), más el correo de contacto del remitente.
 */

/** «De TI» = técnico del roster de mesa de ayuda (subproceso 1): el mismo criterio del tablero de tickets. */
export const esTecnicoTI = isHelpDeskTechnician;

export async function catalogoTicket(): Promise<CatalogoTicket> {
  const [listas, tecnicos] = await Promise.all([
    withMssqlPool(async (pool) => {
      const [c, d] = await Promise.all([
        pool.request().query<{ id_category: number; category: string }>('SELECT id_category, category FROM category ORDER BY category ASC'),
        pool.request().query<{ id_department: number; department: string }>('SELECT id_department, department FROM department ORDER BY department ASC'),
      ]);
      return {
        categorias: c.recordset.map((x) => ({ id: x.id_category, nombre: x.category })),
        departamentos: d.recordset.map((x) => ({ id: x.id_department, nombre: x.department })),
      };
    }),
    listHelpDeskTechnicians(),
  ]);
  return { ...listas, tecnicos: tecnicos.map((t) => ({ id: t.id_subprocess_user_company, nombre: t.name, correo: (t.email ?? '').toLowerCase() })) };
}

/** null si la clasificación es coherente (subcategoría de la categoría, actividad de la subcategoría, técnico del roster); si no, el motivo. */
export async function validarClasificacion(c: ClasificacionTicket): Promise<string | null> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('cat', sql.Int, c.categoria)
      .input('sub', sql.Int, c.subcategoria)
      .input('act', sql.Int, c.actividad)
      .input('dep', sql.Int, c.departamento)
      .input('tec', sql.Int, c.tecnico)
      .input('subproceso', sql.Int, HELP_DESK_TECHNICIAN_SUBPROCESS_ID)
      .query<{ sub: number; act: number; dep: number; tec: number }>(`
        SELECT
          (SELECT COUNT(1) FROM subcategory WHERE id_subcategory = @sub AND id_category = @cat) AS sub,
          (SELECT COUNT(1) FROM activity WHERE id_activity = @act AND id_subcategory = @sub) AS act,
          (SELECT COUNT(1) FROM department WHERE id_department = @dep) AS dep,
          (SELECT COUNT(1) FROM subprocess_user_company WHERE id_subprocess_user_company = @tec AND id_subprocess = @subproceso) AS tec
      `);
    const x = r.recordset[0];
    if (!x?.sub) return 'La subcategoría no pertenece a la categoría elegida.';
    if (!x.act) return 'La actividad no pertenece a la subcategoría elegida.';
    if (!x.dep) return 'El departamento no existe.';
    if (c.tecnico != null && !x.tec) return 'El técnico elegido no es de la mesa de ayuda.';
    return null;
  });
}

/** id_company_user de la persona en la empresa (es lo que guarda [case].requester), o null. */
export async function companyUserDe(idUser: string, idCompany: number): Promise<number | null> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('user', sql.NVarChar(255), idUser)
      .input('company', sql.Int, idCompany)
      .query<{ id_company_user: number }>('SELECT TOP 1 id_company_user FROM company_user WHERE id_user = @user AND id_company = @company ORDER BY id_company_user');
    return r.recordset[0]?.id_company_user ?? null;
  });
}

export async function casoExiste(idCase: number): Promise<boolean> {
  if (!Number.isInteger(idCase) || idCase <= 0) return false;
  return withMssqlPool(async (pool) => {
    const r = await pool.request().input('id', sql.Int, idCase).query<{ n: number }>('SELECT COUNT(1) AS n FROM [case] WHERE id_case = @id');
    return (r.recordset[0]?.n ?? 0) > 0;
  });
}

/** Inserta el ticket (mismas columnas y transacción de create_ticket) y devuelve su id_case. */
export async function crearCaso(p: CasoNuevo): Promise<number> {
  return withMssqlPool(async (pool) => {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const r = await new sql.Request(tx)
        .input('description', sql.Text, p.descripcion)
        .input('asunto', sql.NVarChar(1000), p.asunto)
        .input('creation_date', sql.Date, new Date().toISOString().split('T')[0])
        .input('technician', sql.Int, p.tecnico)
        .input('requester', sql.Int, p.requester)
        .input('site', sql.NVarChar(1000), p.sitio)
        .input('department', sql.Int, p.departamento)
        .input('requestType', sql.NVarChar(50), p.tipo)
        .input('priority', sql.NVarChar(1000), p.prioridad)
        .input('company', sql.Int, p.idCompany)
        .input('email', sql.NVarChar(1000), p.correoContacto)
        .query<{ id_case: number }>(`
          INSERT INTO [case] ([description], subject_case, creation_date, id_technical, requester, place, id_department, case_type, [priority], company, id_status_case, email)
          OUTPUT INSERTED.id_case
          VALUES (@description, @asunto, @creation_date, @technician, @requester, @site, @department, @requestType, @priority, @company, 1, @email);
        `);
      const idCase = r.recordset[0].id_case;
      await new sql.Request(tx)
        .input('id_case', sql.Int, idCase)
        .input('id_category', sql.Int, p.categoria)
        .input('id_subcategory', sql.Int, p.subcategoria)
        .input('id_activity', sql.Int, p.actividad)
        .query('INSERT INTO category_case (id_case, id_category, id_subcategory, id_activity) VALUES (@id_case, @id_category, @id_subcategory, @id_activity);');
      await tx.commit();
      return idCase;
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        /* el error original es el que importa */
      }
      throw e;
    }
  });
}
