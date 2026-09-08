import { describe, expect, it } from 'vitest';
import {
  AVISO_CADENA_CORTADA,
  MAX_TURNOS_AGENTE_SEGUIDOS,
  calcularEntregas,
  contarTurnosDeAgenteAlFinal,
  extraerMenciones,
  puedeEntregarseAAgentes,
  resolverAgentesMencionados,
  type AgenteMencionable,
} from '../groups';

const PLAN: AgenteMencionable = {
  idAgent: 20,
  code: 'plan',
  displayName: 'Plan',
  handle: '@plan_gss_bot',
};
const ORUS: AgenteMencionable = {
  idAgent: 1,
  code: 'horus',
  displayName: 'Orus',
  handle: '@horus_gss_bot',
};
const LEXA: AgenteMencionable = {
  idAgent: 9,
  code: 'laura',
  displayName: 'Lexa',
  handle: '@laura_gss_bot',
};
const GRUPO = [PLAN, ORUS, LEXA];

describe('extraerMenciones', () => {
  it('encuentra una mención simple', () => {
    expect(extraerMenciones('hola @plan, ¿cómo va?')).toEqual(['plan']);
  });

  it('conserva los guiones bajos de los handles de la flota', () => {
    expect(extraerMenciones('@plan_gss_bot revise esto')).toEqual(['plan_gss_bot']);
  });

  it('encuentra varias menciones sin repetir', () => {
    expect(extraerMenciones('@orus y @plan y otra vez @orus')).toEqual(['orus', 'plan']);
  });

  it('reconoce la mención al inicio del texto', () => {
    expect(extraerMenciones('@orus arranque')).toEqual(['orus']);
  });

  // La razón por la que existe la condición de "arroba no pegada a texto".
  it('NO confunde un correo con una mención', () => {
    expect(extraerMenciones('escríbale a nicolas.rivera@gsslatam.com')).toEqual([]);
  });

  it('recorta la puntuación final', () => {
    expect(extraerMenciones('avísele a @plan.')).toEqual(['plan']);
    expect(extraerMenciones('¿y @orus?')).toEqual(['orus']);
  });

  it('ignora lo que venga dentro de un bloque de código', () => {
    const body = ['mire esto:', '```', 'curl -H "From: @plan"', '```', 'y ya'].join('\n');
    expect(extraerMenciones(body)).toEqual([]);
  });

  it('ignora el código en línea', () => {
    expect(extraerMenciones('el campo `@type` del JSON')).toEqual([]);
  });

  it('devuelve vacío con entradas degeneradas', () => {
    expect(extraerMenciones('')).toEqual([]);
    expect(extraerMenciones('sin arrobas')).toEqual([]);
    expect(extraerMenciones(undefined as unknown as string)).toEqual([]);
  });
});

describe('resolverAgentesMencionados', () => {
  it('acepta el code, el nombre visible y el handle como la misma cosa', () => {
    expect(resolverAgentesMencionados('@plan', GRUPO)).toEqual([PLAN]);
    expect(resolverAgentesMencionados('@Plan', GRUPO)).toEqual([PLAN]);
    expect(resolverAgentesMencionados('@plan_gss_bot', GRUPO)).toEqual([PLAN]);
    // 'horus' es el code y 'Orus' el nombre visible: los dos son válidos.
    expect(resolverAgentesMencionados('@horus', GRUPO)).toEqual([ORUS]);
    expect(resolverAgentesMencionados('@orus', GRUPO)).toEqual([ORUS]);
  });

  it('ignora a quien no está en el grupo', () => {
    expect(resolverAgentesMencionados('@mechita revise', GRUPO)).toEqual([]);
  });

  it('no repite un agente mencionado por dos nombres distintos', () => {
    const r = resolverAgentesMencionados('@plan y @plan_gss_bot', GRUPO);
    expect(r).toHaveLength(1);
    expect(r[0].idAgent).toBe(20);
  });

  it('devuelve varios en el orden en que aparecen', () => {
    expect(resolverAgentesMencionados('@lexa primero y @plan después', GRUPO)).toEqual([LEXA, PLAN]);
  });
});

