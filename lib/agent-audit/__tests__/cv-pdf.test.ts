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

describe('hoja de vida completa en PDF (incremento 1)', () => {
  const completa = {
    ejecucion: {
      vistoEl: '2026-10-20T07:30:00.000Z',
      authMode: 'token',
      authDetail: null,
      tokenFingerprint: '51de66cc7ed6',
      compartidaCon: ['Cosmo'],
      processStartedAt: '2026-10-20T06:00:02.000Z',
      lastRotationAt: null,
      lastRotationStatus: null,
      lastRotationDetail: null,
      personaFingerprint: 'dbed81a1b8ae',
      personaFiles: ['CLAUDE.md'],
      governance: [{ marker: 'GOBIERNO-IA-MINPRIV', addedOn: '2026-10-19', author: 'horus', caseRef: 6212, text: 'Usted NO ejecuta <comandos>', file: 'AGENTS.md' }],
      usageHook: false,
    },
    gobierno: { directorName: null, directorEmail: null, privilegeTemplate: 'Plantilla A — sin SAP', privilegeAppliedOn: '2026-10-19', notes: null, updatedBy: null, updatedAt: '2026-10-20T07:00:00.000Z' },
    casos: [
      {
        idRequest: 6212, relation: 'gobierno-ia', enEstaBase: true, asunto: 'Conectores Galileo', proceso: 'Solicitud de conectores para agentes IA', empresa: 'ONE LATAM PHARMA',
        estado: 'Abierto', creadoEl: '2026-10-16T15:00:00.000Z', resueltoEl: null, vinculadoPor: null, vinculadoEl: '2026-10-20T07:00:00.000Z',
        tareas: [{ id: 7398, tarea: 'Auditoria de seguridad', estado: 'Sin Empezar', responsable: 'Iván Gutiérrez', inicio: null, resueltaEl: null }],
      },
    ],
    eventosCasos: [{ occurredAt: '2026-10-16T15:00:00.000Z', kind: 'caso', title: 'Se radicó el caso #6212', detail: null }],
    hallazgosExternos: [
      { id: 1, source: 'Gobierno IA (Iván Gutiérrez)', refCode: 'H-01', severity: 'alto', title: 'Hallazgo <i>uno</i>', detail: null, recommendation: 'Quitar exec', status: 'abierto', reportedOn: '2026-10-20', resolvedOn: null, idRequest: 6212, createdBy: null },
    ],
    calidad30: { preguntas: 10, respondidas: 9, sinRespuesta: 1, enEspera: 0, medianaSeg: 75, p90Seg: 600, tardias: 2, pendientes: 0, reportaConsumo: false },
  };

  it('trae identificación, gobierno, calidad, casos y hallazgos de Gobierno IA, escapados', () => {
    const html = htmlHojaDeVida(ficha, { generadoPor: 'qa@x.com', generadoEl: new Date(), logo: null, completa: completa as never });
    expect(html).toContain('huella <span class="mono">51de66cc7ed6</span>');
    expect(html).toContain('Compartida con Cosmo');
    expect(html).toContain('<h2>Gobierno vigente</h2>');
    expect(html).toContain('Plantilla A — sin SAP');
    expect(html).toContain('Usted NO ejecuta &lt;comandos&gt;');
    expect(html).toContain('<h2>Casos de SynerLink vinculados (1)</h2>');
    expect(html).toContain('Auditoria de seguridad');
    expect(html).toContain('Hallazgo &lt;i&gt;uno&lt;/i&gt;');
    expect(html).toContain('1 min');
    expect(html).toContain('El agente no reporta su consumo');
    expect(html).toContain('Se radicó el caso #6212');
  });

  it('sin los datos nuevos sigue generando la ficha de F2', () => {
    const html = htmlHojaDeVida(ficha, { generadoPor: 'qa@x.com', generadoEl: new Date(), logo: null });
    expect(html).not.toContain('Gobierno vigente');
    expect(html).toContain('Hallazgos automáticos abiertos');
  });
});
