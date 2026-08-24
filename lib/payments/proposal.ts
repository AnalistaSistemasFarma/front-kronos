// ---------------------------------------------------------------------------
// Propuesta de pago — lógica de LECTURA del futuro "Asistente de Pagos".
//
// El Asistente de Pagos (multiempresa) lee las facturas de proveedor ABIERTAS
// de una empresa, las agrupa por proveedor y arma una propuesta de pago con el
// total pendiente y los datos bancarios de cada proveedor.
//
// SOLO LECTURA: este módulo únicamente CONSULTA el SAP Service Layer (GET). No
// escribe nada en SAP y no mueve dinero. La conversión a centavos y el armado
// del archivo plano DISFON (dispersión de fondos) se hacen después, en otro
// paso, a partir de esta propuesta.
//
// Reutiliza el cliente SAP existente del repo (`lib/sap/serviceLayer.ts`) y
// sigue el mismo estilo de consulta que `lib/health-records/records.ts`.
//
// Los importes se manejan en PESOS (unidad de la moneda del documento), no en
// centavos. La conversión a centavos para el DISFON se realiza aguas abajo.
// ---------------------------------------------------------------------------

import { sapGet, sapGetAll, type SapSession } from '../sap/serviceLayer';

/** Escapa comillas simples para literales OData (patrón de records.ts). */
export function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/** Factura de proveedor abierta, ya normalizada para la propuesta de pago. */
export interface SupplierInvoice {
  docEntry: number;
  docNum: number;
  cardCode: string;
  cardName: string;
  docDate: string;
  docDueDate: string;
  docTotal: number;
  paidToDate: number;
  /** Saldo pendiente = docTotal - paidToDate (en pesos). */
  pendingAmount: number;
  docCurrency: string;
}

/** Cuenta bancaria de un proveedor (socio de negocio). */
export interface SupplierBankAccount {
  bankCode: string;
  accountNo: string;
  branch: string;
  isDefault: boolean;
}

/** Grupo de facturas de un mismo proveedor dentro de la propuesta. */
export interface SupplierGroup {
  cardCode: string;
  cardName: string;
  invoices: SupplierInvoice[];
  invoiceCount: number;
  /** Suma de pendingAmount de las facturas del proveedor (en pesos). */
  totalPending: number;
  bankAccounts: SupplierBankAccount[];
  /** Cuenta por defecto: la marcada isDefault, o la primera si no hay marca. */
  defaultBankAccount: SupplierBankAccount | null;
  hasBankData: boolean;
  /** País del proveedor según SAP (`BusinessPartners.Country`, p.ej. 'CO'). Vacío si no hay. */
  country: string;
  /**
   * `true` cuando el pago es al EXTERIOR (no va por DISFON / dispersión nacional
   * del Banco de Bogotá). Clasificación PROVISIONAL (a confirmar con Nicolás):
   * es exterior si el país existe y no es 'CO', O si alguna factura tiene moneda
   * distinta de 'COP'. Sin país ni moneda extranjera → nacional.
   */
  isForeign: boolean;
}

/** Propuesta de pago completa: proveedores, totales y faltantes de banco. */
export interface PaymentProposal {
  /** Todos los grupos (nacionales + exterior), por compatibilidad. */
  groups: SupplierGroup[];
  /** Grupos NACIONALES (a terceros): conservan el flujo DISFON. */
  nationalGroups: SupplierGroup[];
  /** Grupos del EXTERIOR: no van por DISFON (mecanismo por definir). */
  foreignGroups: SupplierGroup[];
  supplierCount: number;
  invoiceCount: number;
  /** Suma de totalPending de todos los grupos (en pesos). */
  grandTotalPending: number;
  /** cardCodes de proveedores sin datos bancarios. */
  suppliersMissingBank: string[];
}

/** Forma cruda de una factura de proveedor tal como la devuelve el SL. */
interface RawPurchaseInvoice {
  DocEntry?: number;
  DocNum?: number;
  CardCode?: string;
  CardName?: string;
  DocDate?: string;
  DocDueDate?: string;
  DocTotal?: number;
  PaidToDate?: number;
  DocCurrency?: string;
  DocumentStatus?: string;
}

/** Convierte a número de forma segura (undefined/null → 0). */
function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lee las facturas de proveedor ABIERTAS (`DocumentStatus eq 'bost_Open'`) de
 * la empresa mediante la entidad `PurchaseInvoices` del Service Layer. Recorre
 * TODA la paginación con `sapGetAll`. Si viene `opts.cardCode`, acota a ese
 * proveedor. SOLO LECTURA.
 */
