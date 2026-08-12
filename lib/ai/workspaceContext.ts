// Contexto operativo del usuario para el asistente (solicitudes, asignadas, casos).

import type { WorkspaceQueryFocus } from './intentParse';

export interface WorkspaceItem {
  id: number;
  subject: string;
  status?: string | null;
  company?: string | null;
  process?: string | null;
  created_at?: string | null;
}

export interface WorkspaceSnapshot {
  loadedAt: number;
  userName?: string | null;
  pathname?: string | null;
  myRequests: WorkspaceItem[];
  assignedRequests: WorkspaceItem[];
  myTickets: WorkspaceItem[];
  errors: string[];
}

function asItem(row: Record<string, unknown>): WorkspaceItem | null {
  const id = Number(row.id ?? row.id_case ?? row.id_request);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    subject: String(
      row.subject ?? row.subject_request ?? row.subject_case ?? 'Sin asunto',
    ),
    status: row.status != null ? String(row.status) : null,
    company: row.company != null ? String(row.company) : null,
    process:
      row.process != null
        ? String(row.process)
        : row.category != null
          ? String(row.category)
          : null,
    created_at:
      row.created_at != null
        ? String(row.created_at)
        : row.creation_date != null
          ? String(row.creation_date)
          : null,
  };
}

function countByStatus(items: WorkspaceItem[]) {
  const counts = {
    total: items.length,
    abierto: 0,
    resuelto: 0,
    cancelado: 0,
    otros: 0,
  };
  for (const it of items) {
    const s = String(it.status ?? '').toLowerCase();
    if (s.includes('abiert') || s.includes('sin empezar') || s.includes('progreso')) {
      counts.abierto += 1;
    } else if (s.includes('resuelt') || s.includes('complet') || s.includes('cerrad')) {
      counts.resuelto += 1;
    } else if (s.includes('cancel')) {
      counts.cancelado += 1;
    } else {
      counts.otros += 1;
    }
  }
  return counts;
}

function listPreview(items: WorkspaceItem[], limit = 5): string {
  if (items.length === 0) return '\n_Ninguna por ahora._\n';
  return (
    '\n' +
    items
      .slice(0, limit)
      .map((it) => {
        const bits = [`**#${it.id}** ${it.subject}`];
        if (it.status) bits.push(`· _${it.status}_`);
        if (it.process) bits.push(`· ${it.process}`);
        return `- ${bits.join(' ')}`;
      })
      .join('\n') +
    (items.length > limit ? `\n- _…y ${items.length - limit} más_` : '') +
    '\n'
  );
}

function statusLine(label: string, items: WorkspaceItem[]): string {
  const c = countByStatus(items);
  if (!c.total) return `**${label}:** 0`;
  return (
    `**${label}:** ${c.total}` +
    ` _(abiertas/en curso: ${c.abierto}, resueltas: ${c.resuelto}, canceladas: ${c.cancelado}` +
    (c.otros ? `, otras: ${c.otros}` : '') +
    ')_'
  );
}

/** Texto compacto para inyectar en el system/user prompt. */
export function formatWorkspaceForPrompt(snap: WorkspaceSnapshot): string {
  const lines = [
    'DATOS DEL USUARIO (en vivo):',
    statusLine('Solicitudes que yo creé', snap.myRequests),
    listPreview(snap.myRequests),
    statusLine('Solicitudes asignadas a mí (gestión)', snap.assignedRequests),
    listPreview(snap.assignedRequests),
    statusLine('Casos / tickets (Help Desk)', snap.myTickets),
    listPreview(snap.myTickets),
  ];
  if (snap.pathname) lines.unshift(`Página actual: ${snap.pathname}`);
  if (snap.errors.length) {
    lines.push(`Notas: ${snap.errors.join('; ')}`);
  }
  return lines.join('\n');
}

/** Resuelve el foco “page” según la ruta / pageKind actuales. */
export function resolveFocusForPage(
  pathname?: string | null,
  pageKind?: string | null,
): Exclude<WorkspaceQueryFocus, 'page'> {
  const path = (pathname || '').toLowerCase();
  const kind = (pageKind || '').toLowerCase();

  // Dashboard Admin = analítica global; no mapear a bandeja personal.
  if (
    kind.includes('dashboard-admin') ||
    (path.includes('/dashboard') &&
      !path.includes('dashboard-solicitado') &&
      !path.includes('dashboard-solicitante'))
  ) {
    return 'all';
  }
  if (
    kind.includes('dashboard-solicitado') ||
    path.includes('dashboard-solicitado') ||
    kind.includes('assigned-requests') ||
    path.includes('assigned-requests')
  ) {
    return 'dashboard';
  }
  if (
    kind.includes('dashboard-solicitante') ||
    path.includes('dashboard-solicitante') ||
    kind.includes('create-request') ||
    path.includes('create-request') ||
    path.includes('general-requests')
  ) {
    return 'requests';
  }
  if (
    kind.includes('ticket') ||
    kind.includes('help-desk') ||
    path.includes('help-desk') ||
    path.includes('my-tickets')
  ) {
    return 'tickets';
  }
  if (kind.includes('view-request') || path.includes('view-request')) {
    return 'requests';
  }
  return 'dashboard';
}

