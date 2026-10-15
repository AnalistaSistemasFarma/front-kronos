import { describe, expect, it } from 'vitest';
import { RUTA_FORMACION_HUB, origenDesdeParametro, urlFormacion, urlVolverAlPortal } from '../formacion-navegacion';

describe('navegación de la página de Formación', () => {
  it('desde el portal abierto lleva a /portal/formacion; desde el hub, a Formación DENTRO del hub', () => {
    expect(urlFormacion('abierto')).toBe('/portal/formacion');
    // Con el encabezado y el menú de SynerLink (Nicolás, 2026-10-09).
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
