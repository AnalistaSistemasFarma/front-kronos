import { describe, it, expect } from 'vitest';
import { formatTicketDateTime, ticketNowIso } from '../dates';

// Intl puede usar espacios especiales («a. m.» con espacio fino): se normalizan para comparar.
const plain = (s: string) => s.replace(/\s/g, ' ');

describe('formatTicketDateTime', () => {
  it('muestra la hora guardada tal cual (llega como «…Z» pero es hora local)', () => {
    expect(plain(formatTicketDateTime('2026-11-27T10:41:00.000Z'))).toMatch(/^27 de nov de 2026, 10:41 a\. m\.$/);
    expect(plain(formatTicketDateTime('2026-11-27T19:05:00.000Z'))).toMatch(/7:05 p\. m\./);
  });

  it('de los tickets viejos (guardados a las 00:00) muestra solo el día', () => {
    const viejo = plain(formatTicketDateTime('2026-10-01T00:00:00.000Z'));
    expect(viejo).toBe('1 de oct de 2026');
    expect(viejo).not.toMatch(/m\./);
    expect(plain(formatTicketDateTime('2026-10-01'))).toBe('1 de oct de 2026');
  });

  it('sin fecha o con fecha inválida devuelve el texto de reemplazo', () => {
    expect(formatTicketDateTime(undefined)).toBe('—');
    expect(formatTicketDateTime(null, 'N/A')).toBe('N/A');
    expect(formatTicketDateTime('no es fecha')).toBe('—');
  });
});

describe('ticketNowIso', () => {
  it('escribe la hora local como si fuera UTC, igual que el servidor', () => {
    const now = new Date(2026, 10, 27, 10, 41, 0);
    expect(ticketNowIso(now)).toBe('2026-11-27T10:41:00.000Z');
  });
});
