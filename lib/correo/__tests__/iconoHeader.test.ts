import { describe, expect, it } from 'vitest';
import {
  CORREO_HREF,
  ICONO_CORREO_TTL_MS,
  ariaIconoCorreo,
  debeMostrarIconoCorreo,
  estadoDesdeRespuesta,
  estadoVencido,
  etiquetaNoLeidos,
  guardarEstado,
  leerEstadoGuardado,
} from '../iconoHeader';

// Icono del Correo en la cabecera: regla de visibilidad, caché y contador.

const YO = 'laura@gsslatam.com';
const T0 = 1_760_000_000_000;

describe('Icono del Correo · regla de visibilidad', () => {
  it('abre el módulo Correo', () => {
    expect(CORREO_HREF).toBe('/process/correo');
  });

  it('con el permiso del módulo (200) se muestra', () => {
    const e = estadoDesdeRespuesta(YO, 200, { noLeidos: 4 }, T0);
    expect(debeMostrarIconoCorreo(YO, e)).toBe(true);
    expect(e.noLeidos).toBe(4);
  });

  it('sin el permiso (403), sin sesión (401) o con error no se muestra', () => {
    for (const status of [401, 403, 404, 500]) {
      expect(debeMostrarIconoCorreo(YO, estadoDesdeRespuesta(YO, status, { noLeidos: 3 }, T0)), String(status)).toBe(false);
    }
  });

  it('mientras no haya respuesta del servidor, o sin sesión, no se muestra', () => {
    expect(debeMostrarIconoCorreo(YO, null)).toBe(false);
    expect(debeMostrarIconoCorreo(null, estadoDesdeRespuesta(YO, 200, { noLeidos: 1 }, T0))).toBe(false);
    expect(debeMostrarIconoCorreo('', estadoDesdeRespuesta(YO, 200, { noLeidos: 1 }, T0))).toBe(false);
  });

  it('el permiso de OTRO usuario (caché de la pestaña) no sirve para la sesión actual', () => {
    const otro = estadoDesdeRespuesta('otro@gsslatam.com', 200, { noLeidos: 1 }, T0);
    expect(debeMostrarIconoCorreo(YO, otro)).toBe(false);
    expect(estadoVencido(otro, YO, T0)).toBe(true);
    // Mayúsculas en el correo no cambian la regla.
    expect(debeMostrarIconoCorreo('Laura@GSSLATAM.com', estadoDesdeRespuesta(YO, 200, {}, T0))).toBe(true);
  });

  it('con permiso pero sin contador (inquilino no habilitado / Graph caído): icono sin número', () => {
    for (const body of [{ noLeidos: null }, {}, null, { noLeidos: -1 }, { noLeidos: 'x' }]) {
      const e = estadoDesdeRespuesta(YO, 200, body, T0);
      expect(debeMostrarIconoCorreo(YO, e)).toBe(true);
      expect(e.noLeidos).toBeNull();
      expect(etiquetaNoLeidos(e.noLeidos)).toBeNull();
    }
  });
});

describe('Icono del Correo · contador y caché', () => {
  it('etiqueta: nada con 0, número hasta 99 y «99+» desde 100', () => {
    expect(etiquetaNoLeidos(0)).toBeNull();
    expect(etiquetaNoLeidos(7)).toBe('7');
    expect(etiquetaNoLeidos(99)).toBe('99');
    expect(etiquetaNoLeidos(100)).toBe('99+');
  });

  it('etiqueta accesible', () => {
    expect(ariaIconoCorreo(null)).toBe('Correo');
    expect(ariaIconoCorreo(0)).toBe('Correo');
    expect(ariaIconoCorreo(5)).toBe('Correo: 5 sin leer');
  });

  it('la respuesta vale 3 minutos', () => {
    expect(ICONO_CORREO_TTL_MS).toBeGreaterThanOrEqual(2 * 60_000);
    expect(ICONO_CORREO_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
    const e = estadoDesdeRespuesta(YO, 200, { noLeidos: 1 }, T0);
    expect(estadoVencido(null, YO, T0)).toBe(true);
    expect(estadoVencido(e, YO, T0 + ICONO_CORREO_TTL_MS - 1)).toBe(false);
    expect(estadoVencido(e, YO, T0 + ICONO_CORREO_TTL_MS)).toBe(true);
    // Reloj hacia atrás: se vuelve a consultar.
    expect(estadoVencido(e, YO, T0 - 1)).toBe(true);
  });

  it('sessionStorage: ida y vuelta, datos dañados y almacenamiento bloqueado no rompen', () => {
    const mapa = new Map<string, string>();
    const st = { getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => void mapa.set(k, v) };
    const e = estadoDesdeRespuesta(YO, 200, { noLeidos: 2 }, T0);
    guardarEstado(st, e);
    expect(leerEstadoGuardado(st)).toEqual(e);
    for (const v of mapa.keys()) mapa.set(v, '{no-json');
    expect(leerEstadoGuardado(st)).toBeNull();
    for (const v of mapa.keys()) mapa.set(v, JSON.stringify({ email: YO, visible: 'si', en: T0 }));
    expect(leerEstadoGuardado(st)).toBeNull();
    const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(leerEstadoGuardado(roto)).toBeNull();
    expect(() => guardarEstado(roto, e)).not.toThrow();
    expect(leerEstadoGuardado(null)).toBeNull();
  });
});
