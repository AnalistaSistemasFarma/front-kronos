import { describe, expect, it } from 'vitest';
import { requestSearchWhere } from '../requestSearchSql';

describe('requestSearchWhere', () => {
  it('sin texto no agrega filtro', () => {
    expect(requestSearchWhere('  ')).toEqual({ clause: '', params: [] });
    expect(requestSearchWhere(null)).toEqual({ clause: '', params: [] });
  });

  it('un bloque AND por palabra, con parámetros', () => {
    const { clause, params } = requestSearchWhere('gss compras');
    expect(params).toEqual([
      ['search0', '%gss%'],
      ['search1', '%compras%'],
    ]);
    expect(clause.match(/AND \(/g)).toHaveLength(2);
    expect(clause).toContain('@search0');
    expect(clause).toContain('@search1');
    expect(clause).toContain('COLLATE Latin1_General_CI_AI');
  });

  it('el texto del usuario nunca entra en el SQL', () => {
    const { clause, params } = requestSearchWhere("x'; DROP TABLE requests_general;--");
    expect(clause).not.toContain('DROP');
    expect(clause).not.toContain("'");
    expect(params.map(([, v]) => v).join(' ')).toContain('drop');
  });
});
