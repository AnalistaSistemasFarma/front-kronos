import { odataString } from './drafts';

/**
 * Busquedas en SAP para los campos de linea de la solicitud (autocompletar),
 * PURAS: arman la consulta y proyectan el resultado. Replican las de SAPSEND
 * (ModalCreatePurchaseRequest.jsx:220-398) con dos correcciones:
 *  - el texto del usuario se escapa (SAPSEND lo interpolaba sin escapar);
 *  - en cuentas, el and/or va entre parentesis (SAPSEND devolvia cualquier cuenta de nivel 8),
 *    se busca por codigo O por nombre y solo cuentas activas.
 * Normas de reparto: SAP ignora $filter en esa lista, asi que se filtra en memoria.
 */

export type LookupKind = 'item' | 'vendor' | 'account' | 'tax' | 'costing' | 'warehouse';

export interface LookupOption {
  /** Valor que se guarda en el campo. */
  value: string;
  /** Texto que se muestra. */
  label: string;
  /** Campos extra que se llenan al elegir (p. ej. nombre del proveedor). */
  fill?: Record<string, string>;
}

const TOP = 10;

/** Ruta OData de la busqueda (sin la base /b1s/v1/). */
export function lookupPath(kind: LookupKind, q: string): string {
  const t = odataString(q.trim());
  switch (kind) {
    case 'item':
      return `Items?$top=${TOP}&$select=ItemCode,ItemName,DefaultWarehouse&$filter=contains(ItemCode,${t}) or contains(ItemName,${t})`;
    case 'vendor':
      return `BusinessPartners?$top=${TOP}&$select=CardCode,CardName&$filter=(startswith(CardName,${t}) or startswith(CardCode,${t})) and CardType eq 'cSupplier' and Frozen eq 'tNO'`;
    case 'account':
      return `ChartOfAccounts?$top=${TOP}&$select=Code,Name&$filter=(startswith(Code,${t}) or contains(Name,${t})) and (AccountLevel eq 5 or AccountLevel eq 8) and ActiveAccount eq 'tYES'`;
    case 'tax':
      return `SalesTaxCodes?$top=${TOP}&$select=Code,Name&$filter=contains(Code,${t}) and Inactive eq 'tNO' and ValidForAP eq 'tYES'`;
    case 'warehouse':
      return `Warehouses?$top=${TOP}&$select=WarehouseCode,WarehouseName&$filter=startswith(WarehouseCode,${t})`;
    case 'costing':
      return 'DistributionRulesService_GetDistributionRuleList';
  }
}

const s = (v: unknown) => (v == null ? '' : String(v));

/** Proyecta la respuesta de SAP a opciones. */
export function toOptions(kind: LookupKind, rows: Record<string, unknown>[], q: string): LookupOption[] {
  switch (kind) {
    case 'item':
      return rows.map((r) => ({
        value: s(r.ItemCode),
        label: `${s(r.ItemCode)} · ${s(r.ItemName)}`,
        fill: {
          ItemDescription: s(r.ItemName).toUpperCase(),
          ...(r.DefaultWarehouse ? { WarehouseCode: s(r.DefaultWarehouse) } : {}),
        },
      }));
    case 'vendor':
      return rows.map((r) => ({
        value: s(r.CardCode),
        label: `${s(r.CardCode)} · ${s(r.CardName)}`,
        fill: { LineVendor: s(r.CardCode), U_NombreProveedor: s(r.CardName) },
      }));
    case 'account':
      return rows.map((r) => ({ value: s(r.Code), label: `${s(r.Code)} · ${s(r.Name)}` }));
    case 'tax':
      return rows.map((r) => ({ value: s(r.Code), label: `${s(r.Code)} · ${s(r.Name)}` }));
    case 'warehouse':
      return rows.map((r) => ({ value: s(r.WarehouseCode), label: `${s(r.WarehouseCode)} · ${s(r.WarehouseName)}` }));
    case 'costing': {
      const term = q.trim().toLowerCase();
      return rows
        .filter((r) => s(r.FactorCode).toLowerCase().includes(term) || s(r.FactorDescription).toLowerCase().includes(term))
        .slice(0, TOP)
        .map((r) => ({ value: s(r.FactorCode), label: `${s(r.FactorCode)} · ${s(r.FactorDescription)}` }));
    }
  }
}

/** Campo de linea -> busqueda que le corresponde (null = texto libre). */
export const FIELD_LOOKUP: Partial<Record<string, LookupKind>> = {
  ItemCode: 'item',
  LineVendor: 'vendor',
  U_NombreProveedor: 'vendor',
  AccountCode: 'account',
  TaxCode: 'tax',
  CostingCode: 'costing',
  WarehouseCode: 'warehouse',
};

export const LOOKUP_KINDS: LookupKind[] = ['item', 'vendor', 'account', 'tax', 'costing', 'warehouse'];
