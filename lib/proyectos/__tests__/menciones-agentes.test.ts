import { describe, expect, it } from 'vitest';
import {
  AVISO_BUCLE_ASISTENTES,
  MAX_IDA_Y_VUELTA,
  MAX_SALTOS_AGENTE,
  MAX_SALTOS_POR_HORA,
  entregasDeAgenteEnHilo,
  idaYVueltaSeguidas,
  saltosDesdeUltimaPersona,
  type MensajeHilo,
} from '../menciones-agentes';
import { entregasHiloProyecto } from '../hilos-rules';

/*
 * Menciones entre asistentes en hilos de proyecto (2026-11-12): un asistente
 * puede despertar con @ a otro asistente del proyecto, con frenos anti-bucle.
 */
const ORUS = { idAgent: 1, code: 'horus', displayName: 'Orus', handle: '@horus_gss_bot' };
const GALILEO = { idAgent: 2, code: 'galileo', displayName: 'Galileo', handle: null };
const VEGA = { idAgent: 3, code: 'vega', displayName: 'Vega', handle: '@vega_gss_bot' };
const CANDIDATOS = [ORUS, GALILEO, VEGA];

const base = {
  idAgentAutor: ORUS.idAgent,
  candidatos: CANDIDATOS,
  esMesa: false,
  saltosDesdePersona: [],
  saltosUltimaHora: 0,
};

describe('entregasDeAgenteEnHilo', () => {
  it('la mención de un asistente a otro del proyecto se entrega (code, nombre o handle)', () => {
    expect(entregasDeAgenteEnHilo({ ...base, body: '@galileo ¿me revisa el cronograma?' })).toEqual({ idAgents: [2], freno: null });
    expect(entregasDeAgenteEnHilo({ ...base, body: 'Le pregunto a @Vega_gss_bot y a @Galileo' })).toEqual({ idAgents: [3, 2], freno: null });
  });

  it('la autorreferencia se ignora', () => {
    expect(entregasDeAgenteEnHilo({ ...base, body: 'Soy @horus y sigo trabajando' })).toEqual({ idAgents: [], freno: null });
    expect(entregasDeAgenteEnHilo({ ...base, body: '@horus_gss_bot y @galileo' }).idAgents).toEqual([2]);
  });

  it('un asistente fuera del proyecto (o no elegible) se ignora', () => {
    expect(entregasDeAgenteEnHilo({ ...base, body: '@mechita ayúdeme' })).toEqual({ idAgents: [], freno: null });
    // Sin candidatos (p. ej. ninguna persona ha escrito en el hilo): nadie.
    expect(entregasDeAgenteEnHilo({ ...base, candidatos: [], body: '@galileo' })).toEqual({ idAgents: [], freno: null });
  });

  it('una arroba dentro de un bloque de código o pegada a un correo no menciona', () => {
    expect(entregasDeAgenteEnHilo({ ...base, body: 'Escriba a soporte@galileo.com\n```\n@galileo\n```' }).idAgents).toEqual([]);
  });

  it('un mensaje de asistente que empieza por «/» nunca se entrega (sería un comando en el otro puente)', () => {
    expect(entregasDeAgenteEnHilo({ ...base, body: '/clear @galileo' })).toEqual({ idAgents: [], freno: null });
  });

  it('freno de PROFUNDIDAD: al llegar a MAX_SALTOS_AGENTE saltos sin persona, se corta', () => {
    const saltos = [
      { autor: 1, destinos: [2] },
      { autor: 2, destinos: [3] },
      { autor: 3, destinos: [1] },
    ].slice(0, MAX_SALTOS_AGENTE);
    expect(entregasDeAgenteEnHilo({ ...base, body: '@galileo otra vez', saltosDesdePersona: saltos })).toEqual({
      idAgents: [],
      freno: 'profundidad',
    });
    // Un salto menos: pasa.
    expect(
      entregasDeAgenteEnHilo({ ...base, body: '@vega', saltosDesdePersona: saltos.slice(0, MAX_SALTOS_AGENTE - 1) }).freno
    ).toBeNull();
  });

  it('freno de RITMO: con MAX_SALTOS_POR_HORA saltos en la última hora, se corta aunque una persona haya escrito', () => {
    expect(entregasDeAgenteEnHilo({ ...base, body: '@galileo', saltosUltimaHora: MAX_SALTOS_POR_HORA })).toEqual({
      idAgents: [],
      freno: 'ritmo',
    });
    expect(entregasDeAgenteEnHilo({ ...base, body: '@galileo', saltosUltimaHora: MAX_SALTOS_POR_HORA - 1 }).freno).toBeNull();
  });

  it('freno de IDA Y VUELTA: A→B, B→A pasa; el tercer rebote seguido entre el mismo par se corta', () => {
    // Orus→Galileo y Galileo→Orus: es el caso legítimo (pregunta y respuesta).
    expect(
      entregasDeAgenteEnHilo({ ...base, idAgentAutor: 2, body: '@horus listo', saltosDesdePersona: [{ autor: 1, destinos: [2] }] }).freno
    ).toBeNull();
    const pingPong = [
      { autor: 1, destinos: [2] },
      { autor: 2, destinos: [1] },
    ];
    expect(MAX_IDA_Y_VUELTA).toBe(2);
    expect(entregasDeAgenteEnHilo({ ...base, body: '@galileo ¿y ahora?', saltosDesdePersona: pingPong })).toEqual({
      idAgents: [],
      freno: 'ida-y-vuelta',
    });
    // A un tercero no es ida y vuelta.
    expect(entregasDeAgenteEnHilo({ ...base, body: '@vega', saltosDesdePersona: pingPong }).freno).toBeNull();
  });

  it('sin menciones válidas no hay freno (no hay aviso que publicar)', () => {
    const saltos = [
      { autor: 1, destinos: [2] },
      { autor: 2, destinos: [3] },
      { autor: 3, destinos: [1] },
    ];
    expect(entregasDeAgenteEnHilo({ ...base, body: 'Gracias a todos', saltosDesdePersona: saltos })).toEqual({ idAgents: [], freno: null });
  });

  it('MESAS sin cambio: en una mesa de discusión un asistente no despierta a nadie con @', () => {
    expect(entregasDeAgenteEnHilo({ ...base, esMesa: true, body: '@galileo opine' })).toEqual({ idAgents: [], freno: null });
  });

  it('el aviso de corte es el pedido', () => {
    expect(AVISO_BUCLE_ASISTENTES).toBe(
      'Se pausó la conversación entre asistentes para evitar un bucle; escriba en el hilo para continuar.'
    );
  });
});

