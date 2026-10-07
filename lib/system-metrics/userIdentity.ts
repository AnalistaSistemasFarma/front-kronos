/**
 * Quién hizo cada petición (Monitor del sistema → "Consumo por usuario").
 *
 * La sesión de Kronos es un JWT de next-auth guardado en la cookie `next-auth.session-token`
 * (o `__Secure-next-auth.session-token` en https; si es muy grande se parte en `.0`, `.1`…).
 * El colector lee la cookie al empezar la petición (solo texto, sin descifrar) y descifra el
 * token UNA vez por token distinto: el resultado queda en caché, así que el costo por petición
 * es buscar en un Map.
 */

const COOKIE_NAMES = ['__Secure-next-auth.session-token', 'next-auth.session-token'];

/** Extrae el token de sesión del encabezado Cookie (une los trozos `.0`, `.1`… si los hay). */
export function sessionTokenFromCookie(header: string | undefined | null): string | null {
  if (!header) return null;
  const cookies = new Map<string, string>();
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name.includes('next-auth.session-token')) continue;
    cookies.set(name, part.slice(eq + 1).trim());
  }
  if (cookies.size === 0) return null;
  for (const name of COOKIE_NAMES) {
    const whole = cookies.get(name);
    if (whole) return whole;
    const chunks: string[] = [];
    for (let i = 0; cookies.has(`${name}.${i}`); i += 1) chunks.push(cookies.get(`${name}.${i}`)!);
    if (chunks.length) return chunks.join('');
  }
  return null;
}

export type MetricUser = { email: string; name: string | null };

type Decode = (token: string) => Promise<{ email?: unknown; name?: unknown } | null>;

/** Tope de tokens en caché; al pasarlo se descarta el más viejo. */
const MAX_CACHED = 5000;
/** Un token se vuelve a descifrar pasado este tiempo (por si el JWT expiró). */
const CACHE_TTL_MS = 30 * 60_000;

/**
 * Caché token → usuario. `null` = token inválido o sin correo (se cachea igual para no
 * descifrarlo en cada petición).
 */
export class UserIdentityCache {
  private cache = new Map<string, { user: MetricUser | null; at: number }>();
  private pending = new Map<string, Promise<MetricUser | null>>();

  constructor(
    private readonly decode: Decode,
    private readonly now: () => number = Date.now
  ) {}

  /** Usuario ya conocido (sin esperar); `undefined` si todavía no se descifró. */
  peek(token: string): MetricUser | null | undefined {
    const hit = this.cache.get(token);
    if (!hit) return undefined;
    if (this.now() - hit.at > CACHE_TTL_MS) {
      this.cache.delete(token);
      return undefined;
    }
    return hit.user;
  }

  resolve(token: string): Promise<MetricUser | null> {
    const known = this.peek(token);
    if (known !== undefined) return Promise.resolve(known);
    const inFlight = this.pending.get(token);
    if (inFlight) return inFlight;
    const job = this.decode(token)
      .then((payload) => {
        const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
        if (!email) return null;
        const name = typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : null;
        return { email, name };
      })
      .catch(() => null)
      .then((user) => {
        this.pending.delete(token);
        if (this.cache.size >= MAX_CACHED) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(token, { user, at: this.now() });
        return user;
      });
    this.pending.set(token, job);
    return job;
  }

  get size(): number {
    return this.cache.size;
  }
}
