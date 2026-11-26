import { describe, expect, it } from 'vitest';
import { buildGrid, monthOf, validatePlan } from '../calendar';

/** Cronograma anual (2026-11-26, Calidad OLP): auditorías por área y mes; «Nuevo cronograma» en bloque. */
describe('Flujos · cronograma anual', () => {
  it('ubica cada solicitud por área y mes del año pedido', () => {
    expect(monthOf('2027-03-15', 2027)).toBe(3);
    expect(monthOf('2026-03-15', 2027)).toBeNull();
    const g = buildGrid(
      [
        { id: 1, consecutive: 'AUD-0001', subject: 'Sistemas', date: '2027-02-10', status_req: 1, id_option: 10 },
        { id: 2, consecutive: 'AUD-0002', subject: 'Sistemas', date: '2027-02-03', status_req: 2, id_option: 10 },
        { id: 3, consecutive: null, subject: 'Sin área', date: '2027-06-01', status_req: 1, id_option: null },
        { id: 4, consecutive: null, subject: 'Otro año', date: '2026-06-01', status_req: 1, id_option: 10 },
      ],
      2027
    );
    expect(g.get(10)?.get(2)?.map((x) => x.id)).toEqual([2, 1]);
    expect(g.get(0)?.get(6)?.map((x) => x.id)).toEqual([3]);
    expect(g.get(10)?.has(6)).toBe(false);
  });

  it('«Nuevo cronograma» exige fecha del año, área válida, asunto y no repite área y fecha', () => {
    const opts = new Set([10, 11]);
    expect(validatePlan([], 2027, opts)).toEqual({ error: 'Agregue al menos una fecha al cronograma.' });
    expect(validatePlan([{ date: '2026-02-01', groupOptionId: 10, subject: 'Auditoría' }], 2027, opts)).toMatchObject({ error: expect.stringContaining('año 2027') });
    expect(validatePlan([{ date: '2027-02-01', groupOptionId: 99, subject: 'Auditoría' }], 2027, opts)).toMatchObject({ error: expect.stringContaining('área') });
    expect(validatePlan([{ date: '2027-02-01', groupOptionId: 10, subject: 'Au' }], 2027, opts)).toMatchObject({ error: expect.stringContaining('asunto') });
    expect(
      validatePlan(
        [
          { date: '2027-02-01', groupOptionId: 10, subject: 'Auditoría Sistemas' },
          { date: '2027-02-01', groupOptionId: 10, subject: 'Otra' },
        ],
        2027,
        opts
      )
    ).toMatchObject({ error: expect.stringContaining('ya hay') });
    expect(validatePlan([{ date: '2027-02-01', groupOptionId: '11', subject: '  Auditoría   Compras ' }], 2027, opts)).toEqual({ items: [{ date: '2027-02-01', groupOptionId: 11, subject: 'Auditoría Compras' }] });
  });
});
