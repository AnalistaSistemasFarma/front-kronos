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

// Pruebas puede mandar a un proyecto aparte de Sentry si se define
// SENTRY_DSN_TESTING (servidor) o NEXT_PUBLIC_SENTRY_DSN_TESTING (navegador,
// se incrusta al compilar). Es opcional: sin ellas se usa el DSN de siempre.
export function sentryDsn(environment: string): string {
  if (environment === 'testing') {
    const testingDsn = process.env.SENTRY_DSN_TESTING || process.env.NEXT_PUBLIC_SENTRY_DSN_TESTING;
    if (testingDsn) return testingDsn;
  }
  return SENTRY_DSN;
}

// Muestreo de trazas (2026-10-01): la cuota de spans del plan se agotó por el
// sondeo. Producción sigue en 10 %; pruebas baja a 1 %.
export const TRACES_RATE_PRODUCTION = 0.1;
export const TRACES_RATE_TESTING = 0.01;

// Rutas de sondeo periódico o long-poll: se llaman cada pocos segundos (los bots
// esperan en /agent/inbox consultando la base cada 400 ms) y cada solicitud
// generaba cientos de spans. No se trazan nunca; sus ERRORES sí se siguen
// reportando, porque el muestreo de errores no cambia.
const POLLING_ROUTES: RegExp[] = [
  /^\/api\/chat\/agent\/(inbox|voice|ack)\/?$/,
  /^\/api\/chat\/conversations\/[^/]+\/(poll|voice)\/?$/,
  /^\/api\/chat\/conversations\/?$/,
  /^\/api\/chat\/pulse\/?$/,
  /^\/api\/notifications\/?$/,
  /^\/api\/balances\/runs\/?$/,
  /^\/api\/valentine-wall\/?$/,
];

// Saca la ruta (sin dominio ni query) de un nombre de span tipo "GET /api/x?y=1"
// o de una URL completa.
function pathOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  let candidate = value.trim();
  const space = candidate.indexOf(' ');
  if (space > 0 && /^[A-Z]+$/.test(candidate.slice(0, space))) candidate = candidate.slice(space + 1);
  candidate = candidate.replace(/^[a-z]+:\/\/[^/]+/i, '');
  candidate = candidate.split(/[?#]/)[0];
  return candidate.startsWith('/') ? candidate : undefined;
}

export function isPollingPath(value: unknown): boolean {
  const path = pathOf(value);
  return Boolean(path) && POLLING_ROUTES.some((route) => route.test(path as string));
}

type SamplingContextLike = {
  name?: string;
  attributes?: Record<string, unknown>;
  normalizedRequest?: { url?: string };
  parentSampled?: boolean;
};

export function makeTracesSampler(rate: number) {
  return (context: SamplingContextLike): number => {
    const attrs = context.attributes ?? {};
    const candidates = [
      context.name,
      attrs['http.route'],
      attrs['url.path'],
      attrs['http.target'],
      attrs['url.full'],
      attrs['http.url'],
      context.normalizedRequest?.url,
    ];
    if (candidates.some(isPollingPath)) return 0;
    // Si la traza viene de otro servicio o del navegador, se respeta su decisión.
    if (typeof context.parentSampled === 'boolean') return context.parentSampled ? 1 : 0;
    return rate;
  };
}

// Spans que no se envían aunque la traza esté muestreada:
// - prisma:* — cada consulta generaba ~7 spans (se quita además la integración).
// - las llamadas del navegador a las rutas de sondeo (http.client), que colgaban
//   de la carga de página.
const IGNORED_SPANS = [
  /^prisma:/,
  { op: 'http.client', name: /\/api\/chat\/agent\/(inbox|voice|ack)([?]|$)/ },
  { op: 'http.client', name: /\/api\/chat\/(pulse|conversations)([?]|$)/ },
  { op: 'http.client', name: /\/api\/chat\/conversations\/[^/?]+\/(poll|voice)([?]|$)/ },
  { op: 'http.client', name: /\/api\/(notifications|balances\/runs|valentine-wall)([?]|$)/ },
];

const environment = sentryEnvironment();
const tracesRate = environment === 'testing' ? TRACES_RATE_TESTING : TRACES_RATE_PRODUCTION;

// Opciones comunes: sin PII (mensajes del chat, adjuntos y datos de usuarios no
// se envian), sin session replay y con muestreo bajo de trazas.
export const sentryBaseOptions = {
  dsn: sentryDsn(environment),
  enabled: Boolean(sentryDsn(environment)) && process.env.NODE_ENV === 'production',
  environment,
  sendDefaultPii: false,
  tracesSampleRate: tracesRate,
  tracesSampler: makeTracesSampler(tracesRate),
  ignoreSpans: IGNORED_SPANS,
  // La integración de Prisma (activa por defecto en el servidor) es la que crea
  // los spans prisma:*; sin ella no se generan. En navegador y edge no existe.
  integrations: <T extends { name: string }>(defaults: T[]): T[] =>
    defaults.filter((integration) => integration.name !== 'Prisma'),
};
