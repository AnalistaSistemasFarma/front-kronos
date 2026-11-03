import { describe, expect, it } from 'vitest';
import { filterWorkflows, normalizeSearchText } from '../workflowSearch';

const list = [
  { id: 1, company: 'GSS Latam', category: 'Compras', process: 'Solicitud de compra', assigned_process_category: 'Juan Fonseca', active: 1 },
  { id: 2, company: 'Laboratorios Ryan', category: 'Tesorería', process: 'Pago a proveedor', assigned_process_category: 'María Pérez', active: 0 },
  { id: 13, company: 'GSS Latam', category: 'Talento humano', process: 'Vacaciones', assigned_process_category: 'Ana Ruiz', active: 1 },
];

describe('workflowSearch', () => {
  it('quita tildes y mayúsculas', () => {
    expect(normalizeSearchText('  Tesorería ÁRBOL ')).toBe('tesoreria arbol');
  });

  it('sin texto devuelve todo', () => {
    expect(filterWorkflows(list, '   ')).toHaveLength(3);
  });

  it('busca por empresa, categoría, proceso o asignado sin tildes', () => {
    expect(filterWorkflows(list, 'ryan').map((w) => w.id)).toEqual([2]);
    expect(filterWorkflows(list, 'tesoreria').map((w) => w.id)).toEqual([2]);
    expect(filterWorkflows(list, 'vacaciones').map((w) => w.id)).toEqual([13]);
    expect(filterWorkflows(list, 'maria').map((w) => w.id)).toEqual([2]);
  });

  it('todas las palabras deben aparecer (en cualquier campo)', () => {
    expect(filterWorkflows(list, 'gss juan').map((w) => w.id)).toEqual([1]);
    expect(filterWorkflows(list, 'gss pago')).toEqual([]);
  });

  it('busca por id y por vigencia', () => {
    expect(filterWorkflows(list, '13').map((w) => w.id)).toEqual([13]);
    expect(filterWorkflows(list, 'inactivo').map((w) => w.id)).toEqual([2]);
  });
});
