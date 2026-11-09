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

/**
 * Los casos van en una llave aparte: el listado puede pesar varios MB y antes se volvía a
 * leer y escribir completo en cada evento de scroll y al abrir/cerrar filtros, lo que
 * congelaba la pantalla unos segundos. Filtros y scroll (pocos bytes) se guardan solos.
 */
const TICKETS_STORAGE_KEY = `${STORAGE_KEY}:tickets`;

type BoardMeta = Omit<TicketsBoardPersistedState, 'tickets'>;

function loadBoardMeta(): BoardMeta | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as BoardMeta;
  return parsed?.filters ? parsed : null;
}

export function loadTicketsBoardState(): TicketsBoardPersistedState | null {
  if (typeof window === 'undefined') return null;

  try {
    const meta = loadBoardMeta();
    if (!meta) return null;
    let tickets: HelpDeskCaseListItem[] | undefined;
    try {
      const rawTickets = sessionStorage.getItem(TICKETS_STORAGE_KEY);
      const parsedTickets = rawTickets ? JSON.parse(rawTickets) : undefined;
      tickets = Array.isArray(parsedTickets) ? parsedTickets : undefined;
    } catch {
      tickets = undefined;
    }
    return { ...meta, tickets };
  } catch {
    return null;
  }
}

/**
 * Guarda filtros/scroll. Los casos SOLO se reescriben cuando se pasan en `partial.tickets`;
 * si no, se conservan los ya guardados sin leerlos ni volver a serializarlos.
 */
export function saveTicketsBoardState(
  partial: Partial<TicketsBoardPersistedState> & {
    filters: TicketsBoardFilters;
    filtersExpanded: boolean;
  }
): void {
  if (typeof window === 'undefined') return;

  try {
    let currentScroll = 0;
    if (partial.scrollY === undefined) {
      try {
        currentScroll = loadBoardMeta()?.scrollY ?? 0;
      } catch {
        currentScroll = 0;
      }
    }
    const meta: BoardMeta = {
      filters: partial.filters,
      filtersExpanded: partial.filtersExpanded,
      scrollY: partial.scrollY ?? currentScroll,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
  } catch {
    /* ignore quota / private mode */
  }

  if (partial.tickets === undefined) return;
  try {
    sessionStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(partial.tickets));
  } catch {
    // Con "Todos" el listado completo puede pasar la cuota de sessionStorage
    // (~5 MB por origen): se guardan al menos filtros y scroll; los casos se
    // vuelven a pedir al regresar.
    try {
      sessionStorage.removeItem(TICKETS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
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