export async function getOpenSupplierInvoices(
  session: SapSession,
  opts?: { cardCode?: string }
): Promise<SupplierInvoice[]> {
  let filterExpr = `DocumentStatus eq 'bost_Open'`;
  if (opts?.cardCode) {
    filterExpr += ` and CardCode eq '${escapeOData(opts.cardCode)}'`;
  }

  const select =
    'DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,PaidToDate,DocCurrency,DocumentStatus';
  const path = `PurchaseInvoices?$filter=${encodeURIComponent(filterExpr)}&$select=${select}`;

  const rows = await sapGetAll<RawPurchaseInvoice>(session, path);

  return rows.map((r) => {
    const docTotal = toNumber(r.DocTotal);
    const paidToDate = toNumber(r.PaidToDate);
    return {
      docEntry: toNumber(r.DocEntry),
      docNum: toNumber(r.DocNum),
      cardCode: r.CardCode ?? '',
      cardName: r.CardName ?? '',
      docDate: r.DocDate ?? '',
      docDueDate: r.DocDueDate ?? '',
      docTotal,
      paidToDate,
      pendingAmount: docTotal - paidToDate,
      docCurrency: r.DocCurrency ?? '',
    };
  });
}

/** Identificación tributaria de un proveedor leída de SAP (solo lo esencial). */
export interface SupplierIdentity {
  /** Documento tal como lo devuelve SAP (`FederalTaxID`). Vacío si no hay. */
  federalTaxID: string;
}

/** Forma cruda del socio de negocio para leer su identificación. */
interface RawBusinessPartnerIdentity {
  CardCode?: string;
  FederalTaxID?: string;
}

/**
 * Lee la identificación tributaria de un proveedor desde `BusinessPartners`
 * (`FederalTaxID`). SOLO LECTURA. Devuelve `{ federalTaxID: '' }` si el campo no
 * viene, para que el llamador lo trate como "sin identificación" (warning) en
 * vez de romper.
 */
export async function getSupplierIdentity(
  session: SapSession,
  cardCode: string
): Promise<SupplierIdentity> {
  const path = `BusinessPartners('${escapeOData(cardCode)}')?$select=CardCode,FederalTaxID`;
  const bp = await sapGet<RawBusinessPartnerIdentity>(session, path);
  return { federalTaxID: bp?.FederalTaxID ?? '' };
}

/** Forma cruda de una cuenta bancaria de socio de negocio (SL). */
interface RawBPBankAccount {
  BankCode?: string;
  AccountNo?: string;
  Branch?: string;
}

/** Forma cruda del socio de negocio con sus cuentas bancarias expandidas. */
interface RawBusinessPartner {
  CardCode?: string;
  Country?: string;
  DefaultBankCode?: string;
  DefaultAccount?: string;
  BPBankAccounts?: RawBPBankAccount[];
}

/** Cuentas bancarias de un proveedor + su país (para clasificar nacional/exterior). */
export interface SupplierBankData {
  accounts: SupplierBankAccount[];
  /** País del proveedor (`BusinessPartners.Country`, p.ej. 'CO'). Vacío si no hay. */
  country: string;
}

/**
 * Lee las cuentas bancarias de un proveedor desde `BusinessPartners`, expandien-
 * do la colección `BPBankAccounts`, y su país (`Country`). SOLO LECTURA.
 *
 * NOTA (por verificar contra la metadata real de SAP): los nombres exactos de
 * los campos de la cuenta bancaria (`BankCode`, `AccountNo`, `Branch`) y de los
 * campos de la cuenta por defecto en el BP (`DefaultBankCode`, `DefaultAccount`)
 * son los TÍPICOS del Service Layer, pero deben confirmarse contra la metadata
 * real (`$metadata` / la instancia de la empresa) antes de darlos por definiti-
 * vos. Si un campo no viene, se cae a un valor vacío/false sin romper.
 */
export async function getSupplierBankAccounts(
  session: SapSession,
  cardCode: string
): Promise<SupplierBankData> {
  // BPBankAccounts (OCRB) NO es una navigation property expandible en esta
  // Service Layer ($expand=BPBankAccounts -> 400 "invalid navigation property").
  // La colección SÍ viene inline al pedirla dentro de $select. Antes usábamos
  // $expand y el SL devolvía error, por lo que TODO proveedor salía "sin cuenta".
  const path = `BusinessPartners('${escapeOData(cardCode)}')?$select=CardCode,Country,DefaultBankCode,DefaultAccount,BPBankAccounts`;

  const bp = await sapGet<RawBusinessPartner>(session, path);
  const accounts = bp?.BPBankAccounts ?? [];

  const defaultBankCode = bp?.DefaultBankCode ?? '';
  const defaultAccount = bp?.DefaultAccount ?? '';
  const hasDefaultRef = Boolean(defaultBankCode || defaultAccount);

  const mapped = accounts.map((a) => {
    const bankCode = a.BankCode ?? '';
    const accountNo = a.AccountNo ?? '';
    // Solo se marca isDefault cuando el BP declara una cuenta por defecto y
    // esta cuenta coincide con esa referencia. Si el BP no la declara, ninguna
    // cuenta se marca aquí (la selección de "primera" se resuelve en el armado).
    const isDefault =
      hasDefaultRef &&
      (defaultBankCode ? bankCode === defaultBankCode : true) &&
      (defaultAccount ? accountNo === defaultAccount : true);
    return {
      bankCode,
      accountNo,
      branch: a.Branch ?? '',
      isDefault,
    };
  });

  return { accounts: mapped, country: bp?.Country ?? '' };
}

