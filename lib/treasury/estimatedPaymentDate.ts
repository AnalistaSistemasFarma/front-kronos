/**
 * Fecha ESTIMADA de pago de una solicitud de tesorería, calculada al vuelo a
 * partir de la fecha de creación. No se guarda en ningún lado: es solo una
 * proyección para mostrar en la UI.
 *
 * Espejo de la lógica legacy `utils/treasury/getNextPaymentDate.js`, con una
 * única traducción: allá el día de pago dependía de la BASE DE DATOS destino;
 * aquí hay una sola base, así que depende de la EMPRESA de la solicitud.
 *
 * Regla semanal (igual para todas las empresas):
 *   - Creadas Lun/Mar → pagan la semana siguiente (+1)
 *   - Creadas Mié–Dom → pagan la semana subsiguiente (+2)
 *
 * Día de pago dentro de la semana destino (según la empresa):
 *   - Farmalógica, ONELATAMONCO, KELAB → jueves
 *   - LABORATORIOS RYAN → martes
 *   - Resto de empresas → miércoles (default)
 *
 * Nota de zona horaria: el driver mssql serializa los datetime de SQL Server
 * (hora local CO, sin tz) colocando esa "hora de pared" en los campos UTC del
 * Date. Por eso el cálculo trabaja en UTC (`getUTC*`/`setUTC*`): así el día de
 * la semana coincide con el día real de creación en Colombia, sin depender de
 * la zona horaria del navegador. El resultado también queda a las 00:00 UTC,
 * para formatearse con `timeZone: 'UTC'` y no correrse un día.
 */

// Día de pago por defecto: miércoles (3). Días: Dom=0..Sáb=6.
const DEFAULT_PAY_DOW = 3; // Miércoles

// Reglas empresa → día de pago. Se evalúan en orden; la primera que coincida
// (por coincidencia en el nombre de la empresa, sin tildes/mayúsculas) gana.
const PAY_DOW_RULES: { test: RegExp; dow: number }[] = [
  { test: /laboratorios\s*ryan/i, dow: 2 }, // Martes
  { test: /onelatamonco/i, dow: 4 }, // Jueves
  { test: /kelab/i, dow: 4 }, // Jueves
  { test: /farmal[oó]gica/i, dow: 4 }, // Jueves
];

/** Día de la semana (0=Dom..6=Sáb) en que paga la empresa indicada. */
export function getPaymentDayOfWeek(company?: string | null): number {
  const name = String(company ?? '');
  const rule = PAY_DOW_RULES.find((r) => r.test.test(name));
  return rule ? rule.dow : DEFAULT_PAY_DOW;
}

/** True si la empresa es Farmalógica (paga jueves). */
export function isFarmalogicaCompany(company?: string | null): boolean {
  return /farmal[oó]gica/i.test(String(company ?? ''));
}

/**
 * Devuelve la fecha estimada de pago (a las 00:00 UTC) o `null` si no hay una
 * fecha de creación válida.
 */
export function getEstimatedPaymentDate(
  company: string | null | undefined,
  createdAt: string | Date | null | undefined
): Date | null {
  if (!createdAt) return null;
  const raw = new Date(createdAt);
  if (Number.isNaN(raw.getTime())) return null;

  // Día de creación (hora de pared CO) leído desde los campos UTC del Date.
  const base = new Date(
    Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate())
  );

  const dow = base.getUTCDay(); // 0=Dom..6=Sáb
  const daysSinceMonday = (dow + 6) % 7; // Lun=0..Dom=6
  const weeksToAdd = dow === 1 || dow === 2 ? 1 : 2; // Lun/Mar → +1, resto → +2
  const payDow = getPaymentDayOfWeek(company); // según la empresa
  const offsetFromMonday = payDow - 1; // Mar=1, Mié=2, Jue=3

  base.setUTCDate(
    base.getUTCDate() - daysSinceMonday + weeksToAdd * 7 + offsetFromMonday
  );
  return base;
}

/**
 * Etiqueta lista para pintar en la UI (ej. "jueves, 8 de octubre de 2026").
 * Devuelve `fallback` ('—' por defecto) si no se puede calcular.
 */
export function formatEstimatedPaymentDate(
  company: string | null | undefined,
  createdAt: string | Date | null | undefined,
  fallback = '—'
): string {
  const date = getEstimatedPaymentDate(company, createdAt);
  if (!date) return fallback;
  try {
    return new Intl.DateTimeFormat('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return fallback;
  }
}

/**
 * Igual que `formatEstimatedPaymentDate` pero sin el día de la semana
 * (ej. "8 de octubre de 2026"). Útil para reportes/Excel.
 */
export function formatEstimatedPaymentDateShort(
  company: string | null | undefined,
  createdAt: string | Date | null | undefined,
  fallback = ''
): string {
  const date = getEstimatedPaymentDate(company, createdAt);
  if (!date) return fallback;
  try {
    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return fallback;
  }
}
