import { describe, it, expect } from 'vitest';
import {
  sanitizeAliasBase,
  safeAlias,
  buildPivotSql,
  type PivotFormField,
} from '../pivotBuilder';
import {
  assertReadOnlySql,
  assertWhitelist,
  extractReferencedObjects,
} from '../../sql/readonly';

// Whitelist mínima con la que DEBE pasar el SQL generado (lo que se registra en
// catalog_source: vw_requests_general ya está; se agregan las 3 tablas EAV).
const ALLOWED = new Set([
  'vw_requests_general',
  'process_category_request_general',
  'request_form_value',
  'process_form_field_option',
]);

describe('sanitizeAliasBase', () => {
  it('quita tildes y colapsa separadores a guion bajo', () => {
    expect(sanitizeAliasBase('Fecha de creación')).toBe('Fecha_de_creacion');
  });
  it('recorta guiones bajos de los extremos y colapsa repetidos', () => {
    expect(sanitizeAliasBase('  ¿Valor total?  ')).toBe('Valor_total');
  });
  it('antepone c_ si empieza por dígito', () => {
    expect(sanitizeAliasBase('2024 meta')).toBe('c_2024_meta');
  });
  it('vacío → campo', () => {
    expect(sanitizeAliasBase('***')).toBe('campo');
    expect(sanitizeAliasBase('')).toBe('campo');
  });
});

describe('safeAlias', () => {
  it('neutraliza palabras clave prohibidas (Set/Delete) para no romper el candado', () => {
    const used = new Set<string>();
    const a = safeAlias('Set de muestras', used);
    const b = safeAlias('Delete', used);
    // Un SELECT con estos alias entre corchetes debe pasar el candado.
    const sql = `SELECT 1 AS [${a}], 2 AS [${b}] FROM vw_requests_general`;
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });
  it('neutraliza prefijos peligrosos (sp_/xp_/fn_)', () => {
    const used = new Set<string>();
    const a = safeAlias('sp_total', used);
    const sql = `SELECT 1 AS [${a}] FROM vw_requests_general`;
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });
  it('deduplica alias colisionantes con sufijo numérico', () => {
    const used = new Set<string>(['numerosolicitud']);
    const a = safeAlias('Estado', used);
    const b = safeAlias('Estado', used);
    const c = safeAlias('Número Solicitud', used);
    expect(a).toBe('Estado');
    expect(b).toBe('Estado_2');
    // "Número Solicitud" → "Numero_Solicitud", no colisiona con la semilla.
    expect(c).toBe('Numero_Solicitud');
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('buildPivotSql', () => {
  const fields: PivotFormField[] = [
    { id: 10, field_label: 'Proveedor', field_type: 'text', display_order: 2 },
    { id: 11, field_label: 'Área solicitante', field_type: 'select', display_order: 1 },
    { id: 12, field_label: 'Detalle de ítems', field_type: 'table', display_order: 3 },
    { id: 13, field_label: 'Set de datos', field_type: 'text', display_order: 4 },
  ];

  it('exige un processId entero', () => {
    expect(() => buildPivotSql({ processId: 1.5, fields })).toThrow();
    expect(() => buildPivotSql({ processId: NaN, fields })).toThrow();
  });

  it('genera una columna por campo pivotable, ordenada por display_order', () => {
    const sql = buildPivotSql({ processId: 42, fields, processName: 'Compras' });
    // Campo select antes que text (display_order 1 vs 2).
    expect(sql.indexOf('rfv.id_form_field = 11')).toBeLessThan(
      sql.indexOf('rfv.id_form_field = 10')
    );
    // Alias saneados presentes.
    expect(sql).toContain('AS [Proveedor]');
    expect(sql).toContain('AS [Area_solicitante]');
    // Filtro por flujo baked como entero literal.
    expect(sql).toContain('WHERE pcrg.id_process_category = 42');
    // Estructura de pivote EAV.
    expect(sql).toContain('COALESCE(pffo.option_label, rfv.value_text)');
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('ORDER BY r.NumeroSolicitud DESC');
  });

  it('EXCLUYE los campos tipo Tabla y los anota en un comentario', () => {
    const sql = buildPivotSql({ processId: 42, fields });
    expect(sql).not.toContain('rfv.id_form_field = 12'); // el campo tabla no se pivotea
    expect(sql).toContain('Campos de tipo Tabla EXCLUIDOS');
    expect(sql).toContain('Detalle de ítems');
  });

  it('el SQL generado PASA el candado de solo lectura', () => {
    const sql = buildPivotSql({ processId: 42, fields });
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });

  it('el SQL generado PASA la whitelist con solo las 4 fuentes esperadas', () => {
    const sql = buildPivotSql({ processId: 42, fields });
    const refs = extractReferencedObjects(sql);
    expect(new Set(refs)).toEqual(ALLOWED);
    expect(() => assertWhitelist(sql, ALLOWED)).not.toThrow();
  });

  it('sin campos pivotables genera solo columnas base y también pasa las guardas', () => {
    const onlyTable: PivotFormField[] = [
      { id: 99, field_label: 'Tabla', field_type: 'table', display_order: 1 },
    ];
    const sql = buildPivotSql({ processId: 7, fields: onlyTable });
    expect(sql).not.toContain('request_form_value'); // sin joins EAV
    expect(() => assertReadOnlySql(sql)).not.toThrow();
    // Solo referencia vw_requests_general + pcrg (ambas whitelisteadas).
    expect(() => assertWhitelist(sql, ALLOWED)).not.toThrow();
  });
});
