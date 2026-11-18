/**
 * Llaves de API guardadas en la BASE (Permisos API, 2026-11-09).
 *
 * SynerLink es la fuente única de permisos de los clientes de API: la pantalla
 * Administración → Usuarios → «Permisos API» guarda cada cliente con sus
 * empresas, permisos (herramientas kronos_*) y llaves (solo el SHA-256 hex).
 * Este módulo las lee (por el candado de solo lectura) y las guarda 60 s en
 * memoria. Las llaves del archivo/variable (MCP_API_KEYS) siguen funcionando
 * como respaldo; si una llave estuviera en ambos, gana la de la base (auth.ts).
 *
 * Falla CERRADO: si la base no responde o faltan las tablas, no hay llaves de
 * la base (las del archivo siguen igual).
 */
import { Prisma, queryReadOnly } from './db.js';
import { executeWrite } from './write.js';

export interface DbApiKeyEntry {
  keyId: number;
  /** SHA-256 hex (minúsculas) de la llave. */
  keyHash: string;
  clientId: number;
  name: string;
  agentCode: string | null;
  allCompanies: boolean;
  companyIds: number[];
  /** Permisos ACTIVOS marcados (herramientas permitidas). */
  allowedTools: string[];
  /** Vencimiento de la llave (null/ausente = no vence). Se revisa en CADA petición, no solo al recargar. */
  expiresAt?: Date | null;
}

export interface DbKeyStore {
  /** Llaves vigentes (caché de 60 s). Nunca lanza. */
  getEntries(): Promise<DbApiKeyEntry[]>;
  /** Marca el último uso (como máximo una vez por minuto por llave). Nunca lanza. */
  touch(keyId: number): void;
}

export const DB_KEYS_TTL_MS = 60_000;
export const LAST_USED_THROTTLE_MS = 60_000;

/**
 * ¿La llave ya venció? (2026-11-10: api_client_key.expires_at; sin fecha = no vence).
 * Igual a isKeyExpired de lib/api-permissions/constants.ts en Kronos.
 */
export function isDbKeyExpired(expiresAt: Date | string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  return Number.isFinite(time) && time <= now;
}

/**
 * Lee de la base las llaves no revocadas ni vencidas de clientes activos de un tipo que
 * se conecta por API, con sus empresas y permisos. Filtra en SQL y en UTC, con columnas
 * explícitas: si falta expires_at (no se corrió el script de vencimiento 2026-11-10) la
 * consulta falla y no hay llaves de la base (falla cerrado). Mismo criterio que
 * findActiveKeyByHash en lib/api-permissions/db.ts de Kronos.
 */
export async function loadDbApiKeys(): Promise<DbApiKeyEntry[]> {
  const keys = await queryReadOnly<{
    id_api_client_key: number;
    key_hash: string;
    id_api_client: number;
    name: string;
    agent_code: string | null;
    all_companies: boolean;
    expires_at: Date | null;
  }>(Prisma.sql`
    SELECT k.id_api_client_key, k.key_hash, k.id_api_client, k.expires_at, c.name, c.agent_code, c.all_companies
      FROM dbo.api_client_key k
      INNER JOIN dbo.api_client c ON c.id_api_client = k.id_api_client
     WHERE k.revoked_at IS NULL
       AND (k.expires_at IS NULL OR k.expires_at > SYSUTCDATETIME())
       AND c.active = 1
       AND c.client_type <> N'portal_terceros'
  `);
  if (keys.length === 0) return [];

  const companies = await queryReadOnly<{ id_api_client: number; id_company: number }>(Prisma.sql`
    SELECT cc.id_api_client, cc.id_company
      FROM dbo.api_client_company cc
      INNER JOIN dbo.api_client c ON c.id_api_client = cc.id_api_client
     WHERE c.active = 1
  `);
  const permissions = await queryReadOnly<{ id_api_client: number; permission_code: string }>(Prisma.sql`
    SELECT cp.id_api_client, cp.permission_code
      FROM dbo.api_client_permission cp
      INNER JOIN dbo.api_permission p ON p.code = cp.permission_code
      INNER JOIN dbo.api_client c ON c.id_api_client = cp.id_api_client
     WHERE c.active = 1 AND p.active = 1 AND p.[system] = N'synerlink'
       -- Nivel de acceso (2026-11-11): un cliente en solo lectura (NULL o 'lectura') NO recibe permisos
       -- de escritura aunque estén marcados. Columnas con nombre: sin el script falla y no carga llaves.
       AND (p.access_kind = N'consulta' OR c.access_mode = N'escritura')
  `);

  const companiesByClient = new Map<number, number[]>();
  for (const row of companies) {
    const list = companiesByClient.get(row.id_api_client) ?? [];
    list.push(Number(row.id_company));
    companiesByClient.set(row.id_api_client, list);
  }
  const permissionsByClient = new Map<number, string[]>();
  for (const row of permissions) {
    const list = permissionsByClient.get(row.id_api_client) ?? [];
    list.push(row.permission_code);
    permissionsByClient.set(row.id_api_client, list);
  }

  return keys.map((k) => ({
    keyId: Number(k.id_api_client_key),
    keyHash: String(k.key_hash).trim().toLowerCase(),
    clientId: Number(k.id_api_client),
    name: k.name,
    agentCode: k.agent_code,
    allCompanies: Boolean(k.all_companies),
    companyIds: companiesByClient.get(k.id_api_client) ?? [],
    allowedTools: permissionsByClient.get(k.id_api_client) ?? [],
    expiresAt: k.expires_at,
  }));
}

