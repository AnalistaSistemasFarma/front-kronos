/**
 * Máquina de estados del ciclo de vida documental (Fase 2 de Gestión Documental).
 *
 * Los 14 estados son LITERALES, tal como los definió Nicolás a partir del sistema
 * legado (SGD) que se está migrando — no se simplifican ni se renombran. Cada uno
 * se modela como una fila de `task_process_category` (ver
 * lib/document-management/workflowEngine.ts y prisma/seeds/document-management-workflow.sql),
 * dentro de UN solo `process_category` compartido por todos los documentos/empresas
 * ("Gestión Documental — Ciclo de vida del documento").
 *
 * DESVIACIÓN DOCUMENTADA respecto al motor genérico de "solicitudes generales":
 * el motor existente (lib/workflow/advanceSequentialTask.js) avanza SIEMPRE a la
 * "siguiente tarea por display_order" cuando la actual se cierra, y solo admite
 * ramas condicionadas por OPCIONES DE FORMULARIO elegidas al CREAR la solicitud
 * (task_condition_option + request_form_value). No tiene forma de expresar "esta
 * tarea, según cómo se resuelva EN VIVO (aprobar/rechazar), continúa hacia UNA DE
 * VARIAS tareas distintas" ni de retroceder a una tarea anterior en el orden
 * (p.ej. Reelaboración → En elaboración). Ese es exactamente el comportamiento que
 * necesita un flujo de aprobación documental con rechazos y reelaboración.
 *
 * Por eso esta Fase 2 reusa las MISMAS tablas del motor (process_category /
 * task_process_category / requests_general / task_request_general /
 * user_task_request_general) como catálogo de estados + bitácora de instancias,
 * pero la transición de un estado a otro la decide este grafo explícito en
 * código, no la heurística automática de "siguiente por orden" del motor
 * genérico. Ver workflowEngine.ts para el detalle de qué tabla se toca en cada
 * paso.
 */

export const DOCUMENT_WORKFLOW_STATES = [
  'En creación',
  'En elaboración',
  'En revisión',
  'En aprobación',
  'Aprobado',
  'En divulgación',
  'Vigente',
  'Reasignación',
  'Reelaboración',
  'Rechazado',
  'Obsoleto',
  'Anulado',
  'Visto bueno calidad',
  'Eliminado',
] as const;

export type DocumentWorkflowState = (typeof DOCUMENT_WORKFLOW_STATES)[number];

/** Estado inicial de toda versión nueva que arranca el flujo. */
export const INITIAL_STATE: DocumentWorkflowState = 'En creación';

/**
 * Estados que ya no admiten ninguna acción de este grafo (fin de camino para
 * ESA versión). "Vigente" no está aquí: sigue admitiendo `marcar_obsoleto`
 * (side-effect del sistema cuando otra versión se publica) y `anular`.
 */
export const CLOSED_STATES: readonly DocumentWorkflowState[] = [
  'Rechazado',
  'Obsoleto',
  'Anulado',
  'Eliminado',
];

export function isClosedState(state: string): boolean {
  return (CLOSED_STATES as readonly string[]).includes(state);
}

/** Quién puede ejecutar la acción, en términos de lib/document-management/access.ts. */
export type ActorRole = 'owner' | 'write' | 'system';

export interface WorkflowActionDef {
  action: string;
  from: DocumentWorkflowState;
  to: DocumentWorkflowState;
  /** Rol requerido para ejecutar la acción (además de pertenecer a la empresa del documento). */
  actorRole: ActorRole;
  /** Si la tarea que se cierra queda "Resuelta" (2) o "Rechazada/Cancelada" (3) en task_request_general. */
  closesTaskAs: 2 | 3;
  /** Exige un texto de motivo/observación (rechazos, anulaciones). */
  requiresReason?: boolean;
  /** Etiqueta para UI/notificaciones. */
  label: string;
}

/**
 * Grafo de transiciones. Cada fila es una acción posible desde un estado.
 * `marcar_obsoleto` no aparece aquí: no es una acción que el usuario dispare
 * sobre ESTA versión, sino un efecto de sistema aplicado a la versión anterior
 * cuando OTRA versión del mismo documento llega a "Vigente" (ver
 * workflowEngine.publishAsCurrentVersion).
 */
