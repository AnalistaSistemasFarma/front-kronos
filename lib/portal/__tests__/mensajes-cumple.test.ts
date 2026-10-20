import { describe, expect, it } from 'vitest';
import {
  DIAS_VISIBLE_MENSAJE,
  EMOJIS_MENSAJE,
  MAX_CARACTERES_MENSAJE,
  MAX_LINEAS_MENSAJE,
  contarCaracteres,
  esCorreoMensaje,
  fechaEnVentanaMensaje,
  fechaIsoValida,
  validarTextoMensaje,
} from '../mensajes-cumple';

// Mensajes de cumpleaños (Cristian Baldión, 2026-10-20): reglas puras, sin red.

describe('validarTextoMensaje', () => {
  it('acepta un mensaje normal y lo deja recortado', () => {
    expect(validarTextoMensaje('  ¡Feliz cumpleaños! Que la pase muy bien.  ')).toEqual({ ok: true, texto: '¡Feliz cumpleaños! Que la pase muy bien.' });
  });
  it('acepta emojis, también los compuestos, y cuenta cada emoji como UN carácter', () => {
    const r = validarTextoMensaje('🎉🎂 Feliz día ❤️ 👨‍👩‍👧');
    expect(r.ok).toBe(true);
    expect(contarCaracteres('🎉')).toBe(1);
    expect(contarCaracteres('ab🎉')).toBe(3);
  });
  it('rechaza lo vacío, lo que solo trae espacios y lo que no es texto', () => {
    for (const malo of ['', '   ', '\n\n', null, undefined, 42, {}, []]) {
      const r = validarTextoMensaje(malo);
      expect(r.ok, String(malo)).toBe(false);
      if (!r.ok) expect(r.error).toBe('Escriba su mensaje.');
    }
  });
  it('el tope son 500 caracteres de verdad: 500 pasan (aunque sean emojis), 501 no', () => {
    expect(validarTextoMensaje('a'.repeat(MAX_CARACTERES_MENSAJE)).ok).toBe(true);
    expect(validarTextoMensaje('🎉'.repeat(MAX_CARACTERES_MENSAJE)).ok).toBe(true); // 1000 unidades UTF-16, 500 caracteres
    const r = validarTextoMensaje('a'.repeat(MAX_CARACTERES_MENSAJE + 1));
    expect(r).toEqual({ ok: false, error: 'El mensaje admite máximo 500 caracteres.' });
  });
  it('limita las líneas y junta los saltos de más', () => {
    expect(validarTextoMensaje(Array.from({ length: MAX_LINEAS_MENSAJE }, (_, i) => `l${i}`).join('\n')).ok).toBe(true);
    const r = validarTextoMensaje(Array.from({ length: MAX_LINEAS_MENSAJE + 1 }, (_, i) => `l${i}`).join('\n'));
    expect(r.ok).toBe(false);
    expect(validarTextoMensaje('uno\n\n\n\n\ndos')).toEqual({ ok: true, texto: 'uno\n\ndos' });
  });
  it('quita caracteres de control y de dirección que cambian cómo se lee el texto, pero conserva el salto de línea', () => {
    const r = validarTextoMensaje('hola\u0000\u0007 \u202Emundo\u202C\u2066x\u2069\nsegunda\r\ntercera');
    expect(r).toEqual({ ok: true, texto: 'hola mundox\nsegunda\ntercera' });
  });
  it('un texto con HTML se guarda como texto: la pantalla lo muestra sin interpretarlo', () => {
    expect(validarTextoMensaje('<script>alert(1)</script>')).toEqual({ ok: true, texto: '<script>alert(1)</script>' });
  });
});

describe('fechas', () => {
  it('fechaIsoValida acepta solo fechas que existen', () => {
    for (const ok of ['2026-10-20', '2028-02-29']) expect(fechaIsoValida(ok), ok).toBe(true);
    for (const mal of ['2026-02-29', '2026-13-01', '2026-00-10', '26-10-20', '2026-10-20T00:00', '', null, undefined, 20261020, '1999-12-31', '2101-01-01']) {
      expect(fechaIsoValida(mal), String(mal)).toBe(false);
    }
  });
  it('la ventana va del día del cumpleaños hasta 7 días después, y no antes', () => {
    expect(DIAS_VISIBLE_MENSAJE).toBe(7);
    const hoy = '2026-10-20';
    expect(fechaEnVentanaMensaje('2026-10-20', hoy)).toBe(true); // hoy
    expect(fechaEnVentanaMensaje('2026-10-13', hoy)).toBe(true); // 7 días atrás
    expect(fechaEnVentanaMensaje('2026-10-12', hoy)).toBe(false); // 8 días atrás
    expect(fechaEnVentanaMensaje('2026-10-21', hoy)).toBe(false); // mañana: todavía no
    expect(fechaEnVentanaMensaje('basura', hoy)).toBe(false);
    expect(fechaEnVentanaMensaje('2026-10-20', 'basura')).toBe(false);
  });
  it('la ventana cruza el cambio de mes y de año', () => {
    expect(fechaEnVentanaMensaje('2026-12-28', '2027-01-03')).toBe(true);
    expect(fechaEnVentanaMensaje('2026-02-26', '2026-03-03')).toBe(true);
    expect(fechaEnVentanaMensaje('2028-02-28', '2028-03-06')).toBe(true); // bisiesto: 29 de febrero en medio
    expect(fechaEnVentanaMensaje('2028-02-28', '2028-03-07')).toBe(false);
  });
});

describe('correo y paleta', () => {
  it('«No Aplica», vacío y basura no son correos', () => {
    for (const ok of ['a@x.com', ' b.c@gsslatam.com ']) expect(esCorreoMensaje(ok), ok).toBe(true);
    for (const mal of ['No Aplica', '', '   ', 'sin-arroba', 'a@b', 'a b@c.com', null, 5]) expect(esCorreoMensaje(mal), String(mal)).toBe(false);
  });
  it('la paleta trae 32 emojis distintos, y todos pasan la validación', () => {
    expect(EMOJIS_MENSAJE).toHaveLength(32);
    expect(new Set(EMOJIS_MENSAJE).size).toBe(32);
    expect(validarTextoMensaje(EMOJIS_MENSAJE.join('')).ok).toBe(true);
  });
});
