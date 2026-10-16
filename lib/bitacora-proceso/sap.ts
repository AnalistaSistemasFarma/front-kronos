import 'server-only';
import { prisma } from '../prisma';
import { sapGet, sapLogin, sapLogout } from '../sap/serviceLayer';
import { buildSapOpFilter, OtError, type SapOpSnapshot } from './rules';

/**
 * Selector OPCIONAL de la orden de producción de SAP (R11) — SOLO LECTURA (R12).
 * Únicamente Login, GET de ProductionOrders planificadas o liberadas (B5, 2026-10-15)
 * y Logout. Este módulo no
 * hace POST/PATCH/DELETE al Service Layer: ni OP, ni emisiones, ni recibos.
 */
const SELECT = 'AbsoluteEntry,DocumentNumber,ItemNo,ProductDescription,U_Cod_Lote,U_FecVen_lote,PlannedQuantity,Warehouse,ProductionOrderStatus';

async function credencialesSap(idCompany: number) {
  const endpoints = await prisma.sap_endpoints.findMany({ where: { id_company: idCompany } });
  const ep = endpoints.find((e) => e.is_active) ?? null;
  if (!ep || !ep.base_url) return null;
  return { baseUrl: ep.base_url, username: ep.username ?? '', password: ep.password ?? '', companyDB: ep.client ?? '' };
}

function toSnapshot(row: Record<string, unknown>): SapOpSnapshot | null {
  const abs = Number(row.AbsoluteEntry);
  const doc = Number(row.DocumentNumber);
  if (!Number.isInteger(abs) || !Number.isInteger(doc)) return null;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    AbsoluteEntry: abs,
    DocumentNumber: doc,
    ItemNo: s(row.ItemNo),
    ProductDescription: s(row.ProductDescription),
    U_Cod_Lote: s(row.U_Cod_Lote),
    U_FecVen_lote: s(row.U_FecVen_lote),
    PlannedQuantity: typeof row.PlannedQuantity === 'number' ? row.PlannedQuantity : null,
    Warehouse: s(row.Warehouse),
    ProductionOrderStatus: s(row.ProductionOrderStatus),
  };
}

/** Busca hasta 20 OP planificadas o liberadas de la empresa que coincidan con el texto o el número. */
export async function buscarOps(idCompany: number, q: string): Promise<SapOpSnapshot[]> {
  const creds = await credencialesSap(idCompany);
  if (!creds) throw new OtError('La empresa no tiene un Service Layer de SAP activo.', 409);
  const session = await sapLogin(creds);
  try {
    const path = `ProductionOrders?$filter=${encodeURIComponent(buildSapOpFilter(q))}&$select=${SELECT}&$orderby=DocumentNumber desc&$top=20`;
    const data = await sapGet<{ value?: Record<string, unknown>[] }>(session, path.replace(/ /g, '%20'));
    return (data.value ?? []).map(toSnapshot).filter((x): x is SapOpSnapshot => x !== null);
  } finally {
    await sapLogout(session).catch(() => undefined);
  }
}
