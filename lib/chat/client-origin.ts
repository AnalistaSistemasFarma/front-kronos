/**
 * ORIGEN DE LA CONEXIÓN de una petición — para la auditoría del chat.
 *
 * Pedido de Nicolás (2026-09-10): saber "la ip de dónde enviaron el mensaje".
 *
 * DE DÓNDE SALE. La aplicación NO ve el socket del cliente: corre en Node
 * detrás del proxy de IIS (ARR) del sitio `groupsharedservices` (:8445 →
 * localhost:3003). Lo único que llega es la cabecera que pone el proxy. La
 * configuración de ARR de serfarma05 tiene `xForwardedForHeaderName =
 * X-Forwarded-For` e `includePortInXForwardedFor = True`, así que el valor
 * llega como `192.168.10.20:54321` — CON PUERTO, que hay que quitar o la
 * columna termina guardando algo que no es una dirección.
 *
 * SI NO LLEGA, QUEDA NULL. No se inventa un valor ni se pone "desconocida":
 * en una auditoría un dato falso es peor que un dato ausente, porque el
 * ausente se nota y el falso se cree.
 *
 * NUNCA DEL PAYLOAD. La IP no se acepta del cuerpo de la petición: eso sería
 * dejar que cada quien declare desde dónde escribió.
 */

/** Tope de la columna chat_message.user_agent. */
const MAX_USER_AGENT_CHARS = 400;
/** Tope de la columna chat_message.client_ip. */
const MAX_IP_CHARS = 64;

/**
 * Quita el puerto que ARR agrega y normaliza la forma.
 *
 * IPv4: `192.168.10.20:54321` → `192.168.10.20`.
 * IPv6 entre corchetes: `[2001:db8::1]:54321` → `2001:db8::1`.
 * IPv6 sin corchetes: se deja tal cual — tiene varios ':' y no hay forma de
 * saber si el último es puerto o parte de la dirección; partirlo la dañaría.
 */
function stripPort(raw: string): string {
  const value = raw.trim();
  if (!value) return '';

  const bracketed = value.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];

  const parts = value.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return parts[0];

  return value;
}

/**
 * IP y navegador de quien hizo la petición.
 *
 * `x-forwarded-for` puede traer una cadena de direcciones cuando hay varios
 * proxies (`cliente, proxy1, proxy2`). Se toma la PRIMERA, que es la del
 * cliente. Ojo: esa cabecera la puede falsificar quien llegue directo al
 * puerto interno, así que sirve para revisar, no como prueba forense.
 */
export function readClientOrigin(request: Request): {
  clientIp: string | null;
  userAgent: string | null;
} {
  const headers = request.headers;

  let clientIp: string | null = null;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    const clean = stripPort(first);
    if (clean) clientIp = clean.slice(0, MAX_IP_CHARS);
  }
  if (!clientIp) {
    // Alternativas de otros proxies, por si algún día la aplicación queda
    // detrás de nginx o de un túnel en vez de IIS.
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