export const WORKFLOW_ACTIONS: WorkflowActionDef[] = [
  {
    action: 'iniciar_elaboracion',
    from: 'En creación',
    to: 'En elaboración',
    actorRole: 'owner',
    closesTaskAs: 2,
    label: 'Iniciar elaboración',
  },
  {
    action: 'enviar_a_revision',
    from: 'En elaboración',
    to: 'En revisión',
    actorRole: 'owner',
    closesTaskAs: 2,
    label: 'Enviar a revisión',
  },
  {
    action: 'aprobar_revision',
    from: 'En revisión',
    to: 'En aprobación',
    actorRole: 'write',
    closesTaskAs: 2,
    label: 'Aprobar revisión',
  },
  {
    action: 'solicitar_ajustes',
    from: 'En revisión',
    to: 'Reelaboración',
    actorRole: 'write',
    closesTaskAs: 3,
    requiresReason: true,
    label: 'Solicitar ajustes (revisión)',
  },
  {
    action: 'rechazar',
    from: 'En revisión',
    to: 'Rechazado',
    actorRole: 'write',
    closesTaskAs: 3,
    requiresReason: true,
    label: 'Rechazar en revisión',
  },
  {
    action: 'aprobar',
    from: 'En aprobación',
    to: 'Visto bueno calidad',
    actorRole: 'write',
    closesTaskAs: 2,
    label: 'Aprobar',
  },
  {
    action: 'solicitar_ajustes',
    from: 'En aprobación',
    to: 'Reelaboración',
    actorRole: 'write',
    closesTaskAs: 3,
    requiresReason: true,
    label: 'Solicitar ajustes (aprobación)',
  },
  {
    action: 'rechazar',
    from: 'En aprobación',
    to: 'Rechazado',
    actorRole: 'write',
    closesTaskAs: 3,
    requiresReason: true,
    label: 'Rechazar en aprobación',
  },
  {
    action: 'aprobar_calidad',
    from: 'Visto bueno calidad',
    to: 'Aprobado',
    actorRole: 'write',
    closesTaskAs: 2,
    label: 'Dar visto bueno de calidad',
  },
  {
    action: 'solicitar_ajustes',
    from: 'Visto bueno calidad',
    to: 'Reelaboración',
    actorRole: 'write',
    closesTaskAs: 3,
    requiresReason: true,
    label: 'Solicitar ajustes (calidad)',
  },
  {
    action: 'rechazar',
    from: 'Visto bueno calidad',
    to: 'Rechazado',
    actorRole: 'write',
    closesTaskAs: 3,
    requiresReason: true,
    label: 'Rechazar en visto bueno de calidad',
  },
  {
    action: 'reanudar_elaboracion',
    from: 'Reelaboración',
    to: 'En elaboración',
    actorRole: 'owner',
    closesTaskAs: 2,
    label: 'Reanudar elaboración',
  },
  {
    action: 'iniciar_divulgacion',
    from: 'Aprobado',
    to: 'En divulgación',
    actorRole: 'write',
    closesTaskAs: 2,
    label: 'Iniciar divulgación',
  },
  {
    action: 'publicar_vigente',
    from: 'En divulgación',
    to: 'Vigente',
    actorRole: 'write',
    closesTaskAs: 2,
    label: 'Publicar como vigente',
  },
  // Reasignación: pausa desde cualquier estado abierto de trabajo, para reasignar
  // el responsable, y vuelve a retomarse desde el mismo punto.
  ...(
    [
      'En elaboración',
      'En revisión',
      'En aprobación',
      'Visto bueno calidad',
    ] as DocumentWorkflowState[]
  ).map((from) => ({
    action: 'reasignar',
    from,
    to: 'Reasignación' as DocumentWorkflowState,
    actorRole: 'write' as ActorRole,
    closesTaskAs: 3 as const,
    requiresReason: false,
    label: `Reasignar (desde ${from})`,
  })),
  // Anular: escape global desde cualquier estado no cerrado, incluida "Vigente".
  ...(
    [
      'En creación',
      'En elaboración',
      'En revisión',
      'En aprobación',
      'Visto bueno calidad',
      'Aprobado',
      'En divulgación',
      'Reelaboración',
      'Reasignación',
      'Vigente',
    ] as DocumentWorkflowState[]
  ).map((from) => ({
    action: 'anular',
    from,
    to: 'Anulado' as DocumentWorkflowState,
    actorRole: 'write' as ActorRole,
    closesTaskAs: 3 as const,
    requiresReason: true,
    label: `Anular (desde ${from})`,
  })),
  // Eliminar: solo borradores que aún no entraron a revisión.
  ...(
    ['En creación', 'En elaboración', 'Reasignación'] as DocumentWorkflowState[]
  ).map((from) => ({
    action: 'eliminar',
    from,
    to: 'Eliminado' as DocumentWorkflowState,
    actorRole: 'write' as ActorRole,
    closesTaskAs: 3 as const,
    requiresReason: false,
    label: `Eliminar borrador (desde ${from})`,
  })),
];

/**
 * `reasignar` puede retomarse hacia el estado del que vino. Como
 * "Reasignación" es un único estado (no uno por origen), guardamos el destino
 * de retorno en `task_request_general.resolution` al entrar a Reasignación
 * (ver workflowEngine) y esta tabla solo define la acción de "reanudar" en
 * abstracto: el destino real se calcula en tiempo de ejecución.
 */
export const RESUME_FROM_REASSIGNMENT_ACTION = 'reanudar_asignacion';

/** Todas las acciones válidas partiendo de un estado dado. */
export function getAvailableActions(state: string): WorkflowActionDef[] {
  return WORKFLOW_ACTIONS.filter((a) => a.from === state);
}

/** Busca la definición exacta de una acción desde un estado (undefined si no aplica). */
export function findAction(
  state: string,
  action: string
): WorkflowActionDef | undefined {
  return WORKFLOW_ACTIONS.find((a) => a.from === state && a.action === action);
}

export function isValidTransition(from: string, action: string, to: string): boolean {
  const def = findAction(from, action);
  return !!def && def.to === to;
}

/** Orden sugerido para sembrar `task_process_category.display_order` (0..13). */
export const STATE_DISPLAY_ORDER: Record<DocumentWorkflowState, number> = Object.fromEntries(
  DOCUMENT_WORKFLOW_STATES.map((s, i) => [s, i])
) as Record<DocumentWorkflowState, number>;

export const DOCUMENT_WORKFLOW_PROCESS_NAME = 'Gestión Documental — Ciclo de vida del documento';
