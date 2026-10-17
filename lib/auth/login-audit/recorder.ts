/**
 * REGISTRO de los intentos de inicio de sesión en dbo.user_login_audit.
 *
 * Regla de oro (diseño aprobado por Nicolás, 2026-10-16): el registro NUNCA
 * frena ni rompe el login. Por eso:
 *   - la escritura va DESPUÉS de construir la respuesta y fuera de su camino
 *     (setImmediate), así el usuario no espera a la base ni a la geolocalización;
 *   - todo va en try/catch; si la tabla no existe o la base falla, se escribe
 *     una línea en el log (como mucho una por minuto) y el login sigue.
 *
 * Privacidad: NUNCA se guarda la contraseña, el PIN ni un token. Solo el correo
 * o NIT que se escribió, el resultado y el origen de la conexión.
 *
 * Cómo se enlaza con NextAuth: la ruta /api/auth/[...nextauth] envuelve el
 * handler con `withLoginAudit`, que abre un contexto (AsyncLocalStorage) por
 * petición de callback. Dentro, `authorize` (credenciales / NIT) y el evento
 * `signIn` (Microsoft) dejan anotado QUIÉN intentó y POR QUÉ falló con
 * `noteLoginAttempt`. Al terminar, el envoltorio confirma el resultado con la
 * respuesta de NextAuth y programa UNA escritura por intento.
 */
import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readClientOrigin } from '../../chat/client-origin';
import { prisma } from '../../prisma';
import {
  LOGIN_AUDIT_LIMITS,
  type LoginFailureReason,
  type LoginProvider,
} from './constants';
import {
  callbackProviderFromUrl,
  csrfRejectedFromRedirectUrl,
  errorFromRedirectUrl,
  normalizeIdentifier,
} from './flow';
import { geolocateIp } from './geo';
import { parseUserAgent } from './user-agent';

export interface LoginAttemptNote {
  identifier: string | null;
  userId?: string | null;
  userName?: string | null;
  success: boolean;
  reason?: LoginFailureReason | null;
}

interface LoginAuditStore {
  provider: LoginProvider;
  clientIp: string | null;
  userAgent: string | null;
  attempt: LoginAttemptNote | null;
}

const storage = new AsyncLocalStorage<LoginAuditStore>();

/**
 * Anota el intento en curso. Sin contexto (p. ej. una prueba que llama a
 * authorize directo) no hace nada. Nunca lanza.
 */
export function noteLoginAttempt(note: LoginAttemptNote): void {
  try {
    const store = storage.getStore();
    if (!store) return;
    store.attempt = {
      ...note,
      identifier: normalizeIdentifier(note.identifier),
      userName: note.userName ? note.userName.slice(0, LOGIN_AUDIT_LIMITS.userName) : null,
    };
  } catch {
    /* nunca romper el login */
  }
}

// ---------------------------------------------------------------------------
// Tope de escrituras por IP: si alguien martilla el login, se guardan las
// primeras 60 por minuto (evidencia suficiente) y no se inunda la base.
// ---------------------------------------------------------------------------
const MAX_WRITES_PER_IP_PER_MINUTE = 60;
const writesByIp = new Map<string, { minute: number; count: number }>();

function allowWrite(ip: string | null): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const key = ip ?? 'sin-ip';
  const entry = writesByIp.get(key);
  if (!entry || entry.minute !== minute) {
    if (writesByIp.size > 5_000) writesByIp.clear();
    writesByIp.set(key, { minute, count: 1 });
    return true;
  }
  entry.count += 1;
  if (entry.count === MAX_WRITES_PER_IP_PER_MINUTE + 1) {
    console.warn(`[login-audit] Más de ${MAX_WRITES_PER_IP_PER_MINUTE} intentos/minuto desde ${key}: se omiten los siguientes de este minuto.`);
  }
  return entry.count <= MAX_WRITES_PER_IP_PER_MINUTE;
}

