import { odataString } from './drafts';
import { toOptions, type LookupKind, type LookupOption } from './lookups';

/**
 * Búsqueda ampliada (lupa) de los campos de línea de la solicitud de compra contra SAP,
 * como la de Ventas: más columnas, búsqueda vacía = todos, páginas de 50. PURO: arma la
 * ruta OData y proyecta las filas. Cada fila trae `option` (valor y campos que llena),
 * igual que el autocompletar, para que elegir en el modal o en la lista dé lo mismo.
 */
export const PAGE_SIZE = 50;

export type SearchRow = Record<string, unknown> & { option: LookupOption };

function contains(fields: string[], q: string): string {
  const t = odataString(q.trim());
  return `(${fields.map((f) => `contains(${f},${t})`).join(' or ')})`;
}

export function searchPath(kind: LookupKind, q: string, page: number): string {
  const skip = `$skip=${page * PAGE_SIZE}`;
  const and = (base: string, cond: string | null) => [base, cond].filter(Boolean).join(' and ');
  const term = q.trim();
  switch (kind) {
    case 'item':
      return `Items?$select=ItemCode,ItemName,QuantityOnStock,PurchaseUnit,DefaultWarehouse&$orderby=ItemCode&${skip}&$filter=${and(
        "Frozen eq 'tNO'",
        term ? contains(['ItemCode', 'ItemName'], term) : null
      )}`;
    case 'vendor':
      return `BusinessPartners?$select=CardCode,CardName,FederalTaxID,City,Phone1,EmailAddress,CurrentAccountBalance&$orderby=CardName&${skip}&$filter=${and(
        "CardType eq 'cSupplier' and Frozen eq 'tNO'",
        term ? contains(['CardCode', 'CardName', 'FederalTaxID'], term) : null
      )}`;
    case 'account':
      return `ChartOfAccounts?$select=Code,Name,AccountLevel&$orderby=Code&${skip}&$filter=${and(
        "(AccountLevel eq 5 or AccountLevel eq 8) and ActiveAccount eq 'tYES'",
        term ? `(startswith(Code,${odataString(term)}) or contains(Name,${odataString(term)}))` : null
      )}`;
    case 'tax':
      return `SalesTaxCodes?$select=Code,Name,Rate&$orderby=Code&${skip}&$filter=${and(
        "Inactive eq 'tNO' and ValidForAP eq 'tYES'",
        term ? contains(['Code', 'Name'], term) : null
      )}`;
    case 'warehouse':
      return `Warehouses?$select=WarehouseCode,WarehouseName&$orderby=WarehouseCode&${skip}&$filter=${and(
        "Inactive eq 'tNO'",
        term ? contains(['WarehouseCode', 'WarehouseName'], term) : null
      )}`;
    case 'costing':
      // SAP ignora $filter en esta lista: se filtra y pagina en memoria (searchRows).
      return 'DistributionRulesService_GetDistributionRuleList';
  }
}

/** La misma opción que daría el autocompletar para esa fila. */
const optionOf = (kind: LookupKind, r: Record<string, unknown>): LookupOption => toOptions(kind, [r], '')[0];

/** Filas del modal: columnas visibles + la opción que se aplica al elegir. */
export function searchRows(kind: LookupKind, rows: Record<string, unknown>[], q: string, page: number): { rows: SearchRow[]; hasMore: boolean } {
  let list = rows;
  if (kind === 'costing') {
    const t = q.trim().toLowerCase();
    const all = rows.filter(
      (r) => !t || String(r.FactorCode ?? '').toLowerCase().includes(t) || String(r.FactorDescription ?? '').toLowerCase().includes(t)
    );
    list = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    return { rows: list.map((r) => ({ ...r, option: optionOf(kind, r) })), hasMore: all.length > (page + 1) * PAGE_SIZE };
  }
  return { rows: list.map((r) => ({ ...r, option: optionOf(kind, r) })), hasMore: list.length >= PAGE_SIZE };
}
