import { describe, expect, it } from 'vitest';
import { aging, analyzeCredit, toOpenInvoices } from './credit';

describe('análisis de cupo', () => {
  it('porcentaje de uso, extracupo y excedente sobre el límite con tolerancia', () => {
    const a = analyzeCredit({ creditLimit: 1000, pctTolerancia: 20, saldo: 500, entregasAbiertas: 100, pedidosAbiertos: 100, otrasOfertas: 0, estaOferta: 800 });
    expect(a.comprometido).toBe(1500);
    expect(a.limiteConTolerancia).toBe(1200);
    expect(a.disponible).toBe(500);
    expect(a.excedente).toBe(300);
    expect(a.pctUso).toBe(150);
    expect(a.pctExtracupo).toBe(50);
    expect(a.excede).toBe(true);
  });
  it('sin límite de crédito no hay porcentaje', () => {
    const a = analyzeCredit({ creditLimit: 0, pctTolerancia: 20, saldo: 0, entregasAbiertas: 0, pedidosAbiertos: 0, otrasOfertas: 0, estaOferta: 10 });
    expect(a.pctUso).toBeNull();
    expect(a.excede).toBe(true);
  });
});

describe('cartera por edades', () => {
  const rows = [
    { DocNum: 1, DocDate: '2026-08-01', DocDueDate: '2026-08-31', DocTotal: 100, PaidToDate: 0 },
    { DocNum: 2, DocDate: '2026-10-01', DocDueDate: '2026-10-31', DocTotal: 200, PaidToDate: 50 },
    { DocNum: 3, DocDate: '2026-11-01', DocDueDate: '2026-12-01', DocTotal: 300, PaidToDate: 0 },
    { DocNum: 4, DocDate: '2026-11-01', DocDueDate: '2026-12-01', DocTotal: 50, PaidToDate: 50 },
  ];
  it('pendiente, días vencidos y orden (más vencida primero), sin las pagadas', () => {
    const inv = toOpenInvoices(rows, '2026-11-03');
    expect(inv.map((i) => [i.docNum, i.pendiente, i.diasVencida])).toEqual([[1, 100, 64], [2, 150, 3], [3, 300, -28]]);
  });
  it('rangos de días', () => {
    const a = aging(toOpenInvoices(rows, '2026-11-03'));
    expect(a.total).toBe(550);
    expect(a.vencido).toBe(250);
    expect(a.buckets.find((b) => b.key === 'por_vencer')!.amount).toBe(300);
    expect(a.buckets.find((b) => b.key === 'd1_30')!.amount).toBe(150);
    expect(a.buckets.find((b) => b.key === 'd61_90')!.amount).toBe(100);
    expect(a.maxDias).toBe(64);
  });
});
