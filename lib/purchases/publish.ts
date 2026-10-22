import { sapGet, sapPatch, sapPost, type SapSession } from '../sap/serviceLayer';
import { todayBogota } from './drafts';
import { normalizeState } from './states';

/**
 * Publicacion de la solicitud en FIRME (PurchaseRequests) al aprobar un borrador.
 * Replica useAuthorizePurchaseRequest.jsx:48-139 de SAPSEND, con los mismos
 * tres pasos y el mismo resultado visible en SAPSEND:
 *   1) POST PurchaseRequests (copia del Draft)
 *   2) PATCH Drafts(id)          { U_SEND_State: 'A', U_SEND_SolCom: <DocEntry firme> }
 *   3) PATCH PurchaseRequests(n) { U_SEND_SolCom: <su propio DocEntry> }
 *
 * Diferencia deliberada: en SAPSEND, si el paso 2 fallaba quedaba una firme
 * huerfana y un reintento creaba otra. Aqui la firme nace con la marca
 * U_SEND_SolCom = 'D<DocEntry del borrador>' y cada ejecucion reanuda desde donde
 * quedo, asi que reintentar nunca duplica.
 */

/** Marca temporal que enlaza la firme con su borrador hasta el paso 3. */
export function firmMarker(draftDocEntry: number): string {
  return `D${draftDocEntry}`;
}

type Draft = Record<string, unknown> & { DocEntry: number; DocumentLines?: Record<string, unknown>[] };

/** Payload del POST PurchaseRequests (igual a SAPSEND, l.69-88) con la marca de idempotencia. */
export function buildFirmPayload(draft: Draft, today: string = todayBogota()) {
  const lines = draft.DocumentLines ?? [];
  return {
    Comments: draft.Comments,
    U_SEND_Ane: draft.U_SEND_Ane,
    DocDueDate: draft.DocDate,
    DocDate: today,
    RequriedDate: today,
    U_SEND_UserId: draft.U_SEND_UserId,
    U_SEND_UserName: draft.U_SEND_UserName,
    U_SEND_Dep: draft.U_SEND_Dep,
    U_SEND_UserEmail: draft.U_SEND_UserEmail,
    U_SEND_SolCom: firmMarker(draft.DocEntry),
    RequesterName: draft.RequesterName,
    DocCurrency: draft.DocCurrency,
    AttachmentEntry: draft.AttachmentEntry,
    DocumentLines: lines.map((l) => ({ ...l, RequiredDate: l.RequiredDate || today })),
  };
}

export type PublishResult =
  | { ok: true; firmDocEntry: number; firmDocNum?: number; resumed: boolean }
  | { ok: false; conflict: true; state: string | null; error: string };

/** Operaciones de SAP que usa la publicacion. Inyectables para tests. */
export interface PublishSap {
  getDraft: (docEntry: number) => Promise<Draft & { 'odata.etag'?: string }>;
  findFirmByMarker: (marker: string) => Promise<{ DocEntry: number; DocNum?: number } | null>;
  createFirm: (payload: ReturnType<typeof buildFirmPayload>) => Promise<{ DocEntry: number; DocNum?: number }>;
  markDraftApproved: (docEntry: number, firmDocEntry: number, etag?: string) => Promise<void>;
  setFirmSolCom: (firmDocEntry: number) => Promise<void>;
}

export function publishSap(sap: SapSession): PublishSap {
  return {
    getDraft: (docEntry) => sapGet(sap, `Drafts(${docEntry})`),
    findFirmByMarker: async (marker) => {
      const page = await sapGet<{ value?: Array<{ DocEntry: number; DocNum?: number }> }>(
        sap,
        `PurchaseRequests?$select=DocEntry,DocNum&$filter=U_SEND_SolCom eq '${marker}'&$top=1`
      );
      return page.value?.[0] ?? null;
    },
    createFirm: (payload) => sapPost(sap, 'PurchaseRequests', payload),
    markDraftApproved: (docEntry, firmDocEntry, etag) =>
      sapPatch(sap, `Drafts(${docEntry})`, { U_SEND_State: 'A', U_SEND_SolCom: String(firmDocEntry) }, false, {
        ifMatch: etag,
      }),
    setFirmSolCom: (firmDocEntry) =>
      sapPatch(sap, `PurchaseRequests(${firmDocEntry})`, { U_SEND_SolCom: String(firmDocEntry) }),
  };
}

/**
 * Publica (o termina de publicar) la firme de un borrador aprobado. Idempotente.
 * Exige que el borrador este en LA (o ya en A con su firme). Cualquier otro
 * estado -> conflicto sin tocar nada (p. ej. alguien lo rechazo en SAPSEND).
 */
export async function publishApprovedDraft(sap: PublishSap, draftDocEntry: number): Promise<PublishResult> {
  const draft = await sap.getDraft(draftDocEntry);
  const state = normalizeState(draft.U_SEND_State);
  const solCom = String(draft.U_SEND_SolCom ?? '').trim();

  // Ya publicada (por nosotros o por SAPSEND): solo asegurar el paso 3.
  if (state === 'A' && /^\d+$/.test(solCom)) {
    const firmDocEntry = Number(solCom);
    await sap.setFirmSolCom(firmDocEntry).catch(() => undefined);
    return { ok: true, firmDocEntry, resumed: true };
  }
  if (state !== 'LA') {
    return {
      ok: false,
      conflict: true,
      state,
      error: `El borrador ya no esta por autorizar (estado actual: ${state ?? 'sin estado'}). No se publico.`,
    };
  }

  // Paso 1, idempotente por la marca.
  const existing = await sap.findFirmByMarker(firmMarker(draftDocEntry));
  const firm = existing ?? (await sap.createFirm(buildFirmPayload(draft)));

  // Paso 2 (con If-Match: si cambio en SAPSEND entretanto, falla y se reintenta luego).
  await sap.markDraftApproved(draftDocEntry, firm.DocEntry, draft['odata.etag']);

  // Paso 3, best-effort como en SAPSEND: la solicitud ya quedo aprobada.
  await sap.setFirmSolCom(firm.DocEntry).catch(() => undefined);

  return { ok: true, firmDocEntry: firm.DocEntry, firmDocNum: firm.DocNum, resumed: Boolean(existing) };
}
