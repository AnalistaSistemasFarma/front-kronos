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
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
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