let lastErrorLogAt = 0;
function logWriteError(error: unknown) {
  const now = Date.now();
  if (now - lastErrorLogAt < 60_000) return;
  lastErrorLogAt = now;
  console.error(
    '[login-audit] No se pudo registrar el inicio de sesión (el login siguió normal):',
    error instanceof Error ? error.message : error
  );
}

function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

async function resolveUser(
  note: LoginAttemptNote
): Promise<{ userId: string | null; userName: string | null; companies: string | null }> {
  let userId = note.userId ?? null;
  let userName = note.userName ?? null;
  if (!userId && note.identifier && note.identifier.includes('@')) {
    const rows = await prisma.$queryRaw<Array<{ id: string; name: string | null }>>`
      SELECT TOP 1 id, name FROM [user]
      WHERE LOWER(LTRIM(RTRIM(email))) = ${note.identifier}
    `;
    userId = rows[0]?.id ?? null;
    userName = userName ?? rows[0]?.name ?? null;
  }
  if (!userId) return { userId: null, userName, companies: null };

  const companies = await prisma.$queryRaw<Array<{ company: string }>>`
    SELECT c.company
    FROM [company_user] cu
    INNER JOIN [company] c ON c.id_company = cu.id_company
    WHERE cu.id_user = ${userId}
    ORDER BY c.company
  `;
  const list = companies.map((c) => c.company).filter(Boolean).join(', ');
  return { userId, userName, companies: clip(list, LOGIN_AUDIT_LIMITS.companies) };
}

/** Escribe UNA fila. Nunca lanza. Exportada para las pruebas. */
export async function writeLoginAudit(
  provider: LoginProvider,
  note: LoginAttemptNote,
  origin: { clientIp: string | null; userAgent: string | null }
): Promise<void> {
  try {
    if (!allowWrite(origin.clientIp)) return;
    const geo = geolocateIp(origin.clientIp);
    const ua = parseUserAgent(origin.userAgent);
    const who = await resolveUser(note).catch((error) => {
      logWriteError(error);
      return { userId: note.userId ?? null, userName: note.userName ?? null, companies: null };
    });

    await prisma.$executeRaw`
      INSERT INTO [dbo].[user_login_audit]
        (provider, identifier, id_user, user_name, success, failure_reason,
         client_ip, ip_scope, country_code, country_name, region, city,
         user_agent, browser, os, device, companies)
      VALUES
        (${provider}, ${note.identifier}, ${who.userId}, ${clip(who.userName, LOGIN_AUDIT_LIMITS.userName)},
         ${note.success ? 1 : 0}, ${note.success ? null : (note.reason ?? 'ERROR_INTERNO')},
         ${clip(origin.clientIp, LOGIN_AUDIT_LIMITS.ip)}, ${geo.scope}, ${geo.countryCode}, ${geo.countryName},
         ${geo.region}, ${geo.city},
         ${clip(origin.userAgent, LOGIN_AUDIT_LIMITS.userAgent)}, ${clip(ua.browser, LOGIN_AUDIT_LIMITS.browser)},
         ${clip(ua.os, LOGIN_AUDIT_LIMITS.os)}, ${ua.device}, ${who.companies})
    `;
  } catch (error) {
    logWriteError(error);
  }
}

/**
 * Lo que hace falta de la respuesta de NextAuth para saber si terminó en error:
 * la cabecera Location o, con `redirect: false`, el JSON `{ url }`. Se toma
 * ANTES de devolver la respuesta (después Next ya está leyendo su cuerpo).
 */
interface ResponseProbe {
  location: string | null;
  json: Response | null;
}

function probeResponse(response: Response): ResponseProbe {
  const location = response.headers.get('location');
  if (location) return { location, json: null };
  const type = response.headers.get('content-type') ?? '';
  let json: Response | null = null;
  if (type.includes('application/json')) {
    try {
      json = response.clone();
    } catch {
      json = null;
    }
  }
  return { location: null, json };
}

