import { describe, expect, it } from 'vitest';
import { origenDesdeParametro, RUTA_FORMACION_HUB, urlFormacion, urlVolverAlPortal } from '../formacion-navegacion';

describe('navegación de la página de Formación', () => {
  it('el acceso del portal abierto lleva a /portal/formacion; el del hub, a la página dentro del hub', () => {
    expect(urlFormacion('abierto')).toBe('/portal/formacion');
    expect(urlFormacion('hub')).toBe('/process/portal-th/formacion');
    expect(RUTA_FORMACION_HUB).toBe('/process/portal-th/formacion');
  });

  it('"Volver al portal" vuelve al portal por el que se entró', () => {
    expect(urlVolverAlPortal(origenDesdeParametro('hub'))).toBe('/process/portal-th');
    expect(urlVolverAlPortal(origenDesdeParametro(null))).toBe('/portal');
  });

  it('cualquier otro valor de ?desde= cae al portal abierto (sin redirección abierta)', () => {
    for (const raro of ['https://evil.example', '//evil.example', 'HUB', '/process/x', '']) {
      expect(urlVolverAlPortal(origenDesdeParametro(raro))).toBe('/portal');
    }
  });
});
