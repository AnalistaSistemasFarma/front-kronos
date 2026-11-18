import { odataString } from './drafts';

/**
 * Solicitudes de compra ANTERIORES (las creadas en SAPSEND) leídas en vivo del SAP
 * de cada empresa, para consultarlas y duplicarlas desde Mis solicitudes. PURO.
 * Provisional mientras SAPSEND convive con SynerLink (Nicolás Rivera, 2026-11-18).
 */
export const PREVIOUS_PAGE = 200;
export const PREVIOUS_MAX_DAYS = 366;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Rango válido (desde ≤ hasta, máximo un año). Por defecto, los últimos 6 meses. */
export function previousRange(from: string | null, to: string | null, today: string): { from: string; to: string } {
  const t = to && ISO.test(to) ? to : today;
  const def = new Date(`${t}T00:00:00Z`);
  def.setUTCMonth(def.getUTCMonth() - 6);
  let f = from && ISO.test(from) ? from : def.toISOString().slice(0, 10);
  if (f > t) f = t;
  const min = new Date(`${t}T00:00:00Z`);
  min.setUTCDate(min.getUTCDate() - PREVIOUS_MAX_DAYS);
  const minIso = min.toISOString().slice(0, 10);
  if (f < minIso) f = minIso;
  return { from: f, to: t };
}

export function previousPath(p: { from: string; to: string; sapsendUserId?: number | null; q?: string }): string {
  const clauses = [
    "DocObjectCode eq 'oPurchaseRequest'",
    `DocDate ge '${p.from}'`,
    `DocDate le '${p.to}'`,
  ];
  if (p.sapsendUserId != null) clauses.push(`U_SEND_UserId eq ${Number(p.sapsendUserId)}`);
  const q = (p.q ?? '').trim();
  if (q) {
    const t = odataString(q.toUpperCase());
    clauses.push(`(contains(Comments,${t}) or contains(U_SEND_UserName,${odataString(q)}))`);
  }
  return (
    'Drafts?$select=DocEntry,DocNum,DocDate,RequriedDate,U_SEND_State,U_SEND_UserName,U_SEND_UserId,Comments,DocTotal,DocCurrency,U_SEND_SolCom' +
    `&$filter=${clauses.join(' and ')}&$orderby=DocEntry desc`
  );
}
