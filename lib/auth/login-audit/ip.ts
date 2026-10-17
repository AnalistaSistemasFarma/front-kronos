/**
 * Clasificación de la IP del inicio de sesión — PURA (sin red, sin BD).
 *
 * La IP ya llega limpia (sin el `:puerto` que agrega IIS/ARR) desde
 * lib/chat/client-origin.ts, la misma utilidad que usa la auditoría de agentes.
 * Aquí solo se decide si es una red interna (no se geolocaliza: se marca
 * «Red interna») o una dirección pública.
 */
import type { IpScope } from './constants';

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isInternalIpv4([a, b]: number[]): boolean {
  return (
    a === 10 || // 10.0.0.0/8
    a === 127 || // loopback
    a === 0 || // «esta red»
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) || // enlace local
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64.0.0/10
  );
}

/** Normaliza la IP: minúsculas, sin zona IPv6 (`%eth0`) y con IPv4 mapeada desempaquetada. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim().toLowerCase();
  if (!ip) return null;
  const zone = ip.indexOf('%');
  if (zone > 0) ip = ip.slice(0, zone);
  if (ip.startsWith('::ffff:') && parseIpv4(ip.slice(7))) ip = ip.slice(7);
  return ip;
}

/** ¿La IP es de una red privada, de loopback o de enlace local? */
export function classifyIp(raw: string | null | undefined): IpScope {
  const ip = normalizeIp(raw);
  if (!ip) return 'DESCONOCIDA';

  const v4 = parseIpv4(ip);
  if (v4) return isInternalIpv4(v4) ? 'INTERNA' : 'PUBLICA';

  if (!ip.includes(':') || !/^[0-9a-f:.]+$/.test(ip)) return 'DESCONOCIDA';
  if (ip === '::1' || ip === '::') return 'INTERNA';
  // fc00::/7 (únicas locales: fc.. y fd..) y fe80::/10 (enlace local).
  if (/^f[cd][0-9a-f]{0,2}:/.test(ip) || /^fe[89ab][0-9a-f]?:/.test(ip)) return 'INTERNA';
  return 'PUBLICA';
}
