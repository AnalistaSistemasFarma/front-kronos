import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { companySap } from '../purchases/authorization';
import { sapGet, sapLogout, sapPatch, sapPost, SapError } from '../sap/serviceLayer';
import { createDraftOfferRequest } from './offerFlow';
import { normalizeState } from './states';

/**
 * Ciclo de rechazo de una oferta, como SAPSEND (variantes levantadas el 2026-11-09):
 *  - 'retomar': precio devuelto (NAP) o extracupo negado (NADC / NADA) → el borrador vuelve a B y queda como
 *    oferta en borrador con una solicitud nueva y abierta: se edita (cotización y borrador a la vez) y se
 *    reenvía a pedido. La solicitud rechazada queda como historial.
 *  - 'cancelar': cancela la cotización y cierra el borrador con el motivo (U_SEND_CanOfe, U_SEND_TraOrdCan).
 */
export const CANCEL_REASONS: Record<string, string> = {
  CCP: 'El cliente canceló el pedido',
  ECNA: 'El extracupo del cliente no está autorizado',
  EPNA: 'El precio de un artículo no está autorizado',
  LCNCB: 'La cantidad no coincide con el embalaje',
  NADP: 'No autoriza el despacho pendiente',
  CV: 'Cartera vencida',
  AOPC: 'Ajuste de la orden por parte del cliente',
  O: 'Otro',
};

const REJECTED = ['NAP', 'NADC', 'NADA'];
/** Se puede cancelar en borrador, devuelta o negada (como SAPSEND; las que están en autorización se rechazan desde la autorización). */
const CANCELLABLE = ['B', ...REJECTED];

const stamp = () => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());

/** Cotización de origen del borrador (BaseEntry de sus líneas con BaseType 23). PURA. */
export function quotationOf(lines: { BaseType?: number | null; BaseEntry?: number | null }[] | undefined): number | null {
  const l = (lines ?? []).find((x) => Number(x.BaseType) === 23 && x.BaseEntry != null);
  return l ? Number(l.BaseEntry) : null;
}

export type RejectionResult = { ok: true; idRequest?: number | null; detalle: string } | { ok: false; status: number; error: string };

export async function rejectionAction(p: {
  companyId: number;
  docEntry: number;
  /** Solicitud de la oferta (rechazada o en borrador) desde la que se actúa. */
  idRequest: number;
  userId: string;
  userName: string;
  accion: 'retomar' | 'cancelar';
  motivo?: string;
  comentario?: string;
}): Promise<RejectionResult> {
  const pool = await sql.connect(sqlConfig);
  const sap = await companySap(p.companyId);
  try {
    const draft = await sapGet<Record<string, unknown> & { DocumentLines?: { BaseType?: number; BaseEntry?: number; ItemCode?: string; ItemDescription?: string }[] }>(
      sap,
      `Drafts(${p.docEntry})?$select=DocEntry,CardCode,CardName,NumAtCard,DocTotal,Comments,U_SEND_State,DocumentStatus,DocumentLines`
    );
    const state = normalizeState(draft.U_SEND_State) ?? String(draft.U_SEND_State ?? '');
    if (draft.DocumentStatus !== 'bost_Open') return { ok: false, status: 409, error: 'El borrador ya está cerrado en SAP.' };
    const quotation = quotationOf(draft.DocumentLines);

    if (p.accion === 'retomar') {
      if (!REJECTED.includes(state)) return { ok: false, status: 409, error: `Solo se retoma una oferta devuelta o negada (estado actual: ${state || 'sin estado'}).` };
      await sapPatch(sap, `Drafts(${p.docEntry})`, { U_SEND_State: 'B', U_SEND_TraCorP: `${stamp()} | Retomada por ${p.userName} en SynerLink (estaba en ${state})` });
      const idRequest = await createDraftOfferRequest(p.companyId, p.userId, { ...(draft as Record<string, unknown>), DocEntry: p.docEntry } as never);
      await pool.request().input('c', sql.Int, p.companyId).input('d', sql.Int, p.docEntry).input('q', sql.Int, quotation).input('u', sql.NVarChar(50), p.userId).input('r', sql.Int, idRequest).query(`
        MERGE dbo.sales_offer_draft AS t USING (SELECT @c AS id_company, @d AS doc_entry) AS s ON t.id_company = s.id_company AND t.doc_entry = s.doc_entry
        WHEN MATCHED THEN UPDATE SET status = N'borrador', id_user = @u, id_request_general = @r, quotation_doc_entry = COALESCE(@q, t.quotation_doc_entry), updated_at = sysutcdatetime()
        WHEN NOT MATCHED THEN INSERT (id_company, doc_entry, quotation_doc_entry, id_user, status, id_request_general) VALUES (@c, @d, @q, @u, N'borrador', @r);`);
      return { ok: true, idRequest, detalle: `La oferta volvió a borrador con la solicitud #${idRequest}: edítela y envíela a pedido.` };
    }

    if (!CANCELLABLE.includes(state)) return { ok: false, status: 409, error: `La oferta está en autorización (${state}): se rechaza desde la autorización, no se cancela.` };
    const motivo = CANCEL_REASONS[String(p.motivo ?? '')] ? String(p.motivo) : '';
    if (!motivo) return { ok: false, status: 422, error: 'Elija el motivo de la cancelación.' };
    const comentario = String(p.comentario ?? '').trim().slice(0, 150);
    await sapPatch(sap, `Drafts(${p.docEntry})`, {
      U_SEND_CanOfe: motivo,
      U_SEND_TraOrdCan: `${stamp()} | Oferta de venta cancelada en SynerLink por ${p.userName} | ${CANCEL_REASONS[motivo]}${comentario ? ` | "${comentario}"` : ''}`,
    });
    if (quotation) await sapPost(sap, `Quotations(${quotation})/Cancel`, {}).catch((e) => { if (!(e instanceof SapError)) throw e; });
    await sapPost(sap, `Drafts(${p.docEntry})/Close`, {});
    const texto = `Oferta cancelada: ${CANCEL_REASONS[motivo]}${comentario ? ` — ${comentario}` : ''}.`;
    await pool.request().input('c', sql.Int, p.companyId).input('d', sql.Int, p.docEntry).query(`
      UPDATE dbo.sales_offer_draft SET status = N'anulado', updated_at = sysutcdatetime() WHERE id_company = @c AND doc_entry = @d AND status = N'borrador';
      UPDATE dbo.sales_authorization SET status = N'cancelled', updated_at = sysutcdatetime() WHERE id_company = @c AND doc_entry = @d AND status IN (N'rejected', N'reject_error');`);
    await pool.request().input('r', sql.Int, p.idRequest).input('m', sql.NVarChar(sql.MAX), texto).query(`
      UPDATE requests_general SET status_req = 3, resolution = @m, date_resolution = GETDATE() WHERE id = @r AND status_req NOT IN (2, 3);
      UPDATE task_request_general SET id_status = 3 WHERE id_request_general = @r AND id_status = 4;`);
    return { ok: true, detalle: texto };
  } finally {
    await sapLogout(sap);
  }
}
