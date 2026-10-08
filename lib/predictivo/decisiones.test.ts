import { describe, it, expect } from 'vitest';
import { aCsv, parseFiltros, patronBusqueda, PAGE_SIZE_MAX, type FilaDecision } from './decisiones';

const sp = (q: string) => new URLSearchParams(q);

describe('parseFiltros', () => {
  it('valores por defecto', () => {
    const r = parseFiltros(sp('companyId=3'));
    expect('filtros' in r && r.filtros).toEqual({
      companyId: 3,
      decision: null,
      opcion: null,
      probMin: null,
      calidad: null,
      q: null,
      soloAccionables: false,
      page: 1,
      pageSize: 50,
      csv: false,
    });
  });

  it('lee todos los filtros', () => {
    const r = parseFiltros(
      sp('companyId=1&decision=D1&opcion=urgente&probMin=0.5&calidad=alta&q=%20cefa%20&accionables=1&page=3&pageSize=20&formato=csv')
    );
    expect('filtros' in r && r.filtros).toMatchObject({
      decision: 'D1',
      opcion: 'urgente',
      probMin: 0.5,
      calidad: 'alta',
      q: 'cefa',
      soloAccionables: true,
      page: 3,
      pageSize: 20,
      csv: true,
    });
  });

  it('rechaza valores inválidos', () => {
    expect(parseFiltros(sp('companyId=x'))).toEqual({ error: 'companyId inválido' });
    expect(parseFiltros(sp('companyId=1&decision=D9'))).toEqual({ error: 'decision inválida' });
    expect(parseFiltros(sp('companyId=1&decision=D2&opcion=urgente'))).toEqual({ error: 'opcion inválida' });
    expect(parseFiltros(sp('companyId=1&probMin=2'))).toEqual({ error: 'probMin debe estar entre 0 y 1' });
    expect(parseFiltros(sp('companyId=1&calidad=super'))).toEqual({ error: 'calidad inválida' });
  });

  it('opción sin decisión se valida contra todo el catálogo', () => {
    expect('filtros' in parseFiltros(sp('companyId=1&opcion=renovar_ya'))).toBe(true);
  });

  it('acota la paginación', () => {
    const r = parseFiltros(sp('companyId=1&page=-4&pageSize=5000'));
    expect('filtros' in r && [r.filtros.page, r.filtros.pageSize]).toEqual([1, PAGE_SIZE_MAX]);
  });
});

describe('patronBusqueda', () => {
  it('escapa los comodines de LIKE', () => {
    expect(patronBusqueda('50%_[a]!')).toBe('%50!%!_![a]!!%');
  });
});

describe('aCsv', () => {
  const fila: FilaDecision = {
    item_code: 'PT01',
    item_nombre: 'CEFALOTINA 1g; caja',
    decision: 'D1',
    opcion: 'urgente',
    probabilidad: 0.8123,
    cantidad: 1200,
    impacto_cop: 1234567.89,
    prioridad: 1002844.2,
    calidad: 'alta',
    accionable: true,
    motivo: '=HACK() "texto"',
  };

  it('usa ; y coma decimal, con BOM y CRLF', () => {
    const csv = aCsv([fila]);
    expect(csv.startsWith('\uFEFFCódigo;Artículo;Decisión')).toBe(true);
    const linea = csv.split('\r\n')[1];
    expect(linea).toContain('PT01;"CEFALOTINA 1g; caja";D1 Reabastecer;Urgente;0,8123;1200;1234568;1002844;alta;Sí;');
  });

  it('neutraliza fórmulas y comillas', () => {
    const linea = aCsv([fila]).split('\r\n')[1];
    expect(linea.endsWith(`"'=HACK() ""texto"""`)).toBe(true);
  });

  it('celdas vacías para nulos', () => {
    const linea = aCsv([{ ...fila, probabilidad: null, cantidad: null, impacto_cop: null, prioridad: null, item_nombre: null, motivo: 'ok' }]).split('\r\n')[1];
    expect(linea).toBe('PT01;;D1 Reabastecer;Urgente;;;;;alta;Sí;ok');
  });
});
