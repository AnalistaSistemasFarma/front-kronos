/**
 * Motor de reglas PURO de la oferta de venta. Decide a donde va un borrador al
 * enviarlo: autorizacion de precios (AP), extracupo (AE) o pedido directo.
 *
 * Reglas de negocio (Nicolas Rivera, 2026-10-27 y 2026-10-30):
 *  - OLP valida SOLO el cupo (sin autorizacion de precios).
 *  - Las demas compañias (Farmalogica, Ryan, Abamia, Meditrack, Kelab, GSS)
 *    validan precio y cupo con las mismas reglas.
 * Eso se expresa por empresa con `validaPrecio`; el motor no conoce empresas.
 *
 * Cupo (igual a SAPSEND, useSendToApproveQuotation.jsx):
 *   saldo + remisiones abiertas + pedidos abiertos + ofertas del cliente en
 *   autorizacion de cupo + total de esta oferta  >  limite * (1 + tolerancia%)
 * Diferencia deliberada: SAPSEND sumaba las otras ofertas filtrando UserSign 50
 * (inexistente en OLP, la suma daba 0); aqui la suma llega ya calculada por
 * cliente, sin filtro de usuario y sin contar la propia oferta.
 *
 * Precio: SAPSEND marcaba cualquier diferencia contra U_SEND_PriceLP (en los dos
 * sentidos y con PriceLP vacio como diferencia). Se conserva por defecto; la
 * opcion `precioSoloSiMenor` permite pedir autorizacion solo por precio menor.
 */

export interface SalesRulesConfig {
  /** Activa la regla y la etapa de precios. OLP = false. */
  validaPrecio: boolean;
  /** Si es true, solo un precio MENOR al de lista pide autorizacion. */
  precioSoloSiMenor: boolean;
  /** Diferencia permitida (en moneda) antes de pedir autorizacion de precio. */
  toleranciaPrecio: number;
  /** Margen sobre el limite de credito, en porcentaje (SAPSEND: 20). */
  pctToleranciaCupo: number;
  /** Decimales de la moneda para comparar precios. */
  decimales: number;
}

export const DEFAULT_RULES: SalesRulesConfig = {
  validaPrecio: true,
  precioSoloSiMenor: false,
  toleranciaPrecio: 0,
  pctToleranciaCupo: 20,
  decimales: 2,
};

export interface SalesLine {
  itemCode: string;
  unitPrice: number;
  /** Precio de lista (U_SEND_PriceLP); null si no se conoce. */
  listPrice: number | null;
}

export interface ClientBalances {
  creditLimit: number;
  currentAccountBalance: number;
  openDeliveryNotesBalance: number;
  openOrdersBalance: number;
}

export interface CupoInput {
  client: ClientBalances;
  /** Suma de las OTRAS ofertas abiertas del cliente en autorizacion de cupo (AE y AEDA por defecto). */
  otrasOfertasEnCupo: number;
  /** Total de la oferta evaluada. */
  docTotal: number;
}

export interface PrecioObservado {
  itemCode: string;
  unitPrice: number;
  listPrice: number | null;
}

export interface CupoDetalle {
  comprometido: number;
  limite: number;
  excede: boolean;
}

export type Destino = 'AP' | 'AE' | 'PEDIDO';

export interface Evaluacion {
  destino: Destino;
  requierePrecio: boolean;
  requiereCupo: boolean;
  lineasConPrecio: PrecioObservado[];
  cupo: CupoDetalle;
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/** Lineas cuyo precio requiere autorizacion. Vacio si la empresa no valida precio. */
export function lineasConDiferenciaDePrecio(
  lines: SalesLine[],
  cfg: SalesRulesConfig = DEFAULT_RULES
): PrecioObservado[] {
  if (!cfg.validaPrecio) return [];
  return lines
    .filter((l) => {
      if (l.listPrice == null) return true;
      const diff = round(n(l.unitPrice), cfg.decimales) - round(n(l.listPrice), cfg.decimales);
      const tol = Math.abs(n(cfg.toleranciaPrecio));
      return cfg.precioSoloSiMenor ? diff < -tol : Math.abs(diff) > tol;
    })
    .map((l) => ({ itemCode: l.itemCode, unitPrice: n(l.unitPrice), listPrice: l.listPrice }));
}

/** Calculo del cupo comprometido contra el limite con tolerancia. */
export function evaluarCupo(input: CupoInput, cfg: SalesRulesConfig = DEFAULT_RULES): CupoDetalle {
  const c = input.client;
  const comprometido =
    n(c.currentAccountBalance) +
    n(c.openDeliveryNotesBalance) +
    n(c.openOrdersBalance) +
    n(input.otrasOfertasEnCupo) +
    n(input.docTotal);
  const limite = n(c.creditLimit) * (1 + n(cfg.pctToleranciaCupo) / 100);
  return { comprometido, limite, excede: comprometido > limite };
}

/** Evaluacion al ENVIAR o REENVIAR un borrador: precio primero, luego cupo. */
export function evaluarEnvio(
  lines: SalesLine[],
  cupo: CupoInput,
  cfg: SalesRulesConfig = DEFAULT_RULES
): Evaluacion {
  const lineasConPrecio = lineasConDiferenciaDePrecio(lines, cfg);
  const detalle = evaluarCupo(cupo, cfg);
  const requierePrecio = lineasConPrecio.length > 0;
  const destino: Destino = requierePrecio ? 'AP' : detalle.excede ? 'AE' : 'PEDIDO';
  return { destino, requierePrecio, requiereCupo: detalle.excede, lineasConPrecio, cupo: detalle };
}

/** Puerta de cupo al APROBAR PRECIOS: se recalcula el cupo con datos del momento. */
export function destinoTrasAprobarPrecios(
  cupo: CupoInput,
  cfg: SalesRulesConfig = DEFAULT_RULES
): { destino: Exclude<Destino, 'AP'>; cupo: CupoDetalle } {
  const detalle = evaluarCupo(cupo, cfg);
  return { destino: detalle.excede ? 'AE' : 'PEDIDO', cupo: detalle };
}

/** Validaciones de las lineas antes de evaluar (en SAPSEND solo existian en la UI). */
export function validarLineas(
  lines: { itemCode?: string; quantity?: unknown; unitPrice?: unknown }[]
): string[] {
  const errores: string[] = [];
  if (!lines.length) errores.push('La oferta no tiene lineas.');
  lines.forEach((l, i) => {
    const pos = i + 1;
    if (!l.itemCode || !String(l.itemCode).trim()) errores.push(`Linea ${pos}: falta el articulo.`);
    const q = Number(l.quantity);
    if (!Number.isFinite(q) || q <= 0) errores.push(`Linea ${pos}: la cantidad debe ser mayor que 0.`);
    const p = Number(l.unitPrice);
    if (!Number.isFinite(p) || p < 0) errores.push(`Linea ${pos}: el precio no puede ser negativo.`);
  });
  return errores;
}
