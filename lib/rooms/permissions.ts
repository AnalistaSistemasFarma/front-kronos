/**
 * Rooms module permissions (pure: no database, also used on the client).
 *
 * Same pattern as Articles and Purchases: one subprocess per level, granted
 * per company in subprocess_user_company (Administración → Usuarios).
 *
 *   ROOMS_VIEW_URL   '/process/salas'           view occupancy (menu entry)
 *   ROOMS_BOOK_URL   '/process/salas/reservar'  book and cancel own bookings (marker)
 *   ROOMS_ADMIN_URL  '/process/salas/admin'     also cancel other people's meetings (marker)
 *
 * The two markers are not pages: the hub hides them (dashboardRoutes.ts) and
 * each level includes the previous ones.
 */
export const ROOMS_VIEW_URL = '/process/salas';
export const ROOMS_BOOK_URL = '/process/salas/reservar';
export const ROOMS_ADMIN_URL = '/process/salas/admin';

export type RoomsLevel = 'view' | 'book' | 'admin';

const RANK: Record<RoomsLevel, number> = { view: 1, book: 2, admin: 3 };

function normalize(url: string | null | undefined): string {
  return (url ?? '').toLowerCase().trim().replace(/\/+$/, '');
}

/** Is it one of the markers (book/admin) the hub must not list? */
export function isRoomsMarkerSubprocess(subprocess: { subprocess_url?: string | null }): boolean {
  const url = normalize(subprocess.subprocess_url);
  return url === ROOMS_BOOK_URL || url === ROOMS_ADMIN_URL;
}

/** Highest level granted by the user's subprocess URLs, or null if none. */
export function levelFromUrls(urls: Array<string | null | undefined>): RoomsLevel | null {
  let level: RoomsLevel | null = null;
  for (const u of urls) {
    const url = normalize(u);
    const l: RoomsLevel | null =
      url === ROOMS_ADMIN_URL ? 'admin' : url === ROOMS_BOOK_URL ? 'book' : url === ROOMS_VIEW_URL ? 'view' : null;
    if (l && (!level || RANK[l] > RANK[level])) level = l;
  }
  return level;
}

export function canBook(level: RoomsLevel | null): boolean {
  return level === 'book' || level === 'admin';
}

/** Cancel: the organizer (with booking permission) or a module administrator. */
export function canCancel(level: RoomsLevel | null, sessionEmail: string, organizerEmail: string): boolean {
  if (level === 'admin') return true;
  if (!canBook(level)) return false;
  const a = sessionEmail.trim().toLowerCase();
  const b = organizerEmail.trim().toLowerCase();
  return a !== '' && a === b;
}
