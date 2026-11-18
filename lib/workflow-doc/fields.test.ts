import { describe, expect, it } from 'vitest';
import {
  buildFileName,
  buildMarkerCatalog,
  formatDate,
  formatFieldValue,
  formatMoney,
  resolveMarkerValues,
  resolveWordLabel,
  unresolvedHtmlMarkers,
  type DocFormValue,
} from './fields';

const campos: DocFormValue[] = [
  { id_form_field: 1, field_label: 'Razón social', field_type: 'text', value_text: 'ACME <S.A.S>' },
  { id_form_field: 2, field_label: 'Valor del contrato', field_type: 'money', value_text: '1234567' },
  { id_form_field: 3, field_label: 'Tipo', field_type: 'select', id_option: 9, option_label: 'Servicios', value_text: null },
  { id_form_field: 4, field_label: 'Fecha inicio', field_type: 'date', value_text: '2026-11-05' },
  {
    id_form_field: 5,
    field_label: 'Productos',
    field_type: 'table',
    config_json: JSON.stringify({ columns: [{ key: 'n', label: 'Nombre', type: 'text' }, { key: 'v', label: 'Valor', type: 'money' }] }),
    value_text: JSON.stringify({ rows: [{ n: 'A<b>', v: 1000 }, { n: 'B', v: 2500.5 }] }),
  },
  { id_form_field: 6, field_label: 'Cantidad', field_type: 'number', value_text: '' },
];

describe('workflow-doc · fields', () => {
  it('arma el catálogo con los campos y las variables del sistema', () => {
    const cat = buildMarkerCatalog(campos);
    expect(cat.filter((m) => m.kind === 'field').map((m) => m.key)).toEqual(['f:1', 'f:2', 'f:3', 'f:4', 'f:5', 'f:6']);
    expect(cat.some((m) => m.key === 'sys:numero_solicitud')).toBe(true);
  });

  it('resuelve etiquetas de Word sin mayúsculas, tildes ni espacios', () => {
    const cat = buildMarkerCatalog(campos);
    expect(resolveWordLabel('RAZON  SOCIAL', cat)).toBe('f:1');
    expect(resolveWordLabel(' razón social ', cat)).toBe('f:1');
    expect(resolveWordLabel('Empresa', cat)).toBe('sys:empresa');
    expect(resolveWordLabel('No existe', cat)).toBeNull();
  });

  it('formatea por tipo de campo', () => {
    expect(formatMoney('1234567')).toBe('$ 1.234.567');
    expect(formatDate('2026-11-05')).toBe('05/11/2026');
    expect(formatFieldValue(campos[2]).text).toBe('Servicios');
    expect(formatFieldValue(campos[5]).text).toBe('');
    expect(formatFieldValue(campos[0]).html).toBe('ACME &lt;S.A.S&gt;');
  });

  it('formatea la tabla como HTML escapado y como texto por filas', () => {
    const v = formatFieldValue(campos[4]);
    expect(v.html).toContain('<th>Nombre</th>');
    expect(v.html).toContain('<td>A&lt;b&gt;</td>');
    expect(v.html).toContain('$ 2.500,5');
    expect(v.text).toBe('Nombre: A<b>; Valor: $ 1.000\nNombre: B; Valor: $ 2.500,5');
  });

  it('resuelve las variables del sistema', () => {
    const vals = resolveMarkerValues(campos, { idRequest: 77, requestDate: '2026-11-01T10:00:00', requester: 'Ana', company: 'OLP', assignee: 'Luis', generatedAt: new Date(2026, 10, 18) });
    expect(vals['sys:numero_solicitud'].text).toBe('77');
    expect(vals['sys:fecha_solicitud'].text).toBe('01/11/2026');
    expect(vals['sys:fecha_generacion'].text).toBe('18/11/2026');
    expect(vals['sys:empresa'].text).toBe('OLP');
  });

  it('detecta marcas del HTML que no resuelven', () => {
    const cat = buildMarkerCatalog(campos);
    const html = '<p>{{CAMPO_FLUJO:f:1}} <span data-type="mention" data-field="f:99">@X</span> {{CAMPO_FLUJO:sys:empresa}}</p>';
    expect(unresolvedHtmlMarkers(html, cat)).toEqual(['f:99']);
  });

  it('arma el nombre del archivo con el patrón y sin caracteres inválidos', () => {
    const cat = buildMarkerCatalog(campos);
    const vals = resolveMarkerValues(campos, { idRequest: 77 });
    expect(buildFileName('Contrato @{N.º de solicitud} - @{Razón social}.pdf', 'Documento', cat, vals)).toBe('Contrato 77 - ACME S.A.S');
    expect(buildFileName('', 'Documento 77', cat, vals)).toBe('Documento 77');
  });
});