async function redirectTarget(probe: ResponseProbe): Promise<string | null> {
  if (probe.location) return probe.location;
  if (!probe.json) return null;
  const body = (await probe.json.json().catch(() => null)) as { url?: unknown } | null;
  return typeof body?.url === 'string' ? body.url : null;
}

/**
 * Resultado cuando NADIE anotó el intento (ni `authorize` ni el evento `signIn`).
 *   - `?csrf=true` en la respuesta: NextAuth rechazó el POST por CSRF antes de
 *     llamar a `authorize` → FALLIDO, CSRF_INVALIDO.
 *   - credenciales / NIT: el único camino al éxito pasa por `authorize`, que
 *     siempre anota; si no hay anotación, no hubo validación → FALLIDO
 *     (ERROR_INTERNO si NextAuth trajo `?error=` o lanzó; si no, SIN_AUTORIZACION).
 *   - Microsoft: el éxito no siempre se anota; se decide por `?error=`.
 * Exportada para las pruebas.
 */
export function outcomeWithoutNote(
  provider: LoginProvider,
  error: string | null,
  csrfRejected: boolean
): Pick<LoginAttemptNote, 'success' | 'reason'> {
  if (csrfRejected) return { success: false, reason: 'CSRF_INVALIDO' };
  if (provider === 'azure-ad') {
    return error ? { success: false, reason: 'MICROSOFT_RECHAZADO' } : { success: true, reason: null };
  }
  return { success: false, reason: error ? 'ERROR_INTERNO' : 'SIN_AUTORIZACION' };
}

/** Decide el resultado final con lo anotado + la respuesta, y escribe. Nunca lanza. */
async function finalize(store: LoginAuditStore, probe: ResponseProbe | null): Promise<void> {
  try {
    const target = probe ? await redirectTarget(probe) : null;
    const error = probe ? errorFromRedirectUrl(target) : 'ERROR';
    let note = store.attempt;
    if (!note) {
      note = { identifier: null, ...outcomeWithoutNote(store.provider, error, csrfRejectedFromRedirectUrl(target)) };
    } else if (note.success && error) {
      // authorize aprobó pero NextAuth terminó en error: cuenta como fallo.
      note = { ...note, success: false, reason: 'ERROR_INTERNO' };
    }
    await writeLoginAudit(store.provider, note, store);
  } catch (error) {
    logWriteError(error);
  }
}

function schedule(store: LoginAuditStore, probe: ResponseProbe | null) {
  setImmediate(() => {
    void finalize(store, probe);
  });
}

/** Contexto de la ruta catch-all de NextAuth en el App Router de Next 15. */
export interface NextAuthRouteContext {
  params: Promise<{ nextauth: string[] }>;
}

type RouteHandler = (req: Request, ctx: NextAuthRouteContext) => Promise<Response> | Response;

/**
 * Envuelve el handler de NextAuth. Solo los callbacks de los proveedores
 * auditados abren contexto; el resto de rutas pasa directo, sin costo.
 */
export function withLoginAudit(handler: RouteHandler): RouteHandler {
  return async function auditedNextAuthHandler(req: Request, ctx: NextAuthRouteContext) {
    let store: LoginAuditStore | null = null;
    try {
      const provider = callbackProviderFromUrl(req.url);
      if (provider) {
        const origin = readClientOrigin(req);
        store = { provider, clientIp: origin.clientIp, userAgent: origin.userAgent, attempt: null };
      }
    } catch {
      store = null;
    }
    if (!store) return handler(req, ctx);

    const active = store;
    try {
      const response = await storage.run(active, () => handler(req, ctx));
      let probe: ResponseProbe | null = null;
      try {
        probe = probeResponse(response);
      } catch {
        probe = { location: null, json: null };
      }
      schedule(active, probe);
      return response;
    } catch (error) {
      schedule(active, null);
      throw error;
    }
  };
}
