import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * QUIÉN PUEDE TOCAR LA CARTELERA.
 *
 * Es la única reja del pedido de Cristian —"que únicamente yo pueda hacer
 * modificaciones"— y se lee en tres sitios distintos (subir, borrar y decidir
 * si se pinta el botón). Si esta función se equivoca, se equivoca en los tres
 * a la vez y en la dirección peligrosa: de más.
 */
const cargar = async () => {
  vi.resetModules();
  return (await import('../config')).editoresDeBanners();
};

const ORIGINAL = process.env.PORTAL_TH_EDITORES;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PORTAL_TH_EDITORES;
  else process.env.PORTAL_TH_EDITORES = ORIGINAL;
});

describe('editoresDeBanners', () => {
  it('sin variable de entorno, solo Talento Humano y Nicolás', async () => {
    delete process.env.PORTAL_TH_EDITORES;
    expect(await cargar()).toEqual([
      'cristian.baldion@gsslatam.com',
      'nicolas.rivera@gsslatam.com',
    ]);
  });

  it('la variable REEMPLAZA la lista, no se le suma', async () => {
    // Importa que sea así: si sumara, quitarle el permiso a alguien exigiría
    // un despliegue y el correo viejo quedaría vivo para siempre.
    process.env.PORTAL_TH_EDITORES = 'otra.persona@gsslatam.com';
    expect(await cargar()).toEqual(['otra.persona@gsslatam.com']);
  });

  it('normaliza mayúsculas, espacios y repetidos', async () => {
    process.env.PORTAL_TH_EDITORES = ' Ana@GSSLATAM.com , ana@gsslatam.com ,, ';
    expect(await cargar()).toEqual(['ana@gsslatam.com']);
  });

  it('una variable vacía cae a la lista por defecto, no deja a todos fuera', async () => {
    process.env.PORTAL_TH_EDITORES = '   ';
    expect(await cargar()).toContain('cristian.baldion@gsslatam.com');
  });
});
