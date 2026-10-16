import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { checkAdminPrivileges } from '../access-control';
import {
  DASHBOARD_SOLICITADO_URL,
  DASHBOARD_SOLICITANTE_URL,
  hasRequestDashboardAccess,
  isHubHiddenRequestDashboardSubprocess,
  resolveUserIdByEmail,
} from '../request-general/dashboardAccess';
import { isTeamLeader } from '../request-general/teamDashboard';

/**
 * Página de inicio personalizada (Perfil → Accesibilidad).
 *
 * Cada persona elige qué se abre primero al entrar, entre lo que tiene disponible:
 * los dashboards del encabezado y sus módulos asignados (subprocess_url). Se guarda en
 * dbo.user_start_page (prisma/manual/2026-10-15-user-start-page.sql). En /home solo se
 * usa si la persona SIGUE teniendo acceso a esa página; si no, inicio automático.
 */

// Constantes repetidas a propósito: sus módulos de origen son de cliente ('use client').
const PROCESS_HUB_URL = '/process';
const ADMIN_DASHBOARD_URL = '/dashboard/solicitudes';
const TEAM_DASHBOARD_URL = `${DASHBOARD_SOLICITADO_URL}/equipo`;

export const MAX_START_PAGE_URL = 400;

export interface StartPageOption {
  url: string;
  label: string;
  group: string;
}

/** La tabla aún no existe (el pase manual no se ha corrido). */
export class StartPageStoreUnavailableError extends Error {
  constructor() {
    super('La página de inicio personalizada aún no está disponible.');
    this.name = 'StartPageStoreUnavailableError';
  }
}

function isMissingTable(err: unknown): boolean {
  const e = err as { number?: number; originalError?: { info?: { number?: number } } };
  return e?.number === 208 || e?.originalError?.info?.number === 208;
}

function normalizeUrl(raw: string | null | undefined): string | null {
  const url = String(raw ?? '').trim();
  // Solo rutas internas de la app (nada de http://, //dominio ni javascript:).
  if (!url.startsWith('/') || url.startsWith('//') || url.length > MAX_START_PAGE_URL) return null;
  return url;
}

export async function getSavedStartPage(userId: string): Promise<string | null> {
  try {
    return await withMssqlPool(async (pool) => {
      const result = await pool
        .request()
        .input('idUser', sql.NVarChar(1000), userId)
        .query('SELECT TOP 1 url FROM dbo.user_start_page WHERE id_user = @idUser');
      return (result.recordset[0]?.url as string | undefined) ?? null;
    });
  } catch (err) {
    if (isMissingTable(err)) throw new StartPageStoreUnavailableError();
    throw err;
  }
}

/** Guarda la página (o la borra con `null` para volver al inicio automático). */
export async function saveStartPage(userId: string, url: string | null): Promise<void> {
  try {
    await withMssqlPool(async (pool) => {
      const request = pool.request().input('idUser', sql.NVarChar(1000), userId);
      if (url == null) {
        await request.query('DELETE FROM dbo.user_start_page WHERE id_user = @idUser');
        return;
      }
      await request.input('url', sql.NVarChar(MAX_START_PAGE_URL), url).query(`
        UPDATE dbo.user_start_page SET url = @url, updated_at = SYSDATETIME() WHERE id_user = @idUser;
        IF @@ROWCOUNT = 0
          INSERT INTO dbo.user_start_page (id_user, url) VALUES (@idUser, @url);
      `);
    });
  } catch (err) {
    if (isMissingTable(err)) throw new StartPageStoreUnavailableError();
    throw err;
  }
}

/** Lo que la persona puede elegir: dashboards del encabezado + sus módulos asignados. */
export async function listStartPageOptions(email: string, userId: string): Promise<StartPageOption[]> {
  const [solicitado, solicitante, admin, leader, modules] = await Promise.all([
    hasRequestDashboardAccess(email, 'solicitado'),
    hasRequestDashboardAccess(email, 'solicitante'),
    checkAdminPrivileges(email),
    isTeamLeader(userId).catch(() => false),
    withMssqlPool(async (pool) => {
      const result = await pool
        .request()
        .input('idUser', sql.NVarChar(1000), userId)
        .query(`
          SELECT DISTINCT p.process, s.subprocess, s.subprocess_url
          FROM subprocess_user_company suc
          INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
          INNER JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
          LEFT JOIN process p ON p.id_process = s.id_process
          WHERE cu.id_user = @idUser
            AND NULLIF(LTRIM(RTRIM(s.subprocess_url)), '') IS NOT NULL
        `);
      return result.recordset as Array<{ process: string | null; subprocess: string | null; subprocess_url: string }>;
    }),
  ]);

  const options: StartPageOption[] = [
    { url: PROCESS_HUB_URL, label: 'Procesos (todos mis módulos)', group: 'General' },
  ];
  if (solicitado) options.push({ url: DASHBOARD_SOLICITADO_URL, label: 'Dashboard personal', group: 'Dashboards' });
  if (leader) options.push({ url: TEAM_DASHBOARD_URL, label: 'Dashboard personal · Mi equipo', group: 'Dashboards' });
  if (solicitante) options.push({ url: DASHBOARD_SOLICITANTE_URL, label: 'Dashboard de solicitudes', group: 'Dashboards' });
  if (admin) options.push({ url: ADMIN_DASHBOARD_URL, label: 'Dashboard del equipo (administración)', group: 'Dashboards' });

  const moduleOptions = modules
    .filter((m) => !isHubHiddenRequestDashboardSubprocess(m))
    .map((m) => ({
      url: normalizeUrl(m.subprocess_url),
      label: m.subprocess?.trim() || m.subprocess_url,
      group: m.process?.trim() || 'Otros módulos',
    }))
    .filter((o): o is StartPageOption => o.url != null)
    .sort((a, b) => a.group.localeCompare(b.group, 'es') || a.label.localeCompare(b.label, 'es'));

  const seen = new Set(options.map((o) => o.url));
  for (const o of moduleOptions) {
    if (seen.has(o.url)) continue;
    seen.add(o.url);
    options.push(o);
  }
  return options;
}

export function isValidStartPageUrl(url: unknown): url is string {
  return typeof url === 'string' && normalizeUrl(url) === url;
}

/**
 * Página guardada si la persona aún tiene acceso a ella; null si no hay, si perdió el
 * acceso o si la tabla no existe (entonces /home usa el inicio automático de siempre).
 */
export async function resolveSavedStartPage(email: string): Promise<string | null> {
  try {
    const userId = await resolveUserIdByEmail(email);
    if (!userId) return null;
    const saved = await getSavedStartPage(userId);
    if (!saved) return null;
    const options = await listStartPageOptions(email, userId);
    return options.some((o) => o.url === saved) ? saved : null;
  } catch (err) {
    if (!(err instanceof StartPageStoreUnavailableError)) {
      console.error('Página de inicio personalizada no disponible:', err);
    }
    return null;
  }
}
