/**
 * Análisis de cupo y cartera por edades para quien autoriza un extracupo (decisión de
 * cartera). PURO: recibe los datos de SAP y calcula. Lo usan /api/sales/credit y el
 * bloque de la oferta en el detalle de la solicitud y en Autorizaciones.
 */

export interface CreditInput {
  creditLimit: number;
  pctTolerancia: number;
  saldo: number;
  entregasAbiertas: number;
  pedidosAbiertos: number;
  otrasOfertas: number;
  estaOferta: number;
}

export interface CreditAnalysis extends CreditInput {
  limiteConTolerancia: number;
  comprometidoSinOferta: number;
  comprometido: number;
  disponible: number;
  excedente: number;
  /** % del límite de crédito que se usaría con esta oferta. */
  pctUso: number | null;
  /** % por encima del límite de crédito (0 si no lo supera). */
  pctExtracupo: number | null;
  excede: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function analyzeCredit(i: CreditInput): CreditAnalysis {
  const limiteConTolerancia = i.creditLimit * (1 + i.pctTolerancia / 100);
  const comprometidoSinOferta = i.saldo + i.entregasAbiertas + i.pedidosAbiertos + i.otrasOfertas;
  const comprometido = comprometidoSinOferta + i.estaOferta;
  const pctUso = i.creditLimit > 0 ? r2((comprometido / i.creditLimit) * 100) : null;
  return {
    ...i,
    limiteConTolerancia,
    comprometidoSinOferta,
    comprometido,
    disponible: limiteConTolerancia - comprometidoSinOferta,
    excedente: Math.max(0, comprometido - limiteConTolerancia),
    pctUso,
    pctExtracupo: pctUso == null ? null : Math.max(0, r2(pctUso - 100)),
    excede: comprometido > limiteConTolerancia,
  };
}

export interface OpenInvoice {
  docNum: number;
  docDate: string;
  dueDate: string;
  total: number;
  pendiente: number;
  diasVencida: number;
}

export const BUCKETS = [
  { key: 'por_vencer', label: 'Por vencer', min: -Infinity, max: 0 },
  { key: 'd1_30', label: '1 a 30 días', min: 1, max: 30 },
  { key: 'd31_60', label: '31 a 60 días', min: 31, max: 60 },
  { key: 'd61_90', label: '61 a 90 días', min: 61, max: 90 },
  { key: 'd91_120', label: '91 a 120 días', min: 91, max: 120 },
  { key: 'd120', label: 'Más de 120 días', min: 121, max: Infinity },
] as const;

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

/** Facturas abiertas del cliente → pendiente y días vencidos (contra el vencimiento). */
export function toOpenInvoices(rows: Record<string, unknown>[], today: string): OpenInvoice[] {
  return rows
    .map((r) => {
      const total = Number(r.DocTotal ?? 0);
      const pendiente = r2(total - Number(r.PaidToDate ?? 0));
      const due = String(r.DocDueDate ?? r.DocDate ?? today).slice(0, 10);
      return { docNum: Number(r.DocNum), docDate: String(r.DocDate ?? '').slice(0, 10), dueDate: due, total, pendiente, diasVencida: days(due, today) };
    })
    .filter((x) => x.pendiente > 0.009)
    .sort((a, b) => b.diasVencida - a.diasVencida);
}

/** Cartera por edades: monto y número de facturas por rango de días vencidos. */
export function aging(invoices: OpenInvoice[]) {
  const buckets = BUCKETS.map((b) => {
    const xs = invoices.filter((i) => i.diasVencida >= b.min && i.diasVencida <= b.max);
    return { key: b.key, label: b.label, amount: r2(xs.reduce((a, x) => a + x.pendiente, 0)), count: xs.length };
  });
  const total = r2(invoices.reduce((a, x) => a + x.pendiente, 0));
  const vencido = r2(invoices.filter((i) => i.diasVencida > 0).reduce((a, x) => a + x.pendiente, 0));
  return { buckets, total, vencido, pctVencido: total > 0 ? r2((vencido / total) * 100) : 0, maxDias: invoices.length ? Math.max(0, invoices[0].diasVencida) : 0 };
}
