export type NotificationLinkInput = {
  url?: string | null;
  title?: string | null;
  body?: string | null;
};

const APP_INTERNAL_PATH_PREFIXES = ['/process/', '/dashboard/', '/login', '/select-company'];

/** Rutas de esta app (siempre navegar con router.push, aunque la URL guardada sea de otro host/puerto). */
export function isAppInternalPath(pathname: string): boolean {
  const path = pathname.split('?')[0] || '/';
  if (path === '/process' || path === '/dashboard') return true;
  return APP_INTERNAL_PATH_PREFIXES.some(
    (prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix)
  );
}

/**
 * Convierte la URL guardada en ruta interna para Next.js.
 * Si en BD hay https://produccion:8445/process/... y el usuario está en localhost:8080,
 * igual debe ir a /process/... en el host actual (evita 404 por cambio de origen).
 */
export function resolveNotificationPath(
  url: string | null | undefined,
  _origin?: string
): string | null {
  if (!url || !String(url).trim()) return null;

  const trimmed = String(url).trim();

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      const internal = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (isAppInternalPath(parsed.pathname)) {
        return internal;
      }
      return trimmed;
    }

    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  } catch {
    return trimmed.startsWith('/') ? trimmed : null;
  }
}

function extractIdFromBody(body?: string | null): string | null {
  if (!body) return null;
  const match = body.match(/#(\d+)/);
  return match?.[1] ?? null;
}

export function extractTicketIdFromNotification(
  notification: NotificationLinkInput
): string | null {
  const fromUrl = resolveNotificationPath(notification.url);
  if (fromUrl) {
    const match = fromUrl.match(/[?&]id=(\d+)/);
    if (match?.[1]) return match[1];
  }
  return extractIdFromBody(notification.body);
}

/** Ruta de detalle: usa url guardada o infiere ticket / solicitud / actividad por el texto. */
export function inferNotificationPath(
  notification: NotificationLinkInput,
  origin?: string
): string | null {
  const text = `${notification.title ?? ''} ${notification.body ?? ''}`.toLowerCase();
  const bodyId = extractIdFromBody(notification.body);

  // Tickets: el #id del cuerpo es la fuente de verdad (#2194 — nombre...)
  if (bodyId && (text.includes('ticket') || text.includes('mesa de ayuda'))) {
    return `/process/help-desk/view-ticket?id=${bodyId}`;
  }

  const fromUrl = resolveNotificationPath(notification.url, origin);
  if (fromUrl && !isExternalNotificationPath(fromUrl)) return fromUrl;

  const id = bodyId;
  if (!id) return null;

  if (text.includes('ticket') || text.includes('mesa de ayuda')) {
    return `/process/help-desk/view-ticket?id=${id}`;
  }

  if (text.includes('actividad asignada') || text.includes('actividad resuelta')) {
    if (text.includes('actividad resuelta')) {
      return `/process/request-general/view-request?id=${id}&from=general-requests`;
    }
    return `/process/request-general/view-activities?id=${id}&from=assigned-activities`;
  }

  if (text.includes('actividad')) {
    return `/process/request-general/view-activities?id=${id}&from=assigned-activities`;
  }

  if (text.includes('solicitud')) {
    return `/process/request-general/view-request?id=${id}&from=general-requests`;
  }

  return null;
}

/** Solo enlaces fuera de la app (correo externo, etc.). */
export function isExternalNotificationPath(path: string): boolean {
  if (!/^https?:\/\//i.test(path)) return false;
  try {
    const parsed = new URL(path);
    return !isAppInternalPath(parsed.pathname);
  } catch {
    return true;
  }
}

export function getNotificationActionLabel(path: string | null, title?: string | null): string {
  if (!path) return 'Sin enlace disponible';

  const p = path.toLowerCase();
  const t = (title ?? '').toLowerCase();

  if (p.includes('view-ticket') || t.includes('ticket') || t.includes('mesa de ayuda')) {
    return 'Ver ticket';
  }
  if (p.includes('view-activities') || t.includes('actividad asignada')) {
    return 'Ver actividades';
  }
  if (p.includes('view-request') || t.includes('solicitud')) {
    return 'Ver solicitud';
  }
  if (p.includes('assigned-activities')) {
    return 'Ver mis actividades';
  }
  if (p.includes('assigned-requests') || p.includes('general-requests')) {
    return 'Ver solicitudes';
  }

  return 'Ver detalle';
}
