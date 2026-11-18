import { describe, expect, it } from 'vitest';
import { previousPath, previousRange } from './previous';

describe('previousRange', () => {
  it('por defecto: últimos 6 meses hasta hoy', () => {
    expect(previousRange(null, null, '2026-11-18')).toEqual({ from: '2026-05-18', to: '2026-11-18' });
  });
  it('máximo un año', () => {
    expect(previousRange('2020-01-01', '2026-11-18', '2026-11-18').from).toBe('2025-11-17');
  });
});

describe('previousPath', () => {
  it('filtra por tipo, fechas y solicitante, y escapa el texto', () => {
    const p = previousPath({ from: '2026-01-01', to: '2026-11-18', sapsendUserId: 11, q: "o'neil" });
    expect(p).toContain("DocObjectCode eq 'oPurchaseRequest' and DocDate ge '2026-01-01' and DocDate le '2026-11-18' and U_SEND_UserId eq 11");
    expect(p).toContain("contains(Comments,'O''NEIL')");
  });
  it('sin solicitante = todas', () => {
    expect(previousPath({ from: '2026-01-01', to: '2026-02-01' })).not.toContain('U_SEND_UserId eq');
  });
});
