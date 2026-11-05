/**
 * Pista legible para los errores que devuelve SAP al crear o enviar una solicitud
 * de compra. PURA. Mismas reglas de SAPSEND para el periodo contable
 * (utils.js detectPostingPeriodLocked) y además la falta de TRM.
 */
export function sapErrorHint(message: string): string | null {
  const m = String(message || '').toLowerCase();
  const periodLocked =
    (m.includes('posting period') && m.includes('lock')) ||
    m.includes('specify an alternative date') ||
    ((m.includes('periodo de contabil') || m.includes('período de contabil')) && m.includes('bloque'));
  if (periodLocked) {
    return 'El periodo contable de esta fecha parece estar cerrado en SAP. Pida a Contabilidad que lo abra o use otra fecha.';
  }
  const noRate =
    m.includes('exchange rate') ||
    m.includes('tipo de cambio') ||
    m.includes('tasa de cambio') ||
    m.includes('update the rate');
  if (noRate) {
    return 'No hay TRM (tipo de cambio) cargada en SAP para esta fecha. Pida a Contabilidad que la cargue y vuelva a intentarlo.';
  }
  return null;
}

/** Texto del aviso: el mensaje de SAP y, si se reconoce, la pista. */
export function sapErrorText(message: string): string {
  const hint = sapErrorHint(message);
  return hint ? `${message}\n\n${hint}` : message;
}
