import type { HelpDeskCaseListItem } from './types';

const STORAGE_KEY = 'kronos:help-desk-tickets-board';

export type TicketsBoardFilters = {
  priority: string;
  status: string;
  assigned_user: string;
  date_from: string;
  date_to: string;
  technician: string;
  company: string;
};

export type TicketsBoardPersistedState = {
  filters: TicketsBoardFilters;
  filtersExpanded: boolean;
  scrollY: number;
  tickets?: HelpDeskCaseListItem[];
  savedAt: number;
};

export const DEFAULT_TICKETS_BOARD_FILTERS: TicketsBoardFilters = {
  priority: '',
  status: '1',
  assigned_user: '',
  date_from: '',
  date_to: '',
  technician: '',
  company: '',
};

export function loadTicketsBoardState(): TicketsBoardPersistedState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TicketsBoardPersistedState;
    if (!parsed?.filters) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTicketsBoardState(
  partial: Partial<TicketsBoardPersistedState> & {
    filters: TicketsBoardFilters;
    filtersExpanded: boolean;
  }
): void {
  if (typeof window === 'undefined') return;

  try {
    const current = loadTicketsBoardState();
    const next: TicketsBoardPersistedState = {
      filters: partial.filters,
      filtersExpanded: partial.filtersExpanded,
      scrollY: partial.scrollY ?? current?.scrollY ?? 0,
      tickets: partial.tickets ?? current?.tickets,
      savedAt: Date.now(),
    };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Con "Todos" el listado completo puede pasar la cuota de sessionStorage
      // (~5 MB por origen): se guardan al menos filtros y scroll; los casos se
      // vuelven a pedir al regresar.
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, tickets: undefined }));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** Máximo de casos que se guardan para "anterior/siguiente" si el listado no cabe. */
export const TICKETS_LIST_FALLBACK_WINDOW = 100;

/**
 * Guarda en sesión el listado para navegar entre casos desde el detalle.
 * Nunca lanza: si el listado completo no cabe en sessionStorage (QuotaExceeded,
 * KRONOS-SYNERLINK-7), guarda una ventana de casos alrededor del abierto; si
 * tampoco cabe, no guarda nada y el detalle abre igual (sin anterior/siguiente).
 */
export function saveTicketsListForNavigation(
  tickets: HelpDeskCaseListItem[],
  currentIdCase: number
): void {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.removeItem('ticketsList');
    sessionStorage.setItem('ticketsList', JSON.stringify(tickets));
    return;
  } catch {
    /* no cabe completo: se intenta con una ventana */
  }

  try {
    const idx = Math.max(
      0,
      tickets.findIndex((t) => t.id_case === currentIdCase)
    );
    const half = Math.floor(TICKETS_LIST_FALLBACK_WINDOW / 2);
    const start = Math.max(0, Math.min(idx - half, tickets.length - TICKETS_LIST_FALLBACK_WINDOW));
    sessionStorage.setItem(
      'ticketsList',
      JSON.stringify(tickets.slice(start, start + TICKETS_LIST_FALLBACK_WINDOW))
    );
  } catch {
    try {
      sessionStorage.removeItem('ticketsList');
    } catch {
      /* ignore */
    }
  }
}

/** Propaga c.email al listado en sesión tras guardar en detalle del caso. */
export function syncTicketContactEmailInSession(
  idCase: number,
  email: string | null | undefined
): void {
  if (typeof window === 'undefined') return;

  const trimmed = typeof email === 'string' ? email.trim() : '';
  const patch: Pick<HelpDeskCaseListItem, 'email'> = {
    email: trimmed || undefined,
  };

  try {
    const listRaw = sessionStorage.getItem('ticketsList');
    if (listRaw) {
      const list = JSON.parse(listRaw) as HelpDeskCaseListItem[];
      const idx = list.findIndex((t) => t.id_case === idCase);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch };
        sessionStorage.setItem('ticketsList', JSON.stringify(list));
      }
    }

    const selectedRaw = sessionStorage.getItem('selectedTicket');
    if (selectedRaw) {
      const selected = JSON.parse(selectedRaw) as HelpDeskCaseListItem;
      if (selected?.id_case === idCase) {
        sessionStorage.setItem('selectedTicket', JSON.stringify({ ...selected, ...patch }));
      }
    }

    const board = loadTicketsBoardState();
    if (board?.tickets?.length) {
      const idx = board.tickets.findIndex((t) => t.id_case === idCase);
      if (idx >= 0) {
        const tickets = board.tickets.map((t, i) => (i === idx ? { ...t, ...patch } : t));
        saveTicketsBoardState({
          filters: board.filters,
          filtersExpanded: board.filtersExpanded,
          scrollY: board.scrollY,
          tickets,
        });
      }
    }
  } catch {
    /* ignore */
  }
}