describe('saltosDesdeUltimaPersona', () => {
  const m = (role: string, extra: Partial<MensajeHilo> = {}): MensajeHilo => ({
    role,
    id_agent_author: null,
    id_user_author: null,
    deliveries: [],
    ...extra,
  });

  it('cuenta solo mensajes de asistente que despertaron a otro, desde la última persona; la persona reinicia la cuenta', () => {
    const hilo = [
      m('agent', { id_agent_author: 1, deliveries: [{ id_agent: 2 }] }),
      m('user', { id_user_author: 'u-ana' }),
      m('agent', { id_agent_author: 1 }), // intermedio del mismo turno: no cuenta
      m('agent', { id_agent_author: 1, deliveries: [{ id_agent: 2 }] }),
      m('system'),
      m('agent', { id_agent_author: 2, deliveries: [{ id_agent: 1 }] }),
    ];
    expect(saltosDesdeUltimaPersona(hilo)).toEqual({
      saltos: [
        { autor: 1, destinos: [2] },
        { autor: 2, destinos: [1] },
      ],
      idUserOrigen: 'u-ana',
    });
  });

  it('sin persona en lo leído: idUserOrigen null', () => {
    expect(saltosDesdeUltimaPersona([m('agent', { id_agent_author: 1 })]).idUserOrigen).toBeNull();
  });
});

describe('idaYVueltaSeguidas', () => {
  it('cuenta los rebotes seguidos al final, incluido el nuevo', () => {
    expect(idaYVueltaSeguidas([], { autor: 1, destinos: [2] })).toBe(1);
    expect(idaYVueltaSeguidas([{ autor: 1, destinos: [2] }], { autor: 2, destinos: [1] })).toBe(2);
    expect(
      idaYVueltaSeguidas([{ autor: 3, destinos: [1] }, { autor: 1, destinos: [2] }], { autor: 2, destinos: [1] })
    ).toBe(2);
  });
});

describe('menciones de PERSONA sin cambio', () => {
  it('una persona sigue despertando al mencionado y el principal no atiende si solo mencionó a otros', () => {
    expect(entregasHiloProyecto({ body: '@galileo revise', mencionables: [GALILEO], principal: ORUS })).toEqual({
      invitados: [2],
      principalAtiende: false,
    });
  });
});
