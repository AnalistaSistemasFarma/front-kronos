import { describe, expect, it } from 'vitest';
import { fillHtml, mentionsToTokens } from './fillHtml';
import { buildMarkerCatalog, resolveMarkerValues, type DocFormValue } from './fields';

const campos: DocFormValue[] = [
  { id_form_field: 1, field_label: 'Nombre', field_type: 'text', value_text: '<script>alert(1)</script>' },
  {
    id_form_field: 2,
    field_label: 'Items',
    field_type: 'table',
    config_json: JSON.stringify({ columns: [{ key: 'a', label: 'A', type: 'text' }] }),
    value_text: JSON.stringify({ rows: [{ a: '<i>x</i>' }] }),
  },
];
const values = resolveMarkerValues(campos, { idRequest: 5, company: 'GSS' });

describe('workflow-doc · fillHtml', () => {
  it('convierte menciones del editor en tokens', () => {
    expect(mentionsToTokens('<p>Hola <span data-type="mention" data-id="f:1" data-field="f:1">@Nombre</span></p>')).toBe('<p>Hola {{CAMPO_FLUJO:f:1}}</p>');
  });

  it('reemplaza tokens escapando los valores', () => {
    const r = fillHtml('<p>{{CAMPO_FLUJO:f:1}} de {{CAMPO_FLUJO:sys:empresa}}</p>', values);
    expect(r.html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; de GSS</p>');
    expect(r.unknown).toEqual([]);
  });

  it('inserta la tabla generada escapada celda a celda', () => {
    const r = fillHtml('<div>{{CAMPO_FLUJO:f:2}}</div>', values);
    expect(r.html).toContain('<table>');
    expect(r.html).toContain('<td>&lt;i&gt;x&lt;/i&gt;</td>');
  });

  it('deja vacías y reporta las marcas desconocidas', () => {
    const r = fillHtml('<p>[{{CAMPO_FLUJO:f:9}}]<span data-field="sys:nada">@n</span></p>', values);
    expect(r.html).toBe('<p>[]</p>');
    expect(r.unknown.sort()).toEqual(['f:9', 'sys:nada']);
    expect(buildMarkerCatalog(campos).length).toBeGreaterThan(2);
  });
});