export type PageAnswerMeta = {
  pageLabel?: string | null;
  pageKind?: string | null;
  requestId?: string | null;
  requestSubject?: string | null;
  requestStatus?: string | null;
  /** Resumen markdown de lo visible en pantalla (prioridad en foco "page"). */
  extra?: string | null;
};

/** Respuesta lista para el chat (sin depender del modelo). */
export function formatWorkspaceAnswer(
  snap: WorkspaceSnapshot,
  focus?: WorkspaceQueryFocus,
  pageMeta?: PageAnswerMeta,
): string {
  // “Qué hay en esta página” → priorizar resumen vivo de la pantalla (cualquier módulo).
  if (focus === 'page' && pageMeta?.extra) {
    const looksRich =
      pageMeta.extra.includes('###') ||
      pageMeta.extra.includes('**Pestaña') ||
      pageMeta.extra.includes('Estás en') ||
      pageMeta.extra.length > 80;
    if (looksRich) return String(pageMeta.extra);
  }

  const who = snap.userName ? `**${snap.userName}**` : 'Aquí';
  const kind = (pageMeta?.pageKind || '').toLowerCase();
  const isAdminDash =
    kind.includes('dashboard-admin') ||
    (snap.pathname || '').includes('/dashboard');

  // Evitar caer al resumen personal cuando estamos en /dashboard sin extra aún
  if (focus === 'page' && isAdminDash) {
    return [
      '### En esta página',
      'Estás en el **Dashboard Admin** (analítica del equipo).',
      'Aún no tengo los KPIs cargados; espera un segundo y vuelve a preguntar, o cambia de pestaña **Solicitudes / Actividades / Tickets**.',
    ].join('\n');
  }

  const effective =
    focus === 'page'
      ? resolveFocusForPage(snap.pathname, pageMeta?.pageKind)
      : focus || 'all';

  const parts: string[] = [];

  if (focus === 'page') {
    const label = pageMeta?.pageLabel || 'esta pantalla';
    parts.push(`### En esta página`);
    parts.push(`Estás en **${label}**.`);
    if (pageMeta?.extra) parts.push(String(pageMeta.extra));
    if (pageMeta?.requestId) {
      parts.push(
        `Solicitud abierta: **#${pageMeta.requestId}**` +
          (pageMeta.requestSubject ? ` — ${pageMeta.requestSubject}` : '') +
          (pageMeta.requestStatus ? ` (_${pageMeta.requestStatus}_)` : ''),
      );
    }
    parts.push('');
  }

  if (effective === 'tickets') {
    parts.push(`### Casos / tickets`);
    parts.push(`${who} — lo relevante de Help Desk:`);
    parts.push(statusLine('Total', snap.myTickets));
    parts.push(listPreview(snap.myTickets, 8));
  } else if (effective === 'assigned' || effective === 'dashboard') {
    parts.push(`### Dashboard personal`);
    parts.push(
      'Esta vista muestra lo que **te toca gestionar** (procesos/categorías a tu cargo), no todo lo que has creado.',
    );
    parts.push(statusLine('Solicitudes a tu cargo', snap.assignedRequests));
    parts.push(listPreview(snap.assignedRequests, 8));
    if (snap.assignedRequests.length === 0) {
      parts.push(
        '> No tienes solicitudes asignadas ahora. Si esperabas ver alguna, puede que el proceso no esté ligado a tu usuario o un filtro las oculte.',
      );
    }
  } else if (effective === 'requests') {
    parts.push(`### Tus solicitudes`);
    parts.push(`${who} — solicitudes que **tú creaste**:`);
    parts.push(statusLine('Total', snap.myRequests));
    parts.push(listPreview(snap.myRequests, 8));
  } else {
    parts.push(`### Resumen de tu espacio`);
    parts.push(`${who}, panorama general:`);
    parts.push(statusLine('Solicitudes creadas por ti', snap.myRequests));
    parts.push(listPreview(snap.myRequests, 5));
    parts.push(statusLine('Solicitudes a tu cargo', snap.assignedRequests));
    parts.push(listPreview(snap.assignedRequests, 5));
    parts.push(statusLine('Casos / tickets', snap.myTickets));
    parts.push(listPreview(snap.myTickets, 5));
  }

  if (snap.errors.length) {
    parts.push(`\n_Nota: ${snap.errors.join(' · ')}_`);
  }
  if (focus === 'page') {
    parts.push(
      '\n¿Quieres el **resumen completo** de tu espacio, o detalle de algún **#id**?',
    );
  } else {
    parts.push(
      '\nPuedo detallar un **#id**, crear un caso/solicitud o cerrar una existente.',
    );
  }
  return parts.join('\n');
}

