import { beforeAll, describe, expect, it } from 'vitest';

// El secreto tiene que existir ANTES de importar el módulo: `firmarSesion`
// lanza si falta, y eso es justo lo que se quiere en producción.
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'secreto-de-prueba-para-el-portal';
});

const { firmarSesion, leerSesion, normalizarCorreo } = await import('../auth');

describe('normalizarCorreo', () => {
  it('baja a minúsculas y quita espacios', () => {
    expect(normalizarCorreo('  Nicolas.Rivera@GSSLATAM.com ')).toBe('nicolas.rivera@gsslatam.com');
  });

  it('rechaza lo que no es un correo', () => {
    for (const malo of ['', 'sinarroba', 'a@b', 'a@b.', '@dominio.com', 'espacio @x.com', 42, null]) {
      expect(normalizarCorreo(malo as unknown)).toBeNull();
    }
  });

  it('rechaza un correo absurdamente largo', () => {
    expect(normalizarCorreo(`${'a'.repeat(250)}@gsslatam.com`)).toBeNull();
  });
});

describe('sesión del portal', () => {
  it('lee de vuelta el correo que firmó', () => {
    const ficha = firmarSesion('persona@gsslatam.com');
    expect(leerSesion(ficha)).toBe('persona@gsslatam.com');
  });

  /**
   * La prueba que de verdad importa: sin esto, cualquiera se fabrica una
   * sesión escribiendo un correo en la cookie y entra al portal.
   */
  it('rechaza una ficha con el correo cambiado', () => {
    const ficha = firmarSesion('persona@gsslatam.com');
    const [, vence, firma] = ficha.split('.');
    const otro = Buffer.from('intruso@ajeno.com', 'utf8').toString('base64url');

    expect(leerSesion(`${otro}.${vence}.${firma}`)).toBeNull();
  });

  it('rechaza una ficha con la firma alterada', () => {
    const ficha = firmarSesion('persona@gsslatam.com');
    expect(leerSesion(`${ficha}x`)).toBeNull();
  });

  it('rechaza una ficha vencida', () => {
    const correo = Buffer.from('persona@gsslatam.com', 'utf8').toString('base64url');
    // Firmada de verdad, pero con vencimiento en el pasado: la firma es válida
    // y aun así no debe servir.
    const ayer = Date.now() - 86_400_000;
    const cuerpo = `${correo}.${ayer}`;
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const firma = createHmac('sha256', process.env.NEXTAUTH_SECRET as string)
      .update(cuerpo)
      .digest('base64url');

    expect(leerSesion(`${cuerpo}.${firma}`)).toBeNull();
  });

  it('rechaza basura y vacíos sin reventar', () => {
    for (const malo of [undefined, null, '', 'x', 'a.b', 'a.b.c.d']) {
      expect(leerSesion(malo as string | null | undefined)).toBeNull();
    }
  });
});
