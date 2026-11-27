import { describe, expect, it } from 'vitest';
import { viewableInline } from '../requestProtection';

/** «Ver sin descargar» (2026-11-24): solo PDF e imágenes se ven en el visor seguro. */
describe('Flujos restringidos · adjuntos de solo consulta', () => {
  it('PDF e imágenes se ven en línea; Word, Excel y comprimidos no', () => {
    expect(viewableInline('Informe auditoría AU-0001.pdf')).toBe(true);
    expect(viewableInline('evidencia.JPG')).toBe(true);
    expect(viewableInline('archivo', 'application/pdf')).toBe(true);
    expect(viewableInline('plan.docx')).toBe(false);
    expect(viewableInline('lista.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(false);
    expect(viewableInline('soportes.zip')).toBe(false);
  });
});