async function safeJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * Carga un snapshot usable por el asistente.
 * Tolera 403 (sin subproceso) y sigue con lo que sí haya.
 */
export async function fetchWorkspaceSnapshot(opts: {
  userId: string | number | null | undefined;
  userName?: string | null;
  pathname?: string | null;
}): Promise<WorkspaceSnapshot> {
  const snap: WorkspaceSnapshot = {
    loadedAt: Date.now(),
    userName: opts.userName ?? null,
    pathname: opts.pathname ?? null,
    myRequests: [],
    assignedRequests: [],
    myTickets: [],
    errors: [],
  };

  const userId = opts.userId != null ? String(opts.userId).trim() : '';

  const tasks: Array<Promise<void>> = [];

  if (userId) {
    tasks.push(
      (async () => {
        try {
          const res = await fetch(
            `/api/requests-general?idUser=${encodeURIComponent(userId)}`,
            { credentials: 'same-origin', cache: 'no-store' },
          );
          if (!res.ok) {
            snap.errors.push(`solicitudes propias (${res.status})`);
            return;
          }
          const data = await safeJson(res);
          const rows = Array.isArray(data) ? data : [];
          snap.myRequests = rows
            .map((r) => asItem(r as Record<string, unknown>))
            .filter((x): x is WorkspaceItem => x != null);
        } catch {
          snap.errors.push('solicitudes propias (red)');
        }
      })(),
    );

    tasks.push(
      (async () => {
        try {
          const res = await fetch(
            `/api/requests-general/request-assigned?idUser=${encodeURIComponent(userId)}&status=0`,
            { credentials: 'same-origin', cache: 'no-store' },
          );
          if (!res.ok) {
            // status vacío = abiertas por defecto en algunos endpoints
            if (res.status !== 403) {
              snap.errors.push(`asignadas (${res.status})`);
            }
            return;
          }
          const data = await safeJson(res);
          const rows = Array.isArray(data) ? data : [];
          snap.assignedRequests = rows
            .map((r) => asItem(r as Record<string, unknown>))
            .filter((x): x is WorkspaceItem => x != null);
        } catch {
          snap.errors.push('asignadas (red)');
        }
      })(),
    );
  } else {
    snap.errors.push('sin id de usuario para solicitudes');
  }

  tasks.push(
    (async () => {
      try {
        const res = await fetch('/api/help-desk/my-tickets', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (res.status === 403) {
          snap.errors.push('sin acceso a Mis tickets');
          return;
        }
        if (!res.ok) {
          snap.errors.push(`tickets (${res.status})`);
          return;
        }
        const data = (await safeJson(res)) as {
          tickets?: unknown[];
          data?: unknown[];
        } | null;
        const rows = Array.isArray(data?.tickets)
          ? data!.tickets!
          : Array.isArray(data?.data)
            ? data!.data!
            : Array.isArray(data)
              ? data
              : [];
        snap.myTickets = rows
          .map((r) => asItem(r as Record<string, unknown>))
          .filter((x): x is WorkspaceItem => x != null);
      } catch {
        snap.errors.push('tickets (red)');
      }
    })(),
  );

  // Dashboard personal (solicitado): enriquecer asignadas si el usuario tiene permiso.
  tasks.push(
    (async () => {
      try {
        const access = await fetch(
          '/api/requests-general/dashboard-access?kind=solicitado',
          { credentials: 'same-origin', cache: 'no-store' },
        );
        const accessData = (await safeJson(access)) as { allowed?: boolean } | null;
        if (!access.ok || !accessData?.allowed) return;

        const res = await fetch('/api/requests-general/dashboard-solicitado', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await safeJson(res)) as { requests?: unknown[] } | null;
        const rows = Array.isArray(data?.requests) ? data!.requests! : [];
        const fromDash = rows
          .map((r) => asItem(r as Record<string, unknown>))
          .filter((x): x is WorkspaceItem => x != null);
        if (fromDash.length > snap.assignedRequests.length) {
          snap.assignedRequests = fromDash;
        }
      } catch {
        /* opcional */
      }
    })(),
  );

  await Promise.all(tasks);
  return snap;
}
