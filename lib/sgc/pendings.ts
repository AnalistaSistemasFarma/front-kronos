import type { SgcEmailMessage } from './email';

/**
 * «MIS PENDIENTES DEL SGC» y POLÍTICA DE CORREO por empresa (Sprint 9,
 * socialización con Calidad OLP del 2026-10-07: «son 200 correos»; se prefiere
 * la campana y el tablero dentro de la app) — funciones PURAS.
 */

/** Política de correo de la empresa. Por defecto, NUNCA (solo campana y tablero). */
export const SGC_EMAIL_MODES = ['nunca', 'vencimientos', 'resumen_diario'] as const;
export type SgcEmailMode = (typeof SGC_EMAIL_MODES)[number];
export const SGC_DEFAULT_EMAIL_MODE: SgcEmailMode = 'nunca';

export const SGC_EMAIL_MODE_LABELS: Record<SgcEmailMode, string> = {
  nunca: 'Nunca (solo campana y tablero)',
  vencimientos: 'Solo avisos de vencimiento',
  resumen_diario: 'Un resumen diario de pendientes',
};

export function isSgcEmailMode(value: unknown): value is SgcEmailMode {
  return typeof value === 'string' && (SGC_EMAIL_MODES as readonly string[]).includes(value);
}

/** ¿Los avisos de vencimiento salen también por correo? Solo con la política «vencimientos». */
export function alertEmailsAllowed(mode: string | null | undefined): boolean {
  return mode === 'vencimientos';
}

/** Grupos del tablero. «copias» llega con las copias no controladas (Sprint 11). */
export const SGC_PENDING_GROUPS = ['tareas', 'lecturas', 'autorizaciones', 'capacitaciones', 'copias'] as const;
export type SgcPendingGroup = (typeof SGC_PENDING_GROUPS)[number];

export const SGC_PENDING_LABELS: Record<SgcPendingGroup, string> = {
  tareas: 'Tareas documentales',
  lecturas: 'Lecturas obligatorias',
  autorizaciones: 'Autorizaciones',
  capacitaciones: 'Capacitaciones y evaluaciones',
  copias: 'Copias no controladas',
};

export interface SgcPendingRow {
  idTask: number;
  idRequest: number;
  subject: string;
  task: string;
  /** Clave del paso (divulgacion, capacitacion…). */
  taskKey: string;
  /** Rol del paso en el flujo (alcance, capacitacion…). */
  role: string;
  isAuthorization: boolean;
  createdAt: string;
}

/** Grupo del tablero de una tarea pendiente de la persona. */
export function pendingGroupOf(row: Pick<SgcPendingRow, 'role' | 'taskKey' | 'isAuthorization'>): SgcPendingGroup {
  if (row.role === 'alcance' || row.taskKey === 'divulgacion') return 'lecturas';
  // Sprint 10: la preparación del material (role «material») también es de capacitación.
  if (row.role === 'capacitacion' || row.role === 'material' || row.taskKey === 'capacitacion') return 'capacitaciones';
  if (row.isAuthorization) return 'autorizaciones';
  return 'tareas';
}

export type SgcPendingCounts = Record<SgcPendingGroup, number> & { total: number };

/** Cuenta los pendientes por grupo (más los extra de otros módulos del SGC, p. ej. copias). */
export function countPendings(rows: readonly Pick<SgcPendingRow, 'role' | 'taskKey' | 'isAuthorization'>[], extra: Partial<Record<SgcPendingGroup, number>> = {}): SgcPendingCounts {
  const counts = Object.fromEntries(SGC_PENDING_GROUPS.map((g) => [g, extra[g] ?? 0])) as Record<SgcPendingGroup, number>;
  for (const r of rows) counts[pendingGroupOf(r)] += 1;
  return { ...counts, total: SGC_PENDING_GROUPS.reduce((n, g) => n + counts[g], 0) };
}

/** Correo del resumen diario (solo con la política «resumen_diario» y si la persona tiene pendientes). */
export function buildDigestMessage(to: string, company: string, counts: SgcPendingCounts, appUrl: string, idCompany: number): SgcEmailMessage | null {
  if (counts.total === 0) return null;
  return {
    to,
    title: `Sus pendientes del SGC · ${company}`,
    rows: SGC_PENDING_GROUPS.filter((g) => counts[g] > 0).map((g) => ({ label: SGC_PENDING_LABELS[g], value: String(counts[g]) })),
    outro: `Tiene ${counts.total} pendiente(s) en el SGC documental. Revíselos en SynerLink: ${appUrl.replace(/\/+$/, '')}/process/sgc-documental?empresa=${idCompany}`,
  };
}
