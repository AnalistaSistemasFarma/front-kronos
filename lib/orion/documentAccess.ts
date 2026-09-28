import sql from 'mssql';
import { ORION_DOCUMENTS_URL, ORION_FIRMA_TRACE_URL } from './access';
import { getOrionDocumentFromBag } from './formValue';
import { loadOrionFormBag, resolveOrionActorUserId, userCanManageOrionRequest } from './service';

type SqlPool = import('mssql').ConnectionPool;

/** Empresas donde el usuario tiene el permiso "Documentos firmados". */
export async function listOrionDocumentViewerCompanies(
  pool: SqlPool,
  userId: string
): Promise<number[]> {
  return listCompaniesWithSubprocessUrl(pool, userId, ORION_DOCUMENTS_URL);
}

/** Empresas donde el usuario tiene "Ver trazabilidad de documentos". */
export async function listOrionTraceCompanies(pool: SqlPool, userId: string): Promise<number[]> {
  return listCompaniesWithSubprocessUrl(pool, userId, ORION_FIRMA_TRACE_URL);
}

async function listCompaniesWithSubprocessUrl(
  pool: SqlPool,
  userId: string,
  url: string
): Promise<number[]> {
  if (!userId) return [];
  const result = await pool
    .request()
    .input('id_user', sql.NVarChar(255), userId)
    .input('url', sql.NVarChar(255), url)
    .query(`
      SELECT DISTINCT cu.id_company
      FROM subprocess_user_company suc
      INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      INNER JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
      WHERE cu.id_user = @id_user
        AND LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, N'')))) = LOWER(@url)
    `);
  return result.recordset
    .map((row) => Number(row.id_company))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Puede ver un documento (hoja de vida / PDF): preparador, firmante, validador,
 * o quien tenga "Documentos firmados" en la empresa de la solicitud.
 */
export async function userCanViewOrionDocument(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    userId: string | null;
    userEmail: string;
    isAdmin: boolean;
  }
): Promise<boolean> {
  if (params.isAdmin) return true;
  const me = params.userEmail.trim().toLowerCase();
  const actorId = await resolveOrionActorUserId(pool, {
    userId: params.userId,
    email: params.userEmail,
  });
  if (actorId && (await userCanManageOrionRequest(pool, params.requestId, actorId, false))) {
    return true;
  }

  const loaded = await loadOrionFormBag(pool, params.requestId);
  if (loaded) {
    const doc = getOrionDocumentFromBag(loaded.bag, params.fileId);
    const involved = [
      ...(doc.signers ?? []).map((s) => s.email),
      ...(doc.review?.approvals ?? []).map((a) => a.email),
    ].some((email) => String(email || '').trim().toLowerCase() === me);
    if (involved) return true;
  }

  if (!actorId) return false;
  const companies = await listOrionDocumentViewerCompanies(pool, actorId);
  if (companies.length === 0) return false;
  const company = await pool
    .request()
    .input('id', sql.Int, params.requestId)
    .query(`SELECT TOP 1 id_company FROM requests_general WHERE id = @id`);
  return companies.includes(Number(company.recordset[0]?.id_company));
}
