import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';

/**
 * Agentes de los que la persona es RESPONSABLE según la hoja de vida
 * (dbo.agent_profile.owner_email).
 *
 * SQL directo, sin el modelo Prisma `agentProfile`, a propósito: la hoja de
 * vida de agentes (#494) todavía no está en producción y KRONOSDB no tiene la
 * tabla. Si la tabla no existe se devuelve un conjunto vacío, y entonces solo
 * los administradores pueden cambiar el avatar de los asistentes. Donde la
 * tabla sí existe (pruebas) se conserva la regla de siempre: responsable o
 * administrador.
 */

/** Error 208 de SQL Server: el objeto no existe. */
function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { number?: number }).number === 208;
}

export async function readAgentOwnerIds(email: string, agentIds: number[]): Promise<Set<number>> {
  const propios = new Set<number>();
  const correo = email.trim();
  const ids = agentIds.filter((id) => Number.isInteger(id)).slice(0, 500);
  if (!correo || ids.length === 0) return propios;

  try {
    const filas = await withMssqlPool(async (pool) => {
      const existe = await pool
        .request()
        .query("SELECT OBJECT_ID(N'dbo.agent_profile', N'U') AS oid");
      const oid = (existe.recordset[0] as { oid: number | null } | undefined)?.oid ?? null;
      if (oid === null) return [];

      const req = pool.request().input('owner_email', sql.NVarChar(255), correo);
      const marcas = ids.map((id, i) => {
        req.input(`id${i}`, sql.Int, id);
        return `@id${i}`;
      });
      const r = await req.query(
        `SELECT id_agent FROM dbo.agent_profile
         WHERE owner_email = @owner_email AND id_agent IN (${marcas.join(', ')})`
      );
      return r.recordset as Array<{ id_agent: number }>;
    });
    for (const f of filas) propios.add(Number(f.id_agent));
  } catch (error) {
    // Carrera: la tabla desapareció entre la verificación y la consulta.
    if (!isMissingTableError(error)) throw error;
  }
  return propios;
}
