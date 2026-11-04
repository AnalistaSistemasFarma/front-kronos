import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { createGeneralRequest } from '../requests-general/createGeneralRequest';
import { fireAndForgetNotification } from '../notificationEvents';
import { runSapExecutors } from '../workflow-sap/engine';
import { withStep } from '../workflow-sap/executionLog';
import { offerSubject } from './offer';

/**
 * Pasa una oferta (cotización + borrador ya creados en SAP) al flujo «Oferta de venta»:
 * crea la solicitud, el enlace sales_authorization y arranca las Tareas SAP. Lo usan la
 * creación directa (interruptor «Enviar a autorización») y «Mis ofertas en borrador».
 */
export async function startOfferFlow(p: {
  companyId: number;
  userId: string;
  draft: { DocEntry: number; DocTotal?: number; CardCode?: string; CardName?: string; Comments?: string; DocumentLines?: { ItemDescription?: string; ItemCode?: string }[] };
  quotationDocEntry?: number | null;
  linesCount?: number;
}): Promise<{ ok: true; idRequest: number } | { ok: false; status: number; error: string }> {
  const pool = await sql.connect(sqlConfig);
  const cfg = await pool.request().input('c', sql.Int, p.companyId).query(
    `SELECT TOP 1 id_process_category_oferta AS p FROM dbo.sales_company_config WHERE id_company = @c AND activo = 1;`
  );
  const processId = Number(cfg.recordset[0]?.p ?? 0);
  if (!processId) return { ok: false, status: 422, error: 'La empresa no tiene configurado el flujo de oferta de venta.' };
  const live = await pool.request().input('c', sql.Int, p.companyId).input('d', sql.Int, p.draft.DocEntry).query(
    `SELECT TOP 1 1 AS x FROM dbo.sales_authorization WHERE id_company = @c AND doc_entry = @d AND status IN (N'pending', N'publishing', N'publish_error', N'approved');`
  );
  if (live.recordset.length) return { ok: false, status: 409, error: 'Esta oferta ya está en un flujo.' };

  const d = p.draft;
  const first = d.DocumentLines?.[0];
  const subject = offerSubject(d.CardName, d.CardCode, first?.ItemDescription ?? first?.ItemCode);
  const { id_request: idRequest } = await createGeneralRequest({
    company: p.companyId,
    subject,
    descripcion: `${String(d.Comments ?? '').slice(0, 800)}${d.DocTotal != null ? ` · Total ${Number(d.DocTotal).toLocaleString('es-CO')}` : ''}`.trim(),
    process: processId,
    createdby: p.userId,
    url: `/process/sales?companyId=${p.companyId}&docEntry=${d.DocEntry}`,
    formValues: [],
  });
  try {
    await pool
      .request()
      .input('c', sql.Int, p.companyId)
      .input('d', sql.Int, d.DocEntry)
      .input('r', sql.Int, idRequest)
      .input('u', sql.NVarChar(50), p.userId)
      .query(`INSERT INTO dbo.sales_authorization (id_company, doc_entry, id_request_general, etapa, status, created_by)
              VALUES (@c, @d, @r, N'oferta', N'pending', @u);`);
  } catch {
    await pool.request().input('id', sql.Int, idRequest).query(`UPDATE requests_general SET status_req = 3 WHERE id = @id;
      UPDATE task_request_general SET id_status = 3 WHERE id_request_general = @id AND id_status = 4;`);
    return { ok: false, status: 409, error: 'Esta oferta ya está en un flujo.' };
  }
  await pool.request().input('c', sql.Int, p.companyId).input('d', sql.Int, d.DocEntry).input('r', sql.Int, idRequest).query(
    `UPDATE dbo.sales_offer_draft SET status = N'enviado', id_request_general = @r, updated_at = sysutcdatetime() WHERE id_company = @c AND doc_entry = @d AND status = N'borrador';`
  ).catch(() => undefined);
  await withStep(
    { idRequest, stepKind: 'sap', stepName: 'Crear oferta en SAP', actionKey: 'sales.create_offer', triggerEvent: 'on_execute', triggeredBy: 'user', idUser: p.userId, idCompany: p.companyId, sapEntity: 'Quotations/Drafts', requestSummary: { cliente: d.CardCode, lineas: p.linesCount ?? d.DocumentLines?.length ?? null } },
    async () => d,
    () => ({ status: 'ok', sapDocEntry: d.DocEntry, responseSummary: { cotizacion: p.quotationDocEntry ?? null, borrador: d.DocEntry } })
  );
  fireAndForgetNotification(runSapExecutors(idRequest, 'user'));
  return { ok: true, idRequest };
}