/**
 * Determina si un proveedor es de pago al EXTERIOR. Clasificación PROVISIONAL
 * (a confirmar con Nicolás): es exterior si el `country` existe y no es 'CO', O
 * si alguna de sus facturas tiene moneda distinta de 'COP'. Sin país ni moneda
 * extranjera → nacional.
 */
export function classifyIsForeign(country: string, invoices: SupplierInvoice[]): boolean {
  const c = (country ?? '').trim().toUpperCase();
  if (c && c !== 'CO') return true;
  if (invoices.some((inv) => (inv.docCurrency ?? '').trim().toUpperCase() !== 'COP' && (inv.docCurrency ?? '').trim() !== ''))
    return true;
  return false;
}

/**
 * Arma la propuesta de pago a partir de las facturas abiertas, el mapa de
 * cuentas bancarias por proveedor y (opcional) el mapa de país por proveedor.
 * FUNCIÓN PURA: no consulta SAP, no toca la red y es determinística. Es el
 * corazón del módulo y la que se prueba a fondo.
 *
 *  - Agrupa las facturas por `cardCode`.
 *  - Por proveedor calcula `totalPending` (suma de pendingAmount), elige la
 *    cuenta por defecto (la marcada isDefault, o la primera si no hay marca),
 *    determina `hasBankData` y clasifica nacional vs exterior (`isForeign`).
 *  - Ordena los grupos por `cardName` y arma los totales globales, además de la
 *    lista de proveedores sin datos bancarios (`suppliersMissingBank`) y las
 *    colecciones `nationalGroups` / `foreignGroups`.
 */
export function buildPaymentProposal(
  invoices: SupplierInvoice[],
  bankByCardCode: Record<string, SupplierBankAccount[]>,
  countryByCardCode: Record<string, string> = {}
): PaymentProposal {
  // Agrupar facturas por proveedor, preservando el orden de aparición.
  const byCard = new Map<string, SupplierInvoice[]>();
  for (const inv of invoices) {
    const list = byCard.get(inv.cardCode);
    if (list) list.push(inv);
    else byCard.set(inv.cardCode, [inv]);
  }

  const groups: SupplierGroup[] = [];
  const suppliersMissingBank: string[] = [];

  for (const [cardCode, groupInvoices] of byCard) {
    const totalPending = groupInvoices.reduce((sum, inv) => sum + inv.pendingAmount, 0);
    const bankAccounts = bankByCardCode[cardCode] ?? [];
    const hasBankData = bankAccounts.length > 0;
    const defaultBankAccount =
      bankAccounts.find((a) => a.isDefault) ?? bankAccounts[0] ?? null;

    // El nombre se toma de la primera factura del proveedor.
    const cardName = groupInvoices[0]?.cardName ?? '';

    const country = countryByCardCode[cardCode] ?? '';
    const isForeign = classifyIsForeign(country, groupInvoices);

    groups.push({
      cardCode,
      cardName,
      invoices: groupInvoices,
      invoiceCount: groupInvoices.length,
      totalPending,
      bankAccounts,
      defaultBankAccount,
      hasBankData,
      country,
      isForeign,
    });

    if (!hasBankData) suppliersMissingBank.push(cardCode);
  }

  // Ordenar los grupos por nombre de proveedor (comparación estable por locale).
  groups.sort((a, b) => a.cardName.localeCompare(b.cardName));

  const nationalGroups = groups.filter((g) => !g.isForeign);
  const foreignGroups = groups.filter((g) => g.isForeign);

  const grandTotalPending = groups.reduce((sum, g) => sum + g.totalPending, 0);
  const invoiceCount = invoices.length;

  return {
    groups,
    nationalGroups,
    foreignGroups,
    supplierCount: groups.length,
    invoiceCount,
    grandTotalPending,
    suppliersMissingBank,
  };
}
