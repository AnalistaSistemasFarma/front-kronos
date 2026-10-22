import { describe, expect, it } from 'vitest';
import { faltantesInquilino, inquilinoDeCorreo, readCorreoConfig } from '../config';

const env = {
  CORREO_MODO: 'graph',
  CORREO_INQUILINOS: 'gss, olp, mal-clave!',
  CORREO_GSS_TENANT_ID: '3409fd29-f351-4a98-8ef4-d98c8874a836',
  CORREO_GSS_CLIENT_ID: '28c47cc5-342a-4781-909e-d234db1bb993',
  CORREO_GSS_CLIENT_SECRET: 'x',
  CORREO_GSS_DOMINIOS: '@GSSLATAM.com, groupsharedservices.com',
  // OLP declarado pero incompleto: no se usa.
  CORREO_OLP_TENANT_ID: '6206efcd-0000-0000-0000-000000000000',
  CORREO_OLP_DOMINIOS: 'onelatampharma.com',
};

describe('Correo · configuración por inquilino', () => {
  it('por defecto apagado; envío y etiqueta encendidos; sincronización apagada', () => {
    const c = readCorreoConfig({});
    expect(c).toMatchObject({ modo: 'off', inquilinos: [], envioHabilitado: true, etiquetarHabilitado: true, syncHabilitado: false });
    const d = readCorreoConfig({ CORREO_ENVIO_HABILITADO: 'false', CORREO_ETIQUETAR_HABILITADO: 'false', CORREO_SYNC_HABILITADO: 'true', CORREO_MODO: 'MOCK' });
    expect(d).toMatchObject({ modo: 'mock', envioHabilitado: false, etiquetarHabilitado: false, syncHabilitado: true });
    expect(readCorreoConfig({ CORREO_MODO: 'otro' }).modo).toBe('off');
  });

  it('eliminar (deslizar, 2026-10-18): encendido por defecto; CORREO_ELIMINAR_HABILITADO=false lo apaga', () => {
    expect(readCorreoConfig({}).eliminarHabilitado).toBe(true);
    expect(readCorreoConfig({ CORREO_ELIMINAR_HABILITADO: 'false' }).eliminarHabilitado).toBe(false);
  });

  it('cada correo se atiende SOLO con la app de su inquilino, si está completa', () => {
    const c = readCorreoConfig(env);
    expect(c.inquilinos.map((i) => i.clave)).toEqual(['gss', 'olp']);
    expect(inquilinoDeCorreo(c, 'Laura@GSSLATAM.com')?.clave).toBe('gss');
    expect(inquilinoDeCorreo(c, 'x@groupsharedservices.com')?.clave).toBe('gss');
    expect(inquilinoDeCorreo(c, 'x@onelatampharma.com')).toBeNull();
    expect(inquilinoDeCorreo(c, 'x@ryanlab.com')).toBeNull();
    expect(inquilinoDeCorreo(c, 'sin-dominio')).toBeNull();
    expect(faltantesInquilino(c.inquilinos[1])).toEqual(['CORREO_OLP_CLIENT_ID', 'CORREO_OLP_CLIENT_SECRET']);
  });
});
