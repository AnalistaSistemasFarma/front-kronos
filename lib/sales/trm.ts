import { sapPost, sapPostText, SapError, type SapSession } from '../sap/serviceLayer';

/**
 * Regla de negocio (Nicolás Rivera, 2026-11-05): «si la TRM del día no está cargada en
 * SAP, SynerLink no debe permitir autorizar». La moneda del sistema de las bases (USD en
 * OLP) exige la tasa del día para crear el pedido; si falta, SAP responde −4006
 * («Update the exchange rate») recién al crear la orden, con la oferta ya autorizada.
 *
 * Se consulta por empresa con la sesión SAP que ya usa el módulo. Solo se guarda en caché
 * la tasa encontrada (unos minutos): una TRM que falta se vuelve a consultar cada vez, para
 * que el bloqueo se levante apenas la carguen.
 */

const RATE_TTL_MS = 10 * 60 * 1000;
const CURRENCY_TTL_MS = 60 * 60 * 1000;

const rateCache = new Map<string, number>(); // `${empresa}|${fecha}` -> expira
const currencyCache = new Map<number, { system: string; local: string; exp: number }>();

/** «2026-11-05» -> «05/11/2026». PURA. */
export function fechaDMY(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Mensaje del bloqueo (se muestra tal cual en la UI). PURA. */
export function trmMissingMessage(isoDate: string): string {
  return `No hay TRM cargada en SAP para hoy (${fechaDMY(isoDate)}). Cárguela antes de autorizar.`;
}

/** ¿El error de SAP es «falta la tasa de cambio» (−4006)? PURA. */
export function isMissingRateError(e: unknown): boolean {
  if (!(e instanceof SapError)) return false;
  if (/"code"\s*:\s*-4006\b/.test(e.detail ?? '')) return true;
  return /update the exchange rate/i.test(`${e.message} ${e.detail ?? ''}`);
}

/**
 * Tasa que devuelve SBOBobService_GetCurrencyRate. El Service Layer la manda como TEXTO
 * PLANO (`3221.190000`, verificado en pruebas OLP 2026-11-05); se toleran comillas o un
 * cuerpo JSON numérico por si una versión de SAP lo cambia. NaN si no es un número. PURA.
 */
export function parseRate(body: unknown): number {
  if (typeof body === 'number') return body;
  const t = String(body ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
  if (!t || !/^[-\d.]+$/.test(t)) return NaN;
  return Number(t); // «1.2.3» o «-» → NaN
}

/**
 * Monedas de la empresa. Se leen de CompanyService_GetAdminInfo (POST; responde JSON con
 * LocalCurrency y SystemCurrency). NO se usan SBOBobService_GetSystemCurrency /
 * GetLocalCurrency: responden texto plano (`USD`, `COP`) y rompían con «"COP" is not valid
 * JSON» (sales_authorization 31, borrador 903, pruebas 2026-11-05).
 */
async function currenciesOf(sap: SapSession, idCompany: number): Promise<{ system: string; local: string }> {
  const hit = currencyCache.get(idCompany);
  if (hit && hit.exp > Date.now()) return hit;
  const info = await sapPost<{ LocalCurrency?: string | null; SystemCurrency?: string | null }>(sap, 'CompanyService_GetAdminInfo', {});
  const v = { system: String(info?.SystemCurrency ?? '').trim(), local: String(info?.LocalCurrency ?? '').trim(), exp: Date.now() + CURRENCY_TTL_MS };
  currencyCache.set(idCompany, v);
  return v;
}

/**
 * Devuelve el mensaje de bloqueo si NO hay TRM de la moneda del sistema para `isoDate`, o
 * null si la hay (o si la moneda del sistema es la local: no aplica). Otros errores de SAP
 * (conexión, sesión) se lanzan: quien llama decide.
 */
export async function trmBlock(sap: SapSession, idCompany: number, isoDate: string): Promise<string | null> {
  const key = `${idCompany}|${isoDate}`;
  const exp = rateCache.get(key);
  if (exp && exp > Date.now()) return null;
  const { system, local } = await currenciesOf(sap, idCompany);
  if (!system || system === local) return null;
  try {
    const rate = parseRate(await sapPostText(sap, 'SBOBobService_GetCurrencyRate', { Currency: system, Date: isoDate }));
    if (!Number.isFinite(rate) || rate <= 0) return trmMissingMessage(isoDate);
    rateCache.set(key, Date.now() + RATE_TTL_MS);
    return null;
  } catch (e) {
    if (isMissingRateError(e)) return trmMissingMessage(isoDate);
    throw e;
  }
}

/** Solo pruebas. */
export function __resetTrmCache() {
  rateCache.clear();
  currencyCache.clear();
}
