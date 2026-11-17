import { describe, expect, it } from 'vitest';
import { parsePortalAdminBody } from './portal-admin-rules';

describe('administración del portal: filtro del cuerpo', () => {
  it('crear usuario: deja pasar solo los campos de la lista y recorta espacios', () => {
    expect(
      parsePortalAdminBody({
        action: 'crear-usuario',
        nit: '830010792',
        nombre: ' Ana Gómez ',
        tipoDocumento: 'CC',
        numeroDocumento: '1020304050',
        email: '',
        portalRole: 'CONTABLE',
        company: 'FARMALOGICA',
        cardCode: 'P830010792',
      })
    ).toEqual({
      ok: true,
      value: {
        action: 'crear-usuario',
        nit: '830010792',
        nombre: 'Ana Gómez',
        tipoDocumento: 'CC',
        numeroDocumento: '1020304050',
        email: '',
        portalRole: 'CONTABLE',
        company: 'FARMALOGICA',
        cardCode: 'P830010792',
      },
    });
  });

  it('editar vínculo: módulos sin repetir y estado booleano', () => {
    expect(
      parsePortalAdminBody({ action: 'editar-vinculo', nit: '830010792', userId: 'u1', linkId: 'l1', resources: ['facturas', 'facturas', 'pagos'] })
    ).toEqual({ ok: true, value: { action: 'editar-vinculo', nit: '830010792', userId: 'u1', linkId: 'l1', resources: ['facturas', 'pagos'] } });
    expect(parsePortalAdminBody({ action: 'editar-vinculo', nit: '830010792', userId: 'u1', linkId: 'l1', active: false }).ok).toBe(true);
  });

  it.each([
    ['acción desconocida', { action: 'borrar-todo', nit: '830010792' }],
    ['NIT con puntos', { action: 'buscar-socios', nit: '830.010.792', company: 'GSS' }],
    ['campo ajeno a la acción', { action: 'restablecer-password', nit: '830010792', userId: 'u1', password: 'x' }],
    ['rol (no se reenvía role)', { action: 'editar-usuario', nit: '830010792', userId: 'u1', role: 'SUPERADMIN' }],
    ['editar sin cambios', { action: 'editar-usuario', nit: '830010792', userId: 'u1' }],
    ['vínculo sin cambios', { action: 'editar-vinculo', nit: '830010792', userId: 'u1', linkId: 'l1' }],
    ['id con caracteres raros', { action: 'desvincular', nit: '830010792', userId: "u1' OR 1=1", linkId: 'l1' }],
    ['módulo con mayúsculas', { action: 'editar-vinculo', nit: '830010792', userId: 'u1', linkId: 'l1', resources: ['Facturas'] }],
    ['activo no booleano', { action: 'editar-usuario', nit: '830010792', userId: 'u1', active: 'si' }],
    ['crear sin documento', { action: 'crear-usuario', nit: '830010792', nombre: 'Ana', portalRole: 'CONTABLE', company: 'GSS', cardCode: 'P1' }],
    ['nombre demasiado largo', { action: 'editar-usuario', nit: '830010792', userId: 'u1', nombre: 'x'.repeat(201) }],
    ['no objeto', null],
  ])('rechaza: %s', (_name, body) => {
    expect(parsePortalAdminBody(body).ok).toBe(false);
  });

  it('crear sin documento dice qué falta', () => {
    expect(
      parsePortalAdminBody({ action: 'crear-usuario', nit: '830010792', nombre: 'Ana', portalRole: 'CONTABLE', company: 'GSS', cardCode: 'P1' })
    ).toEqual({ ok: false, error: 'Escribe el número de documento (es su usuario de ingreso)' });
  });
});
