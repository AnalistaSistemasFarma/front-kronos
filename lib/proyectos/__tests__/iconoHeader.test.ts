import { describe, expect, it } from 'vitest';
import {
  ariaIconoProyectos,
  debeMostrarIconoProyectos,
  estadoDesdeRespuesta,
  estadoVencido,
  etiquetaNoLeidos,
  horaCorta,
  leerEstadoGuardado,
  sinConversacion,
  urlConversacion,
  type ItemNoLeidoDto,
} from '../iconoHeader';

const item = (idConversation: number, noLeidos: number): ItemNoLeidoDto => ({
  idProject: 4,
  projectName: 'Comex',
  idConversation,
  conversationTitle: 'Importaciones',
  agent: { code: 'play', displayName: 'Play' },
  noLeidos,
  ultimo: null,
});

describe('icono «Proyectos» de la cabecera (lógica pura)', () => {
  it('solo se pinta con 200 del servidor y para la misma sesión', () => {
    const ok = estadoDesdeRespuesta('Ana@gsslatam.com', 200, { noLeidos: 3, mensajes: 7 }, 1);
    expect(ok).toMatchObject({ visible: true, noLeidos: 3, mensajes: 7 });
    expect(debeMostrarIconoProyectos('ana@gsslatam.com', ok)).toBe(true);
    expect(debeMostrarIconoProyectos('otra@gsslatam.com', ok)).toBe(false);
    expect(debeMostrarIconoProyectos(null, ok)).toBe(false);
    for (const status of [401, 403, 500]) {
      const e = estadoDesdeRespuesta('ana@gsslatam.com', status, { noLeidos: 3 }, 1);
      expect(debeMostrarIconoProyectos('ana@gsslatam.com', e)).toBe(false);
      expect(e.noLeidos).toBeNull();
    }
    // Sin el módulo el servidor responde 200 { habilitado: false }: tampoco se pinta.
    const sinModulo = estadoDesdeRespuesta('ana@gsslatam.com', 200, { habilitado: false }, 1);
    expect(sinModulo).toMatchObject({ visible: false, noLeidos: null });
    expect(debeMostrarIconoProyectos('ana@gsslatam.com', sinModulo)).toBe(false);
  });

  it('sin el módulo se vuelve a preguntar cada 30 min, no cada 3', () => {
    const e = estadoDesdeRespuesta('a@b', 200, { habilitado: false }, 1_000);
    expect(estadoVencido(e, 'a@b', 1_000 + 3 * 60_000)).toBe(false);
    expect(estadoVencido(e, 'a@b', 1_000 + 30 * 60_000)).toBe(true);
  });

  it('descarta números raros del servidor', () => {
    expect(estadoDesdeRespuesta('a@b', 200, { noLeidos: -1, mensajes: 'x' }, 1)).toMatchObject({ noLeidos: null, mensajes: null });
    expect(estadoDesdeRespuesta('a@b', 200, { noLeidos: 2.7 }, 1).noLeidos).toBe(2);
  });

  it('caché: vence por TTL, por reloj hacia atrás o al cambiar de persona', () => {
    const e = estadoDesdeRespuesta('a@b', 200, { noLeidos: 1 }, 1_000);
    expect(estadoVencido(e, 'a@b', 1_000 + 60_000)).toBe(false);
    expect(estadoVencido(e, 'a@b', 1_000 + 3 * 60_000)).toBe(true);
    expect(estadoVencido(e, 'a@b', 500)).toBe(true);
    expect(estadoVencido(e, 'c@d', 1_001)).toBe(true);
    expect(estadoVencido(null, 'a@b', 1)).toBe(true);
  });

  it('contador y etiqueta accesible', () => {
    expect(etiquetaNoLeidos(0)).toBeNull();
    expect(etiquetaNoLeidos(5)).toBe('5');
    expect(etiquetaNoLeidos(150)).toBe('99+');
    expect(ariaIconoProyectos(0)).toBe('Proyectos');
    expect(ariaIconoProyectos(1)).toBe('Proyectos: 1 conversación con mensajes nuevos');
    expect(ariaIconoProyectos(4)).toBe('Proyectos: 4 conversaciones con mensajes nuevos');
  });

  it('el enlace abre ESA conversación dentro de su proyecto', () => {
    expect(urlConversacion(4, 28)).toBe('/process/proyectos/4?conversacion=28');
  });

  it('abrir una fila la quita y descuenta al instante (optimista)', () => {
    const estado = estadoDesdeRespuesta('a@b', 200, { noLeidos: 2, mensajes: 5 }, 1);
    const r = sinConversacion(estado, [item(1, 3), item(2, 2)], 1);
    expect(r.items.map((i) => i.idConversation)).toEqual([2]);
    expect(r.estado).toMatchObject({ noLeidos: 1, mensajes: 2 });
    // Una fila que no está no cambia nada.
    expect(sinConversacion(estado, [item(2, 2)], 9).estado).toBe(estado);
  });

  it('hora corta en español', () => {
    const ahora = Date.parse('2026-10-19T15:00:00Z');
    expect(horaCorta('2026-10-19T14:59:40Z', ahora)).toBe('Ahora');
    expect(horaCorta('2026-10-19T14:50:00Z', ahora)).toBe('Hace 10 min');
    expect(horaCorta('2026-10-19T12:00:00Z', ahora)).toBe('Hace 3 h');
    expect(horaCorta('2026-10-18T10:05:00Z', ahora)).toMatch(/^Ayer \d{2}:\d{2}$/);
    expect(horaCorta('no-es-fecha', ahora)).toBe('');
  });

  it('el estado guardado se valida al leerlo y nunca lanza', () => {
    expect(leerEstadoGuardado({ getItem: () => '{malo' })).toBeNull();
    expect(leerEstadoGuardado({ getItem: () => JSON.stringify({ email: 'a@b', visible: 'si', en: 1 }) })).toBeNull();
    expect(leerEstadoGuardado({ getItem: () => JSON.stringify({ email: 'a@b', visible: true, en: 1, noLeidos: 2 }) })).toMatchObject({ noLeidos: 2, mensajes: null });
    expect(leerEstadoGuardado({ getItem: () => { throw new Error('bloqueado'); } })).toBeNull();
  });
});
