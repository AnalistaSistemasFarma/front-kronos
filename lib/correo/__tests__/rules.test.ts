import { describe, expect, it } from 'vitest';
import { agruparPorHilo, alertasDeFila, filaDesdeHilo, normalizarAsunto, notaDesdeCorreo, notaDesdeRespuesta, parseFilaCrear, parseSeleccion, sugerirProceso, type ContextoSimulacion } from '../rules';
import type { MensajeCompleto } from '../types';

function msg(p: Partial<MensajeCompleto> & { id: string }): MensajeCompleto {
  return {
    conversationId: 'CONV1AAAAA',
    internetMessageId: `<${p.id}@x>`,
    asunto: 'RE: RV: Contrato de arrendamiento',
    de: { nombre: 'Uno', correo: 'uno@gsslatam.com' },
    fecha: '2026-10-14T10:00:00Z',
    leido: false,
    conAdjuntos: false,
    extracto: '',
    categorias: [],
    para: [],
    cc: [],
    html: '<p>Cuerpo del correo</p>',
    adjuntos: [],
    ...p,
  };
}

const procesos = [
  { id: 10, nombre: 'Elaboración y revisión de contratos' },
  { id: 20, nombre: 'Solicitud de poderes', descripcion: 'Poder especial' },
  { id: 30, nombre: 'Registro de marcas' },
];

const ctx = (extra: Partial<ContextoSimulacion> = {}): ContextoSimulacion => ({
  idOperador: 'op',
  idCompany: 1,
  procesos,
  procesoPredeterminado: null,
  usuarios: new Map([['uno@gsslatam.com', { id: 'u1', nombre: 'Uno', correo: 'uno@gsslatam.com', empresas: [1] }]]),
  duplicados: new Map(),
  dominiosGrupo: ['gsslatam.com'],
  ...extra,
});

