import { describe, it, expect, beforeEach } from 'vitest';
import { saveTicketsListForNavigation, TICKETS_LIST_FALLBACK_WINDOW } from '../ticketsBoardStorage';
import type { HelpDeskCaseListItem } from '../types';

// sessionStorage mínimo con cuota (en caracteres), como el del navegador.
function installStorage(quota: number) {
  const data = new Map<string, string>();
  const used = () => [...data.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => {
      const prev = data.get(k);
      if (used() - (prev ? k.length + prev.length : 0) + k.length + v.length > quota) {
        throw new DOMException("Setting the value of '" + k + "' exceeded the quota.", 'QuotaExceededError');
      }
      data.set(k, v);
    },
  };
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = storage;
  return data;
}

const ticket = (id: number): HelpDeskCaseListItem => ({
  id_case: id,
  subject_case: `Caso ${id}`,
  priority: 'Media',
  status: 'Abierto',
  creation_date: '2026-10-01',
  nombreTecnico: 'Técnico',
  company: 'GSS',
  description: 'x'.repeat(500),
});

describe('saveTicketsListForNavigation (KRONOS-SYNERLINK-7)', () => {
  let data: Map<string, string>;
  const tickets = Array.from({ length: 1000 }, (_, i) => ticket(i + 1));

  beforeEach(() => {
    data = installStorage(200_000);
  });

  it('guarda el listado completo si cabe', () => {
    saveTicketsListForNavigation(tickets.slice(0, 10), 3);
    expect(JSON.parse(data.get('ticketsList') as string)).toHaveLength(10);
  });

  it('si no cabe, guarda una ventana alrededor del caso abierto y no lanza', () => {
    expect(() => saveTicketsListForNavigation(tickets, 500)).not.toThrow();
    const saved = JSON.parse(data.get('ticketsList') as string) as HelpDeskCaseListItem[];
    expect(saved).toHaveLength(TICKETS_LIST_FALLBACK_WINDOW);
    expect(saved.some((t) => t.id_case === 500)).toBe(true);
  });

  it('si ni la ventana cabe, no guarda nada y no lanza', () => {
    data = installStorage(1_000);
    expect(() => saveTicketsListForNavigation(tickets, 1)).not.toThrow();
    expect(data.has('ticketsList')).toBe(false);
  });
});
