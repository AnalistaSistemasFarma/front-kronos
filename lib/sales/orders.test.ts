import { describe, expect, it } from 'vitest';
import { ORDERS_PAGE, ordersPath, toOrderRow } from './orders';

describe('panel de pedidos · ruta', () => {
  it('busca por cliente, NIT, OC y número; fechas, estado y origen', () => {
    const p = ordersPath({ q: '2761', desde: '2026-11-01', hasta: '2026-11-30', estado: 'abiertos', origen: 'synerlink', page: 1 });
    expect(p).toContain("(contains(CardCode,'2761') or contains(CardName,'2761') or contains(NumAtCard,'2761') or DocNum eq 2761)");
    expect(p).toContain("DocDate ge '2026-11-01' and DocDate le '2026-11-30' and DocumentStatus eq 'bost_Open' and startswith(U_SEND_SolCom,'V')");
    expect(p).toContain(`$top=${ORDERS_PAGE}&$skip=${ORDERS_PAGE}`);
  });
  it('escapa el texto y no pone DocNum si no es número; ignora fechas mal escritas', () => {
    const p = ordersPath({ q: "o'neil", desde: '01/11/2026' });
    expect(p).toContain("contains(CardName,'o''neil')");
    expect(p).not.toContain('DocNum eq');
    expect(p).not.toContain('DocDate ge');
  });
  it('sin filtros lista todo ordenado del más reciente', () => {
    expect(ordersPath({})).not.toContain('$filter');
    expect(ordersPath({})).toContain('$orderby=DocEntry desc');
  });
});

describe('panel de pedidos · filas', () => {
  it('estado, origen SynerLink y datos', () => {
    const r = toOrderRow({ DocEntry: 2761, DocNum: 2761, DocDate: '2026-11-03T00:00:00Z', CardCode: 'C', DocumentStatus: 'bost_Open', Cancelled: 'tNO', U_SEND_SolCom: 'V866', DocTotal: 4648 });
    expect(r).toMatchObject({ docNum: 2761, docDate: '2026-11-03', status: 'Abierto', draftDocEntry: 866, total: 4648 });
    expect(toOrderRow({ DocEntry: 1, Cancelled: 'tYES', DocumentStatus: 'bost_Close' }).status).toBe('Cancelado');
    expect(toOrderRow({ DocEntry: 1, U_SEND_SolCom: null }).draftDocEntry).toBeNull();
  });
});