describe('Correo · reglas de la simulación', () => {
  it('normaliza el asunto (RE/RV/FW repetidos) y lo recorta', () => {
    expect(normalizarAsunto('RE: RV: FW:  Contrato   X')).toBe('Contrato X');
    expect(normalizarAsunto('Re : asunto')).toBe('asunto');
    expect(normalizarAsunto('   ')).toBe('(Sin asunto)');
    expect(normalizarAsunto('x'.repeat(400))).toHaveLength(255);
    expect(normalizarAsunto('Reunión de equipo')).toBe('Reunión de equipo');
  });

  it('sugiere el proceso por palabras clave (con sinónimos) y si no, el predeterminado', () => {
    expect(sugerirProceso('Otrosí al contrato de mantenimiento', procesos, null)).toEqual({ id: 10, por: 'palabra-clave' });
    expect(sugerirProceso('Necesito un poder', procesos, null)).toEqual({ id: 20, por: 'palabra-clave' });
    expect(sugerirProceso('Consulta sobre marcas', procesos, null)).toEqual({ id: 30, por: 'palabra-clave' });
    expect(sugerirProceso('Hola', procesos, 30)).toEqual({ id: 30, por: 'predeterminado' });
    expect(sugerirProceso('Hola', procesos, 999)).toEqual({ id: null, por: null });
  });

  it('correo enviado a sí mismo: la copia de Enviados y la de Bandeja de entrada (mismo internetMessageId) son UN correo', () => {
    const g = agruparPorHilo([
      msg({ id: 'INBOXAAAAA', internetMessageId: '<propio@x>', fecha: '2026-10-15T20:50:35Z' }),
      msg({ id: 'SENTAAAAAA', internetMessageId: '<propio@x>', fecha: '2026-10-15T20:50:34Z' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toHaveLength(1);
    const f = filaDesdeHilo(g[0], ctx());
    expect(f.mensajesIds).toHaveLength(1);
  });

  it('agrupa por hilo, del más antiguo al más reciente', () => {
    const g = agruparPorHilo([msg({ id: 'B', fecha: '2026-10-15T00:00:00Z' }), msg({ id: 'X', conversationId: 'OTROAAAAAA' }), msg({ id: 'A', fecha: '2026-10-13T00:00:00Z' })]);
    expect(g.map((x) => x.map((m) => m.id))).toEqual([['A', 'B'], ['X']]);
  });

  it('fila lista: solicitante = remitente (usuario de SynerLink), título sin RE, descripción con extracto', () => {
    const f = filaDesdeHilo([msg({ id: 'M1AAAAAAAA', adjuntos: [{ id: 'AD1', nombre: 'a.pdf', tipo: 'application/pdf', tamano: 1, enLinea: false }] })], ctx());
    expect(f).toMatchObject({ idSolicitante: 'u1', titulo: 'Contrato de arrendamiento', idProcess: 10, incluir: true, alertas: [] });
    expect(f.descripcion).toContain('Correo de Uno <uno@gsslatam.com> del 2026-10-14.');
    expect(f.descripcion).toContain('Cuerpo del correo');
    expect(f.adjuntos).toHaveLength(1);
  });

  it('alertas: duplicado (por correo o por hilo), sin usuario, externo y autosolicitud; se excluye lo que no se puede crear', () => {
    const dup = filaDesdeHilo([msg({ id: 'M1AAAAAAAA' })], ctx({ duplicados: new Map([['<M1AAAAAAAA@x>', 55]]) }));
    expect(dup.duplicadoDe).toBe(55);
    expect(dup.alertas).toContain('DUPLICADO');
    expect(dup.incluir).toBe(false);
    const porHilo = filaDesdeHilo([msg({ id: 'M1AAAAAAAA' })], ctx({ duplicados: new Map([['CONV1AAAAA', 9]]) }));
    expect(porHilo.duplicadoDe).toBe(9);
    const ext = filaDesdeHilo([msg({ id: 'M1AAAAAAAA', de: { nombre: 'Ext', correo: 'x@externo.com' } })], ctx());
    expect(ext.alertas).toEqual(expect.arrayContaining(['EXTERNO', 'SIN_USUARIO']));
    expect(ext.incluir).toBe(false);
    const yo = filaDesdeHilo([msg({ id: 'M1AAAAAAAA' })], ctx({ idOperador: 'u1' }));
    expect(yo.alertas).toContain('AUTOSOLICITUD');
    expect(yo.incluir).toBe(true);
    const sinProc = filaDesdeHilo([msg({ id: 'M1AAAAAAAA', asunto: 'Hola' })], ctx());
    expect(sinProc.alertas).toContain('SIN_PROCESO');
    const otraEmpresa = alertasDeFila(
      { duplicadoDe: null, idSolicitante: 'u1', idProcess: 1, remitente: { nombre: '', correo: 'uno@gsslatam.com' }, idCompany: 3 },
      ctx()
    );
    expect(otraEmpresa).toContain('SOLICITANTE_OTRA_EMPRESA');
  });

  it('parseFilaCrear solo acepta los campos editables y valida', () => {
    const ok = parseFilaCrear({ conversationId: 'CONV1AAAAA', mensajeId: 'M1AAAAAAAA', idCompany: '1', idProcess: 10, idSolicitante: 'u1', titulo: ' Hola  mundo ', descripcion: 'x'.repeat(1200), adjuntosIds: ['AD1AAAAAAA', '../x'], etiquetar: false, idUser: 'otro', mailbox: 'otro@x' });
    expect(ok).toEqual({ conversationId: 'CONV1AAAAA', mensajeId: 'M1AAAAAAAA', idCompany: 1, idProcess: 10, idSolicitante: 'u1', titulo: 'Hola mundo', descripcion: 'x'.repeat(1000), adjuntosIds: ['AD1AAAAAAA'], etiquetar: false });
    expect(() => parseFilaCrear({})).toThrow(/Correo inválido/);
    expect(() => parseFilaCrear({ conversationId: 'CONV1AAAAA', mensajeId: 'M1AAAAAAAA' })).toThrow(/empresa/);
    expect(() => parseFilaCrear({ conversationId: 'CONV1AAAAA', mensajeId: 'M1AAAAAAAA', idCompany: 1 })).toThrow(/proceso/);
    expect(() => parseFilaCrear({ conversationId: 'CONV1AAAAA', mensajeId: 'M1AAAAAAAA', idCompany: 1, idProcess: 2, idSolicitante: "x' or 1=1" })).toThrow(/solicitante/);
    expect(() => parseFilaCrear({ conversationId: 'CONV1AAAAA', mensajeId: 'M1AAAAAAAA', idCompany: 1, idProcess: 2, idSolicitante: 'u', titulo: 'a' })).toThrow(/título/);
    expect(() => parseFilaCrear({ conversationId: 'CONV1AAAAA', mensajeId: 'M1AAAAAAAA', idCompany: 1, idProcess: 2, idSolicitante: 'u', titulo: 'abc' })).toThrow(/descripción/);
  });

  it('parseSeleccion: únicos, válidos y máximo 50', () => {
    expect(parseSeleccion({ mensajesIds: ['M1AAAAAAAA', 'M1AAAAAAAA'] })).toEqual(['M1AAAAAAAA']);
    expect(() => parseSeleccion({})).toThrow(/al menos/);
    expect(() => parseSeleccion({ mensajesIds: Array.from({ length: 51 }, (_, i) => `M${i}AAAAAAAAA`) })).toThrow(/50/);
    expect(() => parseSeleccion({ mensajesIds: ['../x'] })).toThrow(/inválidos/);
  });

  it('notas: extracto del correo y de la respuesta, con tope', () => {
    const n = notaDesdeCorreo(msg({ id: 'M', html: '<p>Nuevo dato</p>' }), 2000);
    expect(n).toContain('Correo recibido en el hilo vinculado — de Uno <uno@gsslatam.com>');
    expect(n).toContain('Nuevo dato');
    const r = notaDesdeRespuesta({ operador: 'Laura', para: ['a@b.com'], texto: 'Listo', adjuntos: ['x.pdf'], todos: true }, 2000);
    expect(r).toContain('por Laura a todos — para: a@b.com');
    expect(r).toContain('Adjuntos: x.pdf');
    expect(notaDesdeCorreo(msg({ id: 'M', html: `<p>${'z '.repeat(3000)}</p>` }), 500).length).toBeLessThanOrEqual(500);
  });
});
