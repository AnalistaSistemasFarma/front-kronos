/**
 * Catálogo de pantallas SynerLink para el asistente.
 * Al cambiar de ruta, el chat recibe etiqueta + resumen + sugerencias de ESA pantalla.
 */

export type ScreenDef = {
  pageLabel: string;
  pageKind: string;
  /** Qué es esta pantalla (markdown). Se enriquece con datos vivos si hay bridge. */
  summary: string;
  /** Chips sugeridos en el chat. */
  suggestions: string[];
  withId?: string;
};

type Rule = {
  test: RegExp;
  def: ScreenDef;
};

const RULES: Rule[] = [
  {
    test: /\/request-general\/view-request/,
    def: {
      pageLabel: 'Ver solicitud',
      pageKind: 'view-request',
      withId: 'Solicitud abierta',
      summary:
        'Detalle de una **solicitud general**: estado, descripción, actividades y resolución.',
      suggestions: [
        '¿Qué hay en esta solicitud?',
        'Ponla en resuelto',
        '¿Cómo se resuelve una solicitud?',
      ],
    },
  },
  {
    test: /\/request-general\/create-request/,
    def: {
      pageLabel: 'Crear solicitud',
      pageKind: 'create-request',
      summary:
        'Formulario para **crear una solicitud general** (empresa, proceso, asunto, descripción).',
      suggestions: [
        'Ayúdame a llenar esta solicitud',
        '¿Qué proceso debo elegir?',
        'Créame una solicitud de pago',
      ],
    },
  },
  {
    test: /\/request-general\/assigned-requests/,
    def: {
      pageLabel: 'Solicitudes asignadas',
      pageKind: 'assigned-requests',
      summary:
        'Bandeja de **solicitudes a tu cargo** (las que debes gestionar), no las que tú creaste.',
      suggestions: [
        '¿Cuántas tengo asignadas?',
        'Lista las abiertas',
        'Pon la #id en resuelto',
      ],
    },
  },
  {
    test: /\/request-general\/general-requests/,
    def: {
      pageLabel: 'Solicitudes generales',
      pageKind: 'general-requests',
      summary: 'Listado / panel de **solicitudes generales** del módulo Request General.',
      suggestions: [
        '¿Cómo creo una solicitud?',
        '¿Cuántas solicitudes tengo?',
        'Ir a crear solicitud',
      ],
    },
  },
  {
    test: /\/request-general\/dashboard-solicitado/,
    def: {
      pageLabel: 'Dashboard personal',
      pageKind: 'dashboard-solicitado',
      summary:
        '**Dashboard personal**: analítica de lo que te toca gestionar (solicitudes/actividades a tu cargo).',
      suggestions: [
        '¿Qué hay en este dashboard?',
        'Resumen de mis asignadas',
        '¿Cuántas están pendientes?',
      ],
    },
  },
  {
    test: /\/request-general\/dashboard-solicitante/,
    def: {
      pageLabel: 'Dashboard solicitudes',
      pageKind: 'dashboard-solicitante',
      summary:
        '**Dashboard solicitudes**: resumen de lo que **tú pediste** (procesos solicitante) y actividades asociadas.',
      suggestions: [
        '¿Qué hay en este dashboard?',
        '¿Cuántas solicitudes creé?',
        '¿Cuáles están abiertas?',
      ],
    },
  },
  {
    test: /\/request-general\/workflows/,
    def: {
      pageLabel: 'Workflows',
      pageKind: 'workflows',
      summary: 'Administración / listado de **flujos de trabajo** por categoría-proceso.',
      suggestions: ['¿Cómo funciona un workflow?', '¿Qué hay en esta página?'],
    },
  },
  {
    test: /\/request-general\/view-workflows/,
    def: {
      pageLabel: 'Ver workflow',
      pageKind: 'view-workflow',
      withId: 'Workflow',
      summary: 'Detalle / editor de un **workflow** concreto.',
      suggestions: ['¿Qué hay en este workflow?', 'Explícame este flujo'],
    },
  },
  {
    test: /\/request-general\/view-activities/,
    def: {
      pageLabel: 'Actividades de solicitud',
      pageKind: 'view-activities',
      summary: 'Tareas / **actividades** ligadas a una solicitud.',
      suggestions: ['¿Qué actividades hay?', '¿Cómo se completa una actividad?'],
    },
  },
  {
    test: /\/request-general\/assigned-activities/,
    def: {
      pageLabel: 'Actividades asignadas',
      pageKind: 'assigned-activities',
      summary: 'Tareas **asignadas a ti** dentro de solicitudes.',
      suggestions: ['¿Qué actividades tengo?', '¿Cuántas están pendientes?'],
    },
  },
  {
    test: /\/help-desk\/create-ticket/,
    def: {
      pageLabel: 'Crear ticket / caso',
      pageKind: 'create-ticket',
      summary:
        'Formulario **Help Desk** para abrir un caso/ticket (empresa, categoría, técnico, asunto).',
      suggestions: [
        'Ayúdame a crear este caso',
        'Créame un ticket de chatbot',
        '¿Cómo se crea un ticket?',
      ],
    },
  },
  {
    test: /\/help-desk\/view-ticket/,
    def: {
      pageLabel: 'Ver caso / ticket',
      pageKind: 'view-ticket',
      withId: 'Caso',
      summary: 'Detalle de un **caso Help Desk**.',
      suggestions: ['¿Qué hay en este caso?', '¿Cómo se resuelve un ticket?'],
    },
  },
  {
    test: /\/help-desk\/my-tickets/,
    def: {
      pageLabel: 'Mis tickets',
      pageKind: 'my-tickets',
      summary: 'Listado de **tus casos / tickets** de Help Desk.',
      suggestions: ['¿Cuántos tickets tengo?', 'Lista los abiertos', 'Créame un caso'],
    },
  },
  {
    test: /\/help-desk\/assigned-tickets/,
    def: {
      pageLabel: 'Tickets asignados',
      pageKind: 'assigned-tickets',
      summary: 'Casos Help Desk **asignados a ti** como técnico/gestor.',
      suggestions: ['¿Cuántos me asignaron?', 'Lista los abiertos'],
    },
  },
  {
    test: /\/authorization/,
    def: {
      pageLabel: 'Autorizaciones',
      pageKind: 'authorization',
      summary: 'Cola de **autorizaciones** pendientes / gestionables.',
      suggestions: ['¿Qué hay en autorizaciones?', '¿Cómo autorizo?'],
    },
  },
  {
    test: /^\/dashboard\/actividades/,
    def: {
      pageLabel: 'Dashboard Admin · Actividades',
      pageKind: 'dashboard-admin',
      summary:
        '**Dashboard Admin → Actividades**: KPIs del equipo (completadas, pendientes, en curso) y desempeño por encargado.',
      suggestions: [
        '¿Qué ves en esta página?',
        'Resumen de actividades',
        '¿Quién tiene más pendientes?',
      ],
    },
  },
  {
    test: /^\/dashboard\/tickets/,
    def: {
      pageLabel: 'Dashboard Admin · Tickets',
      pageKind: 'dashboard-admin',
      summary: '**Dashboard Admin → Tickets**: analítica de mesa de ayuda del equipo.',
      suggestions: ['¿Qué ves en esta página?', 'Resumen de tickets del periodo'],
    },
  },
  {
    test: /^\/dashboard\/solicitudes/,
    def: {
      pageLabel: 'Dashboard Admin · Solicitudes',
      pageKind: 'dashboard-admin',
      summary: '**Dashboard Admin → Solicitudes**: analítica global de pedidos del equipo.',
      suggestions: ['¿Qué ves en esta página?', 'Resumen de solicitudes del periodo'],
    },
  },
  {
    test: /^\/dashboard/,
    def: {
      pageLabel: 'Dashboard Admin',
      pageKind: 'dashboard-admin',
      summary:
        '**Dashboard Admin**: analítica del equipo (Solicitudes / Actividades / Tickets). No es tu bandeja personal.',
      suggestions: [
        '¿Qué ves en esta página?',
        'Explica los KPIs',
        'Cambia a actividades',
      ],
    },
  },
  {
    test: /^\/process\/?$/,
    def: {
      pageLabel: 'Procesos',
      pageKind: 'process-hub',
      summary:
        '**Hub de Procesos**: catálogo de procesos y subprocesos asignados a tu usuario. Desde aquí entras a Help Desk, solicitudes, dashboards, etc.',
      suggestions: [
        '¿Qué procesos tengo?',
        '¿Cómo creo un ticket?',
        'Llévame a mis solicitudes',
      ],
    },
  },
];

