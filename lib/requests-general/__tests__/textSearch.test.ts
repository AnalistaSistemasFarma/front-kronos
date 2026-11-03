import { describe, expect, it } from 'vitest';
import { filterByText, requestSearchParts, searchWords, sqlLikeWords } from '../textSearch';

const tickets = [
  { id: 10073, subject: 'Contrato Industrias Saad', company: 'Laboratorios Ryan', category: 'Jurídica', process: 'Contratos', status: 'Abierto', requester: 'Juan Fonseca', user: 'María Pérez' },
  { id: 10080, subject: 'Compra de equipos', company: 'GSS Latam', category: 'Compras', process: 'Solicitud de compra', status: 'Resuelto', requester: 'Ana Ruiz', user: 'Juan Fonseca' },
];

describe('textSearch', () => {
  it('separa palabras sin tildes ni mayúsculas', () => {
    expect(searchWords('  Jurídica   RYAN ')).toEqual(['juridica', 'ryan']);
  });

  it('busca solicitudes por id, asunto, empresa, categoría, estado o personas', () => {
    const ids = (q: string) => filterByText(tickets, q, requestSearchParts).map((t) => t.id);
    expect(ids('10073')).toEqual([10073]);
    expect(ids('saad')).toEqual([10073]);
    expect(ids('juridica')).toEqual([10073]);
    expect(ids('resuelto')).toEqual([10080]);
    expect(ids('maria')).toEqual([10073]);
    expect(ids('juan')).toEqual([10073, 10080]);
    expect(ids('juan compras')).toEqual([10080]);
    expect(ids('')).toEqual([10073, 10080]);
  });

  it('arma patrones LIKE por palabra y escapa los comodines', () => {
    expect(sqlLikeWords('  Compras  GSS ')).toEqual(['%compras%', '%gss%']);
    expect(sqlLikeWords('50% a_b [x]')).toEqual(['%50[%]%', '%a[_]b%', '%[[]x]%']);
    expect(sqlLikeWords('a b c d e f g h')).toHaveLength(6);
    expect(sqlLikeWords(null)).toEqual([]);
  });

  it('no se cae con campos vacíos', () => {
    expect(filterByText([{ id: 1, subject: null }], 'algo', requestSearchParts)).toEqual([]);
  });
});
