import { odataString } from '../purchases/drafts';
import { parseOrderMarker } from './publish';

/**
 * Panel de pedidos de venta en firme (Orders de SAP), como «Órdenes de Venta» de SAPSEND
 * (app/process/sells/page.jsx): búsqueda por número, cliente/NIT u OC del cliente, rango de
 * fechas, estado y origen, paginado. PURO: arma la ruta OData y proyecta filas.
 */

export type OrderStatus = 'todos' | 'abiertos' | 'cerrados' | 'cancelados';
export type OrderOrigin = 'todos' | 'synerlink';
export const ORDERS_PAGE = 50;

export interface OrderFilters {
  q?: string;
  desde?: string;
  hasta?: string;
  estado?: OrderStatus;
  origen?: OrderOrigin;
  page?: number;
}

const isDate = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export function ordersPath(f: OrderFilters): string {
  const parts: string[] = [];
  const q = (f.q ?? '').trim();
  if (q) {
    const t = odataString(q);
    const num = /^\d{1,9}$/.test(q) ? ` or DocNum eq ${Number(q)}` : '';
    parts.push(`(contains(CardCode,${t}) or contains(CardName,${t}) or contains(NumAtCard,${t})${num})`);
  }
  if (isDate(f.desde)) parts.push(`DocDate ge '${f.desde}'`);
  if (isDate(f.hasta)) parts.push(`DocDate le '${f.hasta}'`);
  if (f.estado === 'abiertos') parts.push("DocumentStatus eq 'bost_Open'");
  if (f.estado === 'cerrados') parts.push("DocumentStatus eq 'bost_Close' and Cancelled eq 'tNO'");
  if (f.estado === 'cancelados') parts.push("Cancelled eq 'tYES'");
  if (f.origen === 'synerlink') parts.push("startswith(U_SEND_SolCom,'V')");
  const skip = Math.max(0, Math.trunc(f.page ?? 0)) * ORDERS_PAGE;
  const filter = parts.length ? `&$filter=${parts.join(' and ')}` : '';
  return `Orders?$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,NumAtCard,ShipToCode,DocTotal,VatSum,DocCurrency,DocumentStatus,Cancelled,Comments,U_SEND_State,U_SEND_SolCom,SalesPersonCode${filter}&$orderby=DocEntry desc&$top=${ORDERS_PAGE}&$skip=${skip}`;
}

export interface OrderRow {
  docEntry: number;
  docNum: number;
  docDate: string;
  dueDate: string;
  cardCode: string;
  cardName: string;
  numAtCard: string;
  shipTo: string;
  total: number;
  vat: number;
  currency: string;
  status: 'Abierto' | 'Cerrado' | 'Cancelado';
  comments: string;
  /** Borrador de SynerLink del que salió (marca U_SEND_SolCom = 'V<borrador>'). */
  draftDocEntry: number | null;
  sendState: string | null;
}

const s = (v: unknown) => (v == null ? '' : String(v));

export function toOrderRow(r: Record<string, unknown>): OrderRow {
  const cancelled = s(r.Cancelled) === 'tYES';
  return {
    docEntry: Number(r.DocEntry),
    docNum: Number(r.DocNum),
    docDate: s(r.DocDate).slice(0, 10),
    dueDate: s(r.DocDueDate).slice(0, 10),
    cardCode: s(r.CardCode),
    cardName: s(r.CardName),
    numAtCard: s(r.NumAtCard),
    shipTo: s(r.ShipToCode),
    total: Number(r.DocTotal ?? 0),
    vat: Number(r.VatSum ?? 0),
    currency: s(r.DocCurrency),
    status: cancelled ? 'Cancelado' : s(r.DocumentStatus) === 'bost_Open' ? 'Abierto' : 'Cerrado',
    comments: s(r.Comments),
    draftDocEntry: parseOrderMarker(r.U_SEND_SolCom),
    sendState: r.U_SEND_State == null ? null : s(r.U_SEND_State),
  };
}