/** Escribe last_used_at; la condición impide más de una escritura por minuto aunque haya varios procesos. */
export async function touchDbApiKey(keyId: number): Promise<void> {
  await executeWrite(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE dbo.api_client_key SET last_used_at = SYSUTCDATETIME()
       WHERE id_api_client_key = ${keyId}
         AND (last_used_at IS NULL OR last_used_at < DATEADD(SECOND, -60, SYSUTCDATETIME()))
    `);
  });
}

/**
 * Caché de 60 s con una sola carga en vuelo. Si la carga falla, NO se usa la
 * lista anterior (una llave revocada no debe seguir viva por un error): queda
 * vacía hasta el siguiente intento.
 */
export function createDbKeyStore(opts: {
  load?: () => Promise<DbApiKeyEntry[]>;
  touch?: (keyId: number) => Promise<void>;
  ttlMs?: number;
  now?: () => number;
  logError?: (message: string) => void;
} = {}): DbKeyStore {
  const load = opts.load ?? loadDbApiKeys;
  const touchFn = opts.touch ?? touchDbApiKey;
  const ttlMs = opts.ttlMs ?? DB_KEYS_TTL_MS;
  const now = opts.now ?? Date.now;
  const logError = opts.logError ?? ((m: string) => console.error(m));

  let cached: DbApiKeyEntry[] = [];
  let loadedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<DbApiKeyEntry[]> | null = null;
  const lastTouched = new Map<number, number>();

  return {
    async getEntries() {
      // Una llave que vence entre dos recargas deja de servir en ese mismo momento.
      const current = (entries: DbApiKeyEntry[]) => entries.filter((e) => !isDbKeyExpired(e.expiresAt, now()));
      if (now() - loadedAt < ttlMs) return current(cached);
      if (!inFlight) {
        inFlight = load()
          .then((entries) => {
            cached = entries;
            return entries;
          })
          .catch((err: unknown) => {
            // Sin detalles de conexión en el registro (puede traer el servidor).
            const message = err instanceof Error ? err.message : String(err);
            logError(
              /expires_at/i.test(message)
                ? '[mcp] Permisos API: falta la columna expires_at (script 2026-11-10-permisos-api-vencimiento-llaves). Solo llaves del archivo.'
                : /invalid object name|api_client/i.test(message)
                  ? '[mcp] Permisos API: faltan las tablas api_client* (script 2026-11-09-permisos-api). Solo llaves del archivo.'
                  : '[mcp] Permisos API: no se pudieron leer las llaves de la base. Solo llaves del archivo.'
            );
            cached = [];
            return cached;
          })
          .finally(() => {
            loadedAt = now();
            inFlight = null;
          });
      }
      return inFlight.then(current);
    },
    touch(keyId) {
      const t = now();
      const last = lastTouched.get(keyId);
      if (last !== undefined && t - last < LAST_USED_THROTTLE_MS) return;
      lastTouched.set(keyId, t);
      void touchFn(keyId).catch(() => {
        /* best effort: el último uso no debe tumbar la petición */
      });
    },
  };
}
