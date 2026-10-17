/**
 * Lectura del user agent — PURA y SIN DEPENDENCIAS.
 *
 * Se escribió a mano a propósito: la librería habitual (ua-parser-js) cambió a
 * licencia AGPL en su versión 2 y agregarla obligaba a otra dependencia nueva.
 * Para una auditoría basta con la familia del navegador, del sistema y el tipo
 * de dispositivo; el texto original se guarda completo (recortado a 400) por si
 * hay que revisarlo a fondo.
 *
 * Solo búsquedas de texto y expresiones sin cuantificadores anidados: el valor
 * viene de una cabecera que cualquiera puede llenar (ReDoS).
 */

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  device: 'Escritorio' | 'Celular' | 'Tableta' | 'Bot' | null;
}

function version(ua: string, token: string): string {
  const at = ua.indexOf(token);
  if (at < 0) return '';
  const match = /^(\d+)/.exec(ua.slice(at + token.length, at + token.length + 12));
  return match ? ` ${match[1]}` : '';
}

function detectBrowser(ua: string): string | null {
  if (ua.includes('Edg/')) return `Edge${version(ua, 'Edg/')}`;
  if (ua.includes('EdgiOS/')) return `Edge${version(ua, 'EdgiOS/')}`;
  if (ua.includes('EdgA/')) return `Edge${version(ua, 'EdgA/')}`;
  if (ua.includes('OPR/')) return `Opera${version(ua, 'OPR/')}`;
  if (ua.includes('SamsungBrowser/')) return `Samsung Internet${version(ua, 'SamsungBrowser/')}`;
  if (ua.includes('Firefox/')) return `Firefox${version(ua, 'Firefox/')}`;
  if (ua.includes('FxiOS/')) return `Firefox${version(ua, 'FxiOS/')}`;
  if (ua.includes('CriOS/')) return `Chrome${version(ua, 'CriOS/')}`;
  if (ua.includes('Chrome/')) return `Chrome${version(ua, 'Chrome/')}`;
  if (ua.includes('Safari/') && ua.includes('Version/')) return `Safari${version(ua, 'Version/')}`;
  if (ua.includes('Trident/') || ua.includes('MSIE ')) return 'Internet Explorer';
  if (ua.includes('curl/')) return 'curl';
  if (ua.includes('PostmanRuntime/')) return 'Postman';
  if (ua.includes('python-requests/')) return 'Python requests';
  if (ua.includes('node-fetch') || ua.includes('undici')) return 'Node.js';
  return null;
}

function detectOs(ua: string): string | null {
  if (ua.includes('Windows NT 10.0')) return 'Windows 10/11';
  if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
  if (ua.includes('Windows NT 6.1')) return 'Windows 7';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('iPhone') || ua.includes('iPad') || ua.includes('iPod')) {
    const m = /OS (\d+)_/.exec(ua);
    return m ? `iOS ${m[1]}` : 'iOS';
  }
  if (ua.includes('Android')) {
    const m = /Android (\d+)/.exec(ua);
    return m ? `Android ${m[1]}` : 'Android';
  }
  if (ua.includes('CrOS')) return 'ChromeOS';
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  return null;
}

function detectDevice(ua: string): ParsedUserAgent['device'] {
  const lower = ua.toLowerCase();
  if (lower.includes('bot') || lower.includes('crawler') || lower.includes('spider')) return 'Bot';
  if (ua.includes('iPad') || ua.includes('Tablet') || (ua.includes('Android') && !ua.includes('Mobile'))) {
    return 'Tableta';
  }
  if (ua.includes('Mobi') || ua.includes('iPhone') || ua.includes('iPod')) return 'Celular';
  if (ua.includes('Windows') || ua.includes('Macintosh') || ua.includes('Linux') || ua.includes('CrOS')) {
    return 'Escritorio';
  }
  return null;
}

export function parseUserAgent(raw: string | null | undefined): ParsedUserAgent {
  const ua = (raw ?? '').slice(0, 1000);
  if (!ua.trim()) return { browser: null, os: null, device: null };
  return { browser: detectBrowser(ua), os: detectOs(ua), device: detectDevice(ua) };
}