describe('contarTurnosDeAgenteAlFinal', () => {
  it('cuenta cero si el último es de una persona', () => {
    expect(contarTurnosDeAgenteAlFinal([{ role: 'agent' }, { role: 'user' }])).toBe(0);
  });

  it('cuenta los mensajes de agente del final', () => {
    expect(
      contarTurnosDeAgenteAlFinal([{ role: 'user' }, { role: 'agent' }, { role: 'agent' }])
    ).toBe(2);
  });

  it('para en el primer mensaje de una persona hacia atrás', () => {
    expect(
      contarTurnosDeAgenteAlFinal([
        { role: 'agent' },
        { role: 'agent' },
        { role: 'user' },
        { role: 'agent' },
      ])
    ).toBe(1);
  });

  // Si el aviso reiniciara la cuenta, el propio aviso habilitaría dos turnos
  // más y el tope no serviría de nada.
  it('los mensajes de sistema no cuentan NI reinician la cuenta', () => {
    expect(
      contarTurnosDeAgenteAlFinal([
        { role: 'user' },
        { role: 'agent' },
        { role: 'system' },
        { role: 'agent' },
      ])
    ).toBe(2);
  });

  it('un hilo vacío no tiene turnos', () => {
    expect(contarTurnosDeAgenteAlFinal([])).toBe(0);
  });
});

describe('puedeEntregarseAAgentes', () => {
  it('una persona siempre puede despertar a un agente', () => {
    expect(puedeEntregarseAAgentes(false, 0)).toBe(true);
    expect(puedeEntregarseAAgentes(false, 99)).toBe(true);
  });

  it('deja pasar los primeros turnos entre agentes', () => {
    expect(puedeEntregarseAAgentes(true, 0)).toBe(true);
    expect(puedeEntregarseAAgentes(true, 1)).toBe(true);
  });

  it('corta al llegar al tope', () => {
    expect(puedeEntregarseAAgentes(true, MAX_TURNOS_AGENTE_SEGUIDOS)).toBe(false);
    expect(puedeEntregarseAAgentes(true, MAX_TURNOS_AGENTE_SEGUIDOS + 5)).toBe(false);
  });

  it('respeta un tope pasado a mano', () => {
    expect(puedeEntregarseAAgentes(true, 0, 1)).toBe(true);
    expect(puedeEntregarseAAgentes(true, 1, 1)).toBe(false);
  });
});

describe('calcularEntregas', () => {
  it('sin menciones no despierta a nadie', () => {
    expect(
      calcularEntregas({
        body: 'buenos días a todos',
        agentesDelGrupo: GRUPO,
        idAgentAutor: null,
        turnosPrevios: 0,
      })
    ).toEqual({ idAgents: [], cadenaCortada: false });
  });

  it('entrega a los mencionados cuando escribe una persona', () => {
    expect(
      calcularEntregas({
        body: '@plan y @lexa, revisen esto',
        agentesDelGrupo: GRUPO,
        idAgentAutor: null,
        turnosPrevios: 0,
      })
    ).toEqual({ idAgents: [20, 9], cadenaCortada: false });
  });

  it('un agente no se menciona a sí mismo', () => {
    expect(
      calcularEntregas({
        body: '@plan yo mismo y @lexa',
        agentesDelGrupo: GRUPO,
        idAgentAutor: 20,
        turnosPrevios: 0,
      })
    ).toEqual({ idAgents: [9], cadenaCortada: false });
  });

  it('corta la cadena al llegar al tope y lo reporta', () => {
    const r = calcularEntregas({
      body: '@lexa siga usted',
      agentesDelGrupo: GRUPO,
      idAgentAutor: 20,
      turnosPrevios: MAX_TURNOS_AGENTE_SEGUIDOS,
    });
    expect(r.idAgents).toEqual([]);
    expect(r.cadenaCortada).toBe(true);
  });

  // Que se haya alcanzado el tope no debe inventar un aviso si de todas formas
  // no había a quién entregarle.
  it('no reporta corte si no había menciones válidas', () => {
    expect(
      calcularEntregas({
        body: 'ya quedó, gracias',
        agentesDelGrupo: GRUPO,
        idAgentAutor: 20,
        turnosPrevios: MAX_TURNOS_AGENTE_SEGUIDOS,
      })
    ).toEqual({ idAgents: [], cadenaCortada: false });
  });

  it('una persona reactiva el grupo aunque los agentes estuvieran topados', () => {
    const r = calcularEntregas({
      body: '@plan siga',
      agentesDelGrupo: GRUPO,
      idAgentAutor: null,
      turnosPrevios: MAX_TURNOS_AGENTE_SEGUIDOS + 3,
    });
    expect(r.idAgents).toEqual([20]);
    expect(r.cadenaCortada).toBe(false);
  });
});

describe('AVISO_CADENA_CORTADA', () => {
  it('nombra el tope real, para que el texto no se desincronice', () => {
    expect(AVISO_CADENA_CORTADA).toContain(String(MAX_TURNOS_AGENTE_SEGUIDOS));
  });
});
