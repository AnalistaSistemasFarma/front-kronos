import { describe, expect, it } from 'vitest';
import { esc, fechaLarga, htmlHojaDeVida, num } from '../cv-pdf';
import type { HojaDeVida } from '../cv-db';

const totales = {
  mensajesRecibidos: 1234,
  mensajesEnviados: 1200,
  conversaciones: 3,
  turnos: 40,
  tokensTotal: 2_786_758,
  tokensEntrada: 0,
  tokensSalida: 0,
  tokensCacheCreacion: 0,
  tokensCacheLectura: 0,
  diasActivos: 12,
  usuariosActivos: 4,
};

const ficha = {
  agente: {
    idAgent: 1,
    code: 'horus',
    displayName: 'Orus <script>alert(1)</script>',
    handle: '@horus_gss_bot',
    description: null,
    activo: true,
    creadoEl: '2026-09-06T18:07:52.000Z',
    permiso: 'Asistente Orus',
    empresas: [{ nombre: 'GSS', principal: true }],
    avatar: null,
  },
  perfil: {
    purpose: 'Propósito con "comillas" & <b>html</b>',
    ownerName: 'Nicolás Rivera',
    ownerEmail: 'nicolas.rivera@gsslatam.com',
    updatedBy: 'nicolas.rivera@gsslatam.com',
    updatedAt: '2026-10-02T15:00:00.000Z',
  },
  usuarios: [],
  inventario: null,
  metricas: {
    calculadoEl: null,
    desde30: '2026-09-03',
    hasta: '2026-10-02',
    ultimos30: totales,
    historico: { ...totales, primerDia: '2026-09-06' },
    dias: [
      { dia: '2026-10-01', recibidos: 3, enviados: 2, tokens: 10, usuarios: 1 },
      { dia: '2026-10-02', recibidos: 0, enviados: 0, tokens: 0, usuarios: 0 },
    ],
  },
  historial: [],
  hallazgos: { abiertos: [], cerrados: [] },
  resumenes: [],
} as unknown as HojaDeVida;

describe('hoja de vida en PDF', () => {
  it('escapa todo el texto que viene de la base', () => {
    const html = htmlHojaDeVida(ficha, { generadoPor: 'qa@x.com', generadoEl: new Date(), logo: null });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>html</b>');
    expect(esc(`"'&`)).toBe('&quot;&#39;&amp;');
  });
  it('cifras y fechas en formato colombiano', () => {
    expect(num(2786758)).toBe('2.786.758');
    expect(fechaLarga('2026-09-28')).toBe('28 de septiembre de 2026');
  });
  it('no menciona contenido de conversaciones', () => {
    const html = htmlHojaDeVida(ficha, { generadoPor: 'qa@x.com', generadoEl: new Date(), logo: null });
    expect(html).toContain('No contiene el texto de las conversaciones');
  });
});
