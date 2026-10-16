/**
 * Origen de la petición (IP y navegador) para la auditoría del SGC.
 *
 * COPIA CONGELADA de lib/chat/client-origin.ts (2026-09-30), por el principio
 * del plan: lo que se sigue desarrollando en SynerLink general no se importa
 * desde el sistema validado; se copia y solo cambia por control de cambios
 * propio del SGC.
 *
 * front-kronos corre detrás del proxy de IIS (ARR), que manda la IP en
 * `x-forwarded-for` CON el puerto pegado (`192.168.10.20:54321`): se quita.
 * Si no llega, queda null (un dato falso es peor que uno ausente). Nunca se
 * toma del cuerpo de la petición.
 */

const MAX_USER_AGENT_CHARS = 400;
const MAX_IP_CHARS = 64;

/** Quita el puerto que agrega ARR (IPv4 o IPv6 entre corchetes), sin expresiones regulares ambiguas. */
export function stripPort(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('[')) {
    const cierre = value.indexOf(']');
    if (cierre > 1) return value.slice(1, cierre);
  }
  const parts = value.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return parts[0];
  return value;
}

export function readClientOrigin(request: Request): { clientIp: string | null; userAgent: string | null } {
  const headers = request.headers;
  let clientIp: string | null = null;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const clean = stripPort(forwarded.split(',')[0]);
    if (clean) clientIp = clean.slice(0, MAX_IP_CHARS);
  }
  if (!clientIp) {
    for (const name of ['x-real-ip', 'cf-connecting-ip', 'x-client-ip']) {
      const value = headers.get(name);
      if (!value) continue;
      const clean = stripPort(value);
      if (clean) {
        clientIp = clean.slice(0, MAX_IP_CHARS);
        break;
      }
    }
  }
  const rawAgent = headers.get('user-agent');
  const userAgent = rawAgent && rawAgent.trim() ? rawAgent.trim().slice(0, MAX_USER_AGENT_CHARS) : null;
  return { clientIp, userAgent };
}
