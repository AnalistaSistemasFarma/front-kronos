/**
 * Normalización de rutas para el Monitor del sistema.
 *
 * Las URLs reales traen ids, tokens y query strings (`/api/requests-general/view-request?id=812`,
 * `/process/orion-documents/3f2a…`). Si se guardaran tal cual habría miles de "rutas" distintas
 * con 1 petición cada una y las estadísticas no dirían nada. Aquí se reducen a una clave estable
 * (`/api/requests-general/view-request`, `/process/orion-documents/:id`) y a un módulo para
 * agrupar (`requests-general`, `orion`).
 */

const MAX_SEGMENTS = 6;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
const EMAIL_RE = /^[^@\s/]+@[^@\s/]+$/;
const FILE_EXT_RE = /\.([a-z0-9]{1,8})$/i;

/** Segmento que parece un id/token (largo, mezcla letras y dígitos) y no un nombre de ruta. */
function looksLikeToken(segment: string): boolean {
  if (segment.length < 16) return false;
  if (!/\d/.test(segment)) return false;
  return /^[A-Za-z0-9_\-.~%=]+$/.test(segment);
}

function normalizeSegment(raw: string): string {
  let segment = raw;
  try {
    segment = decodeURIComponent(raw);
  } catch {
    /* segmento mal codificado: se usa tal cual */
  }
  if (NUMERIC_RE.test(segment) || UUID_RE.test(segment)) return ':id';
  if (EMAIL_RE.test(segment)) return ':email';
  if (looksLikeToken(segment)) return ':token';
  return segment.toLowerCase();
}

export type RouteKeyInfo = {
  /** Ruta normalizada sin método (`/api/chat/conversations/:id`). */
  path: string;
  /** Módulo para agrupar (`chat`, `orion`, `estaticos`…). */
  module: string;
};

/** Normaliza el `req.url` de una petición entrante. */
export function normalizeRoutePath(url: string | undefined | null): RouteKeyInfo {
  const raw = String(url || '/');
  const pathOnly = raw.split(/[?#]/, 1)[0] || '/';

  if (pathOnly.startsWith('/_next/static/') || pathOnly.startsWith('/_next/webpack')) {
    return { path: '/_next/static/*', module: 'estaticos' };
  }
  if (pathOnly.startsWith('/_next/image')) {
    return { path: '/_next/image', module: 'estaticos' };
  }
  if (pathOnly.startsWith('/_next/data/')) {
    return { path: '/_next/data/*', module: 'estaticos' };
  }

  const segments = pathOnly.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  const ext = FILE_EXT_RE.exec(last)?.[1]?.toLowerCase();
  // Archivos públicos (íconos, manifest, sw.js…). Las rutas de API nunca terminan en extensión.
  if (ext && segments[0] !== 'api') {
    return { path: `/*.${ext}`, module: 'estaticos' };
  }

  const normalized = segments.slice(0, MAX_SEGMENTS).map(normalizeSegment);
  if (segments.length > MAX_SEGMENTS) normalized.push('*');

  return {
    path: normalized.length ? `/${normalized.join('/')}` : '/',
    module: moduleFromSegments(normalized),
  };
}

function moduleFromSegments(segments: string[]): string {
  if (segments.length === 0) return 'inicio';
  const [first, second, third] = segments;
  if (first === 'api') {
    if (second === 'integrations' && third) return third;
    return second ?? 'api';
  }
  if (first === 'process' && second) return second;
  return first;
}

/**
 * Clave de una llamada saliente (Graph, Orion, SAP…): se agrupa por host, que es lo que
 * interesa para saber qué servicio externo está lento o limitando (429).
 */
export function normalizeOutboundHost(origin: string | undefined | null, hostHeader?: string | null): string {
  const value = String(origin || hostHeader || '').trim();
  if (!value) return '(desconocido)';
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    return url.host.toLowerCase();
  } catch {
    return value.toLowerCase().slice(0, 200);
  }
}

/** Nombres legibles de los módulos más comunes (el resto se muestra con su clave). */
const MODULE_LABELS: Record<string, string> = {
  'requests-general': 'Solicitudes generales',
  'request-general': 'Solicitudes generales',
  orion: 'Firma electrónica (Orion)',
  'orion-documents': 'Firma electrónica (Orion)',
  firma: 'Firma electrónica (Orion)',
  'help-desk': 'Help desk',
  assets: 'Help desk',
  chat: 'Chat / Asistentes IA',
  sgc: 'SGC documental',
  'sgc-documental': 'SGC documental',
  auth: 'Inicio de sesión',
  login: 'Inicio de sesión',
  notifications: 'Notificaciones',
  push: 'Notificaciones',
  dashboard: 'Dashboard',
  authorization: 'Autorizaciones',
  'payment-scheduling': 'Tesorería / pagos',
  'working-capital': 'Tesorería / pagos',
  'payment-assistant': 'Asistente de pagos',
  sapsend: 'Integración SAP',
  'business-partners': 'Socios de negocio (SAP)',
  purchases: 'Compras',
  'purchase-request': 'Compras',
  portal: 'Portal de formación',
  proveedor: 'Portal de proveedores',
  'custom-views': 'Vistas personalizadas',
  organigrama: 'Organigrama',
  'system-metrics': 'Monitor del sistema',
  estaticos: 'Archivos estáticos',
  inicio: 'Inicio',
};

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}

/** Hosts externos conocidos → nombre legible. */
export function outboundHostLabel(host: string, orionHost?: string | null): string {
  const h = host.toLowerCase();
  if (orionHost && h === orionHost.toLowerCase()) return 'Orion (firma)';
  if (h.includes('trycloudflare.com')) return 'Orion / túnel Cloudflare';
  if (h === 'graph.microsoft.com') return 'Microsoft Graph (OneDrive, SharePoint, correo)';
  if (h === 'login.microsoftonline.com') return 'Microsoft (login)';
  if (h.endsWith(':50000') || h.includes('b1s')) return 'SAP Service Layer';
  if (h.includes('api.anthropic.com') || h.includes('openai.com')) return 'Servicio de IA';
  return host;
}
