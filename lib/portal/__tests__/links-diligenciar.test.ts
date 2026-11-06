import { describe, expect, it } from 'vitest';
import { FORMULARIOS_SST } from '../formularios-sst';
import { LINKS_DILIGENCIAR, RUTA_PAGINA_FORMULARIOS_SST, TITULO_LINKS_DILIGENCIAR, rutaApiFormularioSst } from '../links-diligenciar';

// «Links para diligenciar» (Cristian Baldión, 2026-10-20).

describe('links para diligenciar', () => {
  it('el título y los dos botones dicen exactamente lo que pidió Cristian', () => {
    expect(TITULO_LINKS_DILIGENCIAR).toBe('LINKS PARA DILIGENCIAR EN CASO DE SER REQUERIDO');
    expect(LINKS_DILIGENCIAR.map((l) => l.texto)).toEqual(['REPORTE DE ACTOS Y CONDICIONES INSEGURAS SST', 'CONDICIONES DE SALUD Y SINTOMATOLOGÍA OSTEOMUSCULAR']);
  });
  it('B1 es el reporte y B2 el de salud, en ese orden', () => {
    expect(LINKS_DILIGENCIAR.map((l) => l.codigo)).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']);
  });
  it('cada botón apunta a un formulario que existe, y el texto del botón coincide con el título del formulario', () => {
    for (const l of LINKS_DILIGENCIAR) {
      const f = FORMULARIOS_SST.find((x) => x.codigo === l.codigo);
      expect(f, l.codigo).toBeDefined();
      expect(f!.titulo, l.codigo).toBe(l.texto);
    }
  });
  it('las rutas son fijas y los códigos van codificados', () => {
    expect(rutaApiFormularioSst('SST-REPORTE-ACTOS')).toBe('/api/portal/formularios-sst/SST-REPORTE-ACTOS');
    expect(rutaApiFormularioSst('a/b ?')).toBe('/api/portal/formularios-sst/a%2Fb%20%3F');
    expect(RUTA_PAGINA_FORMULARIOS_SST).toBe('/portal/formularios-sst');
  });
});
