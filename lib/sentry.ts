// Configuracion compartida de Sentry (proyecto kronos-synerlink, org farmalogica).
// El DSN es publico por diseno (viaja al navegador); se puede sobrescribir con
// NEXT_PUBLIC_SENTRY_DSN. Si se define vacio, Sentry queda desactivado.
const DEFAULT_DSN =
  'https://65a4cfdea426e8430f89282fc99d76d2@o4509124428562432.ingest.us.sentry.io/4512141905494016';

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? DEFAULT_DSN;

// Produccion corre en el puerto 3003 (serfarma05, groupsharedservices.farmalogica.com);
// pruebas en el 3030 (.230 + tunel). En local (next dev) queda "development".
export function sentryEnvironment(): string {
  if (process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT) return process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
  if (process.env.NODE_ENV !== 'production') return 'development';
  if (typeof window !== 'undefined') {
    return window.location.hostname === 'groupsharedservices.farmalogica.com' ? 'production' : 'testing';
  }
  return process.env.PORT === '3003' ? 'production' : 'testing';
}

// Opciones comunes: sin PII (mensajes del chat, adjuntos y datos de usuarios no
// se envian), sin session replay y con muestreo bajo de trazas.
export const sentryBaseOptions = {
  dsn: SENTRY_DSN,
  enabled: Boolean(SENTRY_DSN) && process.env.NODE_ENV === 'production',
  environment: sentryEnvironment(),
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
};
