import { describe, expect, it } from 'vitest';
import {
  AGENT_BAR_VISIBLE,
  agentInitials,
  agentColor,
  describeAgentStatus,
  findAgentByRouteKey,
  groupAgentsByCompany,
  normalizeAgentKey,
  sortAgentsForBar,
  toPlainPreview,
  type ChatAgentDto,
} from '../client';

function agent(partial: Partial<ChatAgentDto> & { idAgent: number; code: string }): ChatAgentDto {
  return {
    displayName: partial.code,
    handle: null,
    avatarUrl: null,
    description: null,
    sortOrder: 0,
    companies: [],
    ...partial,
  } as ChatAgentDto;
}

describe('agentInitials', () => {
  it('usa dos letras de un nombre simple', () => {
    expect(agentInitials('Orus')).toBe('OR');
  });

  it('usa la inicial de nombre y apellido', () => {
    expect(agentInitials('Ana Lucía')).toBe('AL');
  });

  it('no revienta con un nombre vacío', () => {
    expect(agentInitials('   ')).toBe('?');
  });
});

describe('agentColor', () => {
  it('es determinista', () => {
    expect(agentColor('horus')).toBe(agentColor('horus'));
  });

  it('reparte distintos agentes en distintos colores', () => {
    const colors = new Set(['horus', 'adriana', 'pedro', 'silvia'].map(agentColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('describeAgentStatus', () => {
  it('trata "sin estado" e "idle" como Disponible', () => {
    expect(describeAgentStatus(null).label).toBe('Disponible');
    expect(describeAgentStatus({ state: 'idle', label: null, updatedAt: '' }).label).toBe(
      'Disponible'
    );
    expect(describeAgentStatus(null).busy).toBe(false);
  });

  it('marca como ocupado los estados de trabajo y respeta la etiqueta del agente', () => {
    const thinking = describeAgentStatus({ state: 'thinking', label: null, updatedAt: '' });
    expect(thinking.busy).toBe(true);

    const tool = describeAgentStatus({ state: 'tool', label: 'Consultando SAP…', updatedAt: '' });
    expect(tool.busy).toBe(true);
    expect(tool.label).toBe('Consultando SAP…');
  });
});

describe('sortAgentsForBar', () => {
  const few = [
    agent({ idAgent: 1, code: 'a', displayName: 'A', sortOrder: 10 }),
    agent({ idAgent: 2, code: 'b', displayName: 'B', sortOrder: 20 }),
    agent({ idAgent: 3, code: 'c', displayName: 'C', sortOrder: 30 }),
  ];

  it('con pocos agentes NO reordena por pendientes (el orden se queda quieto)', () => {
    const unread = new Map([[3, 9]]);
    expect(sortAgentsForBar(few, unread).map((a) => a.idAgent)).toEqual([1, 2, 3]);
  });

  it('pasado el umbral, los pendientes se van al frente', () => {
    const many = [
      ...few,
      agent({ idAgent: 4, code: 'd', displayName: 'D', sortOrder: 40 }),
      agent({ idAgent: 5, code: 'e', displayName: 'E', sortOrder: 50 }),
      agent({ idAgent: 6, code: 'f', displayName: 'F', sortOrder: 60 }),
    ];
    expect(many.length).toBeGreaterThan(AGENT_BAR_VISIBLE);

    const unread = new Map([
      [6, 3],
      [4, 7],
    ]);
    expect(sortAgentsForBar(many, unread).map((a) => a.idAgent)).toEqual([4, 6, 1, 2, 3, 5]);
  });

  it('no muta el arreglo original', () => {
    const original = [...few];
    sortAgentsForBar(few, new Map());
    expect(few).toEqual(original);
  });
});

describe('groupAgentsByCompany', () => {
  it('crea una carpeta por empresa DEL AGENTE y repite al agente multiempresa', () => {
    const agents = [
      agent({
        idAgent: 1,
        code: 'horus',
        displayName: 'Orus',
        companies: [
          { idCompany: 8, companyName: 'GSS', isPrimary: true },
          { idCompany: 3, companyName: 'Farmalógica', isPrimary: false },
        ],
      }),
      agent({
        idAgent: 2,
        code: 'lisa',
        displayName: 'Lisa',
        companies: [{ idCompany: 3, companyName: 'Farmalógica', isPrimary: true }],
      }),
    ];

    const folders = groupAgentsByCompany(agents);
    expect(folders.map((f) => f.companyName)).toEqual(['Farmalógica', 'GSS']);
    expect(folders[0].agents.map((a) => a.code).sort()).toEqual(['horus', 'lisa']);
    expect(folders[1].agents.map((a) => a.code)).toEqual(['horus']);
  });

  it('un agente sin empresas no crea carpeta (no se inventa una)', () => {
    expect(groupAgentsByCompany([agent({ idAgent: 1, code: 'x' })])).toEqual([]);
  });
});

describe('toPlainPreview', () => {
  it('quita las marcas de Markdown del extracto de la bandeja', () => {
    const preview =
      'Con gusto, aqui va el **corte de compras**. ### Resumen | Documento | Cantidad | |---|---:|';
    const plain = toPlainPreview(preview);
    expect(plain).not.toContain('**');
    expect(plain).not.toContain('###');
    expect(plain).not.toContain('|');
    expect(plain).not.toContain('---');
    expect(plain).toContain('corte de compras');
    expect(plain).toContain('Resumen');
  });

  it('deja el texto del enlace y descarta la URL', () => {
    expect(toPlainPreview('Mire el [Portal GSS](https://ejemplo.com) por favor')).toBe(
      'Mire el Portal GSS por favor'
    );
  });

  it('quita viñetas, citas y comillas de código', () => {
    expect(toPlainPreview('- uno `dos` > tres')).toBe('uno dos > tres');
  });

  it('no revienta con una cadena vacía', () => {
    expect(toPlainPreview('')).toBe('');
  });
});

describe('normalizeAgentKey / findAgentByRouteKey', () => {
  const agents = [
    agent({ idAgent: 1, code: 'horus', displayName: 'Orus', handle: '@horus_gss_bot' }),
    agent({ idAgent: 2, code: 'analu', displayName: 'Ana Lucía', handle: '@Analu_gss_bot' }),
  ];

  it('normaliza tildes, mayúsculas, arroba y sufijo del bot', () => {
    expect(normalizeAgentKey('Ana Lucía')).toBe('analucia');
    expect(normalizeAgentKey('@horus_gss_bot')).toBe('horus');
  });

  it('encuentra por code', () => {
    expect(findAgentByRouteKey(agents, 'horus')?.idAgent).toBe(1);
  });

  it('encuentra por nombre visible — así llega /process/chat/orus', () => {
    expect(findAgentByRouteKey(agents, 'orus')?.idAgent).toBe(1);
    expect(findAgentByRouteKey(agents, 'ana-lucia')?.idAgent).toBe(2);
  });

  it('encuentra por handle', () => {
    expect(findAgentByRouteKey(agents, '@horus_gss_bot')?.idAgent).toBe(1);
  });

  it('devuelve null para lo desconocido o vacío', () => {
    expect(findAgentByRouteKey(agents, 'no-existe')).toBeNull();
    expect(findAgentByRouteKey(agents, '')).toBeNull();
    expect(findAgentByRouteKey(agents, null)).toBeNull();
  });
});
