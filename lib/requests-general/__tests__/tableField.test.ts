import { describe, it, expect } from 'vitest';
import {
  TABLE_FIELD_TYPE,
  TABLE_COLUMN_TYPES,
  isSapColumn,
  parseTableConfig,
  serializeTableConfig,
  parseTableValue,
  serializeTableValue,
  isCellEmpty,
  isRowEmpty,
  validateTableRows,
  newColumnKey,
  type TableColumn,
} from '../tableField';

// Pruebas de las utilidades PURAS del tipo de campo "Tabla" de Solicitudes
// Generales: parseo seguro de la definición de columnas (config_json) y de las
// filas diligenciadas (value_text), y la validación de obligatoriedad.

describe('constantes', () => {
  it('TABLE_FIELD_TYPE es "table"', () => {
    expect(TABLE_FIELD_TYPE).toBe('table');
  });
  it('expone los 8 tipos de columna', () => {
    expect(TABLE_COLUMN_TYPES.map((t) => t.value)).toEqual([
      'text',
      'number',
      'money',
      'date',
      'select',
      'yesno',
      'sap_items',
      'sap_business_partners',
    ]);
  });
});

describe('isSapColumn', () => {
  it('reconoce columnas SAP', () => {
    expect(isSapColumn('sap_items')).toBe(true);
    expect(isSapColumn('sap_business_partners')).toBe(true);
  });
  it('rechaza el resto', () => {
    expect(isSapColumn('text')).toBe(false);
    expect(isSapColumn(null)).toBe(false);
    expect(isSapColumn(undefined)).toBe(false);
  });
});

describe('parseTableConfig', () => {
  it('devuelve columnas vacías ante null/undefined/basura', () => {
    expect(parseTableConfig(null)).toEqual({ columns: [] });
    expect(parseTableConfig(undefined)).toEqual({ columns: [] });
    expect(parseTableConfig('no-es-json')).toEqual({ columns: [] });
    expect(parseTableConfig('{"columns":"x"}')).toEqual({ columns: [] });
  });

  it('parsea columnas válidas y normaliza tipo inválido a text', () => {
    const json = JSON.stringify({
      columns: [
        { key: 'c1', label: 'Cantidad', type: 'number', required: true },
        { key: 'c2', label: 'Raro', type: 'inexistente', required: false },
      ],
    });
    const cfg = parseTableConfig(json);
    expect(cfg.columns).toHaveLength(2);
    expect(cfg.columns[0]).toEqual({ key: 'c1', label: 'Cantidad', type: 'number', required: true });
    expect(cfg.columns[1].type).toBe('text');
  });

  it('descarta columnas sin key o sin label', () => {
    const json = JSON.stringify({
      columns: [
        { key: '', label: 'X', type: 'text' },
        { key: 'ok', label: '', type: 'text' },
        { key: 'good', label: 'Bien', type: 'text' },
      ],
    });
    expect(parseTableConfig(json).columns).toHaveLength(1);
  });

  it('limpia opciones de columnas select y las omite en otros tipos', () => {
    const json = JSON.stringify({
      columns: [
        { key: 's', label: 'Sel', type: 'select', required: false, options: ['A', ' B ', '', 3] },
        { key: 't', label: 'Txt', type: 'text', options: ['no-debe-quedar'] },
      ],
    });
    const cfg = parseTableConfig(json);
    expect(cfg.columns[0].options).toEqual(['A', 'B']);
    expect(cfg.columns[1].options).toBeUndefined();
  });

  it('round-trip serializa y parsea igual', () => {
    const columns: TableColumn[] = [
      { key: 'c1', label: 'A', type: 'money', required: true },
      { key: 'c2', label: 'B', type: 'select', required: false, options: ['x', 'y'] },
    ];
    expect(parseTableConfig(serializeTableConfig(columns)).columns).toEqual(columns);
  });
});

describe('parseTableValue', () => {
  it('devuelve filas vacías ante null/basura', () => {
    expect(parseTableValue(null)).toEqual({ rows: [] });
    expect(parseTableValue('{bad')).toEqual({ rows: [] });
    expect(parseTableValue('{"rows":5}')).toEqual({ rows: [] });
  });
  it('parsea filas objeto y descarta no-objetos', () => {
    const json = JSON.stringify({ rows: [{ c1: 5 }, 3, null, ['x'], { c2: 'a' }] });
    expect(parseTableValue(json).rows).toEqual([{ c1: 5 }, { c2: 'a' }]);
  });
  it('round-trip serializa y parsea igual', () => {
    const rows = [{ c1: 1, c2: 'a' }, { c1: 2, c2: 'b' }];
    expect(parseTableValue(serializeTableValue(rows)).rows).toEqual(rows);
  });
});

describe('isCellEmpty / isRowEmpty', () => {
  it('detecta celdas vacías', () => {
    expect(isCellEmpty(undefined)).toBe(true);
    expect(isCellEmpty(null)).toBe(true);
    expect(isCellEmpty('')).toBe(true);
    expect(isCellEmpty('   ')).toBe(true);
    expect(isCellEmpty(0)).toBe(false);
    expect(isCellEmpty(false)).toBe(false);
    expect(isCellEmpty('x')).toBe(false);
  });
  it('detecta filas totalmente vacías', () => {
    const cols: TableColumn[] = [
      { key: 'a', label: 'A', type: 'text', required: false },
      { key: 'b', label: 'B', type: 'text', required: false },
    ];
    expect(isRowEmpty({ a: '', b: '  ' }, cols)).toBe(true);
    expect(isRowEmpty({ a: '', b: 'x' }, cols)).toBe(false);
  });
});

describe('validateTableRows', () => {
  const cols: TableColumn[] = [
    { key: 'cant', label: 'Cantidad', type: 'number', required: true },
    { key: 'obs', label: 'Obs', type: 'text', required: false },
  ];

  it('campo obligatorio sin filas → error', () => {
    expect(validateTableRows(cols, [], true, 'Detalle')).toMatch(/al menos una fila/i);
  });

  it('campo obligatorio con solo filas vacías → error', () => {
    expect(validateTableRows(cols, [{ cant: '', obs: '' }], true)).toMatch(/al menos una fila/i);
  });

  it('campo opcional sin filas → válido', () => {
    expect(validateTableRows(cols, [], false)).toBeNull();
  });

  it('columna obligatoria vacía en una fila → error con número de fila', () => {
    const err = validateTableRows(cols, [{ cant: 5 }, { obs: 'algo' }], true);
    expect(err).toMatch(/Fila 2/);
    expect(err).toMatch(/Cantidad/);
  });

  it('todas las columnas obligatorias llenas → válido', () => {
    expect(validateTableRows(cols, [{ cant: 5, obs: 'x' }], true)).toBeNull();
  });
});

describe('newColumnKey', () => {
  it('genera claves únicas incrementales', () => {
    expect(newColumnKey([])).toBe('col_1');
    const existing: TableColumn[] = [{ key: 'col_1', label: 'A', type: 'text', required: false }];
    expect(newColumnKey(existing)).toBe('col_2');
  });
  it('evita colisiones con claves ya usadas', () => {
    const existing: TableColumn[] = [
      { key: 'col_2', label: 'A', type: 'text', required: false },
    ];
    // largo=1 → candidato col_2 (colisiona) → col_3
    expect(newColumnKey(existing)).toBe('col_3');
  });
});
