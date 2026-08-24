import { describe, it, expect } from 'vitest';
import {
  cleanFieldLabel,
  prettyAlias,
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

describe('cleanFieldLabel', () => {
  it('conserva espacios y tildes de la etiqueta real', () => {
    expect(cleanFieldLabel('Fecha de creación')).toBe('Fecha de creación');
    expect(cleanFieldLabel('Área solicitante')).toBe('Área solicitante');
  });
  it('recorta y colapsa espacios/saltos de línea', () => {
    expect(cleanFieldLabel('  ¿Valor  total?  ')).toBe('¿Valor total?');
    expect(cleanFieldLabel('Tipo\nde   documento')).toBe('Tipo de documento');
  });
  it('quita un paréntesis de EJEMPLO al final', () => {
    expect(cleanFieldLabel('Tipo de documento (Ej: contrato)')).toBe('Tipo de documento');
    expect(cleanFieldLabel('Meta (ej. 1000)')).toBe('Meta');
    expect(cleanFieldLabel('Código (EJ XXX-00)')).toBe('Código');
  });
  it('NO quita un paréntesis que no es de ejemplo', () => {
    expect(cleanFieldLabel('Valor (COP)')).toBe('Valor (COP)');
  });
  it('escapa ] como ]] para no romper el corchete', () => {
    expect(cleanFieldLabel('Área [interna]')).toBe('Área [interna]]');
  });
  it('cadena vacía / solo espacios → vacío', () => {
    expect(cleanFieldLabel('   ')).toBe('');
    expect(cleanFieldLabel('')).toBe('');
  });
});

describe('prettyAlias', () => {
  it('usa la etiqueta real (con espacios y tildes)', () => {
    const used = new Set<string>();
    expect(prettyAlias('Tipo de documento', used, 1)).toBe('Tipo de documento');
  });
  it('deduplica alias colisionantes con sufijo " 2", " 3"', () => {
    const used = new Set<string>(['estado']); // semilla como columna base
    const a = prettyAlias('Estado', used, 1);
    const b = prettyAlias('Observaciones', used, 2);
    const c = prettyAlias('Observaciones', used, 3);
    expect(a).toBe('Estado 2'); // choca con la columna base "Estado"
    expect(b).toBe('Observaciones');
    expect(c).toBe('Observaciones 2');
    expect(new Set([a, b, c]).size).toBe(3);
  });
  it('fallback "Campo <id>" si la etiqueta queda vacía', () => {
    const used = new Set<string>();
    expect(prettyAlias('   ', used, 99)).toBe('Campo 99');
  });
});

describe('buildPivotSql', () => {
  const fields: PivotFormField[] = [
    { id: 10, field_label: 'Proveedor', field_type: 'text', display_order: 2 },
    { id: 11, field_label: 'Área solicitante', field_type: 'select', display_order: 1 },
    { id: 12, field_label: 'Detalle de ítems', field_type: 'table', display_order: 3 },
    { id: 13, field_label: 'Valor total (Ej: 1000)', field_type: 'text', display_order: 4 },
  ];

  it('exige un processId entero', () => {
    expect(() => buildPivotSql({ processId: 1.5, fields })).toThrow();
    expect(() => buildPivotSql({ processId: NaN, fields })).toThrow();
  });

  it('genera columnas con la ETIQUETA BONITA entre corchetes, ordenadas por display_order', () => {
    const sql = buildPivotSql({ processId: 42, fields, processName: 'Compras' });
    // Campo select antes que text (display_order 1 vs 2).
    expect(sql.indexOf('rfv.id_form_field = 11')).toBeLessThan(
      sql.indexOf('rfv.id_form_field = 10')
    );
    // Alias legibles (espacios y tildes) entre corchetes.
    expect(sql).toContain('AS [Proveedor]');
    expect(sql).toContain('AS [Área solicitante]');
    // El sufijo "(Ej: ...)" se recorta del encabezado.
    expect(sql).toContain('AS [Valor total]');
    expect(sql).not.toContain('(Ej: 1000)');
    // Filtro por flujo baked como entero literal.
    expect(sql).toContain('WHERE pcrg.id_process_category = 42');
    // Estructura de pivote EAV.
    expect(sql).toContain('COALESCE(pffo.option_label, rfv.value_text)');
    expect(sql).toContain('GROUP BY');
    // Sin ORDER BY de nivel superior: rompería la tabla derivada del motor de vistas.
    expect(sql).not.toMatch(/ORDER\s+BY/i);
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

  it('deduplica encabezados de campos con la misma etiqueta', () => {
    const dup: PivotFormField[] = [
      { id: 1, field_label: 'Observaciones', field_type: 'text', display_order: 1 },
      { id: 2, field_label: 'Observaciones', field_type: 'text', display_order: 2 },
    ];
    const sql = buildPivotSql({ processId: 5, fields: dup });
    expect(sql).toContain('AS [Observaciones]');
    expect(sql).toContain('AS [Observaciones 2]');
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

  // CAVEAT documentado: como el alias ahora conserva espacios, una etiqueta que
  // contenga una palabra reservada suelta (p. ej. "Set de firmas") dispara un
  // FALSO POSITIVO del escáner de palabras clave del candado. Riesgo acotado.
  it('CAVEAT: una etiqueta con palabra reservada suelta dispara el candado', () => {
    const risky: PivotFormField[] = [
      { id: 1, field_label: 'Set de firmas', field_type: 'text', display_order: 1 },
    ];
    const sql = buildPivotSql({ processId: 5, fields: risky });
    expect(sql).toContain('AS [Set de firmas]');
    // El candado hace match de "SET" como palabra dentro del alias.
    expect(() => assertReadOnlySql(sql)).toThrow();
  });
});