const FALLBACK: ScreenDef = {
  pageLabel: 'SynerLink',
  pageKind: 'unknown',
  summary: 'Estás en SynerLink. Puedo ayudarte con tickets, solicitudes o explicarte la pantalla.',
  suggestions: [
    '¿Qué hay en esta página?',
    '¿Cómo se crea un ticket?',
    '¿Cuántas solicitudes tengo?',
  ],
};

export function resolveScreenDef(
  pathname: string,
  search = '',
): ScreenDef & { requestId?: string; baseExtra: string } {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const id = q.get('id') || undefined;

  for (const rule of RULES) {
    if (rule.test.test(pathname)) {
      const bits = [
        '### En esta página',
        `Estás en **${rule.def.pageLabel}**.`,
        rule.def.summary,
      ];
      if (id && rule.def.withId) {
        bits.push(`${rule.def.withId} **#${id}**.`);
      }
      bits.push('', `Ruta: \`${pathname}${search ? (search.startsWith('?') ? search : `?${search}`) : ''}\``);
      return {
        ...rule.def,
        requestId: id,
        baseExtra: bits.join('\n'),
      };
    }
  }

  const bits = [
    '### En esta página',
    `Estás en **${pathname}**.`,
    FALLBACK.summary,
  ];
  return {
    ...FALLBACK,
    pageLabel: pathname || FALLBACK.pageLabel,
    baseExtra: bits.join('\n'),
  };
}

export function suggestionsForPath(pathname: string, search = ''): string[] {
  return resolveScreenDef(pathname, search).suggestions;
}
