import { describe, expect, it } from 'vitest';
import {
  ADMINISTRADORES_SST_POR_DEFECTO,
  LECTORES_SST_POR_DEFECTO,
  administradoresSst,
  esAdministradorSst,
  lectoresSst,
  puedeVerRespuestasSst,
} from '../formularios-sst-permisos';

// Quién ve las respuestas de los formularios SST (Cristian Baldión, 2026-10-19).

const sinEnv = {} as NodeJS.ProcessEnv;

describe('listas por defecto', () => {
  it('Cristian administra y los cinco correos de SST leen, tal como se indicaron', () => {
    expect(administradoresSst(sinEnv)).toEqual(['cristian.baldion@gsslatam.com']);
    expect(LECTORES_SST_POR_DEFECTO).toEqual([
      'ximena.santamaria@gsslatam.com',
      'sandy.cardenal@gsslatam.com',
      'nairoby.banquett@gsslatam.com',
      'sofia.toquica@gsslatam.com',
      'evelyn.pantoja@gsslatam.com',
    ]);
    expect(ADMINISTRADORES_SST_POR_DEFECTO).toHaveLength(1);
  });
  it('quien administra también lee, y el buzón compartido sst@ NO está', () => {
    const lectores = lectoresSst(sinEnv);
    expect(lectores).toContain('cristian.baldion@gsslatam.com');
    expect(lectores).toHaveLength(6);
    expect(lectores).not.toContain('sst@gsslatam.com');
    expect(puedeVerRespuestasSst('sst@gsslatam.com', sinEnv)).toBe(false);
  });
});

describe('puedeVerRespuestasSst y esAdministradorSst', () => {
  it('los lectores ven pero no administran; el administrador hace las dos cosas', () => {
    expect(puedeVerRespuestasSst('sandy.cardenal@gsslatam.com', sinEnv)).toBe(true);
    expect(esAdministradorSst('sandy.cardenal@gsslatam.com', sinEnv)).toBe(false);
    expect(puedeVerRespuestasSst('cristian.baldion@gsslatam.com', sinEnv)).toBe(true);
    expect(esAdministradorSst('cristian.baldion@gsslatam.com', sinEnv)).toBe(true);
  });
  it('ignora mayúsculas y espacios del correo de la sesión', () => {
    expect(puedeVerRespuestasSst('  Ximena.Santamaria@GSSLATAM.com ', sinEnv)).toBe(true);
  });
  it('cualquier otra persona, o un valor que no es un correo, NO ve nada', () => {
    for (const no of ['otra.persona@gsslatam.com', 'nicolas.rivera@gsslatam.com', '', '   ', null, undefined, 42, {}, 'sandy.cardenal@gsslatam.com.evil.com', 'xsandy.cardenal@gsslatam.com']) {
      expect(puedeVerRespuestasSst(no, sinEnv), String(no)).toBe(false);
      expect(esAdministradorSst(no, sinEnv), String(no)).toBe(false);
    }
  });
});

describe('variables de entorno', () => {
  it('PORTAL_TH_SST_LECTORES reemplaza la lista por defecto (minúsculas, sin repetidos, sin entradas que no son correos)', () => {
    const env = { PORTAL_TH_SST_LECTORES: ' A@x.com, a@x.com ,b@x.com, sin-arroba, c d@x.com ' } as unknown as NodeJS.ProcessEnv;
    expect(lectoresSst(env)).toEqual(['a@x.com', 'b@x.com', 'cristian.baldion@gsslatam.com']);
    expect(puedeVerRespuestasSst('sandy.cardenal@gsslatam.com', env)).toBe(false);
  });
  it('PORTAL_TH_SST_ADMINISTRADORES cambia quién administra, y esa persona también lee', () => {
    const env = { PORTAL_TH_SST_ADMINISTRADORES: 'nueva@x.com' } as unknown as NodeJS.ProcessEnv;
    expect(administradoresSst(env)).toEqual(['nueva@x.com']);
    expect(esAdministradorSst('nueva@x.com', env)).toBe(true);
    expect(esAdministradorSst('cristian.baldion@gsslatam.com', env)).toBe(false);
    expect(puedeVerRespuestasSst('nueva@x.com', env)).toBe(true);
  });
  it('una variable vacía o con basura vuelve a la lista por defecto en lectores, y deja sin administrador solo si todo es basura', () => {
    expect(lectoresSst({ PORTAL_TH_SST_LECTORES: '   ' } as unknown as NodeJS.ProcessEnv)).toHaveLength(6);
    expect(administradoresSst({ PORTAL_TH_SST_ADMINISTRADORES: 'no-es-correo' } as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });
});
