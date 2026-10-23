/**
 * Catalogo CERRADO de acciones SAP que pueden ejecutar las tareas de un flujo
 * (tareas «Ejecutora SAP» y efectos SAP de tareas humanas). PURO: sin servidor.
 *
 * Decision aprobada (2026-10-22): no hay endpoints libres del Service Layer; cada
 * accion trae sus validaciones, su control de concurrencia (If-Match) y su
 * idempotencia en lib/purchases/*. El mapeo se ve siempre y solo se editan los
 * campos marcados como editables; los de compatibilidad con SAPSEND (U_SEND_*,
 * DocObjectCode) estan bloqueados.
 */

export type TaskKind = 'normal' | 'authorization' | 'sap_executor';

export type TriggerEvent = 'on_execute' | 'on_start' | 'on_approve' | 'on_final_approve' | 'on_reject' | 'on_quote';

export const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  on_execute: 'Al ejecutar (tarea automática)',
  on_start: 'Al iniciar la tarea',
  on_approve: 'Al aprobar (cualquier nivel)',
  on_final_approve: 'Al aprobar el último nivel',
  on_reject: 'Al rechazar',
  on_quote: 'Al enviar a cotizar',
};

export interface MappingField {
  /** Dato de SynerLink. */
  source: string;
  /** Campo del Service Layer. */
  target: string;
  /** false = compatibilidad con SAPSEND: se ve, no se edita. */
  editable: boolean;
}

export interface SapActionDef {
  key: string;
  label: string;
  /** Lo que se muestra en el diagrama: metodo y entidad del Service Layer. */
  endpoint: string;
  /** Disparadores en los que tiene sentido. */
  triggers: TriggerEvent[];
  /** Tipos de tarea donde se puede usar. */
  taskKinds: TaskKind[];
  /** Estado U_SEND_State que deja (solo para cambios de estado). */
  resultingState?: string | null;
  mapping: MappingField[];
  /**
   * false = definida en el catalogo pero aun sin ejecutor automatico (p. ej. el
   * borrador lo crea el formulario). La pantalla la muestra deshabilitada.
   */
  available?: boolean;
}

const DRAFT_MAPPING: MappingField[] = [
  { source: 'Comentarios de la solicitud', target: 'Comments', editable: true },
  { source: 'Fecha requerida', target: 'RequriedDate', editable: true },
  { source: 'Línea · Artículo', target: 'DocumentLines[].ItemCode', editable: true },
  { source: 'Línea · Descripción', target: 'DocumentLines[].ItemDescription', editable: true },
  { source: 'Línea · Cantidad', target: 'DocumentLines[].Quantity', editable: true },
  { source: 'Línea · Precio', target: 'DocumentLines[].UnitPrice', editable: true },
  { source: 'Línea · IVA', target: 'DocumentLines[].TaxCode', editable: true },
  { source: 'Línea · Cuenta de mayor', target: 'DocumentLines[].AccountCode', editable: true },
  { source: 'Línea · Norma de reparto', target: 'DocumentLines[].CostingCode', editable: true },
  { source: 'Solicitante (perfil SAPSEND por empresa)', target: 'U_SEND_UserId', editable: false },
  { source: 'Departamento SAPSEND por empresa', target: 'U_SEND_Dep', editable: false },
  { source: 'Estado del flujo', target: 'U_SEND_State', editable: false },
  { source: 'Tipo de documento', target: 'DocObjectCode = oPurchaseRequest', editable: false },
];

const STATE_MAPPING: MappingField[] = [
  { source: 'Estado del flujo', target: 'U_SEND_State', editable: false },
  { source: 'Motivo del autorizador (rechazo)', target: 'U_Motivo_Can_Solicitud', editable: false },
];

export const SAP_ACTIONS: SapActionDef[] = [
  {
    key: 'purchase.create_draft',
    label: 'Crear borrador de solicitud de compra',
    endpoint: 'POST Drafts (oPurchaseRequest)',
    triggers: ['on_execute'],
    taskKinds: ['sap_executor'],
    resultingState: 'B',
    mapping: DRAFT_MAPPING,
    available: false,
  },
  {
    key: 'purchase.state_to_authorize',
    label: 'Pasar a «Por autorizar»',
    endpoint: 'PATCH Drafts(n) · U_SEND_State = LA',
    triggers: ['on_start'],
    taskKinds: ['authorization'],
    resultingState: 'LA',
    mapping: STATE_MAPPING,
  },
  {
    key: 'purchase.state_rejected',
    label: 'Pasar a «No aprobado»',
    endpoint: 'PATCH Drafts(n) · U_SEND_State = NAD',
    triggers: ['on_reject'],
    taskKinds: ['authorization'],
    resultingState: 'NAD',
    mapping: STATE_MAPPING,
  },
  {
    key: 'purchase.state_quotation',
    label: 'Pasar a «En cotización» y avisar a Compras',
    endpoint: 'PATCH Drafts(n) · U_SEND_State = ENC',
    triggers: ['on_quote'],
    taskKinds: ['authorization'],
    resultingState: 'ENC',
    mapping: STATE_MAPPING,
  },
  {
    key: 'purchase.publish_firm',
    label: 'Publicar solicitud en firme',
    endpoint: 'POST PurchaseRequests',
    triggers: ['on_final_approve', 'on_execute'],
    taskKinds: ['authorization', 'sap_executor'],
    resultingState: 'A',
    mapping: [
      { source: 'Copia del borrador aprobado', target: 'PurchaseRequests (cabecera y líneas)', editable: false },
      { source: 'Marca de idempotencia', target: 'U_SEND_SolCom = D<DocEntry>', editable: false },
    ],
  },
  {
    key: 'purchase.attach',
    label: 'Adjuntar cotizaciones y anexos',
    endpoint: 'POST/PATCH Attachments2',
    triggers: ['on_execute'],
    taskKinds: ['sap_executor'],
    resultingState: null,
    available: false,
    mapping: [{ source: 'Archivos de la solicitud (PDF, JPG, PNG)', target: 'Attachments2_Lines', editable: false }],
  },
];

/** Acciones que se pueden configurar hoy en un tipo de tarea y disparador. */
export function actionsFor(taskKind: TaskKind, trigger: TriggerEvent): SapActionDef[] {
  return SAP_ACTIONS.filter((a) => a.available !== false && a.taskKinds.includes(taskKind) && a.triggers.includes(trigger));
}

/** Disparadores que aplican a un tipo de tarea. */
export function triggersFor(taskKind: TaskKind): TriggerEvent[] {
  if (taskKind === 'sap_executor') return ['on_execute'];
  if (taskKind === 'authorization') return ['on_start', 'on_final_approve', 'on_reject', 'on_quote'];
  return [];
}

/**
 * Efectos SAP con los que trabajaba el flujo de compras antes de ser configurable.
 * Se usan si el proceso aun no tiene nada configurado (compatibilidad).
 */
export const DEFAULT_AUTHORIZATION_EFFECTS: { trigger: TriggerEvent; actionKey: string }[] = [
  { trigger: 'on_start', actionKey: 'purchase.state_to_authorize' },
  { trigger: 'on_final_approve', actionKey: 'purchase.publish_firm' },
  { trigger: 'on_reject', actionKey: 'purchase.state_rejected' },
  { trigger: 'on_quote', actionKey: 'purchase.state_quotation' },
];

export function getSapAction(key: string): SapActionDef | undefined {
  return SAP_ACTIONS.find((a) => a.key === key);
}

/**
 * Valida la configuracion de una accion en una tarea: accion del catalogo,
 * disparador permitido para ese tipo de tarea, y que el mapeo personalizado no
 * toque campos bloqueados ni invente campos. Devuelve errores (vacio = valida).
 */
export function validateTaskAction(params: {
  taskKind: TaskKind;
  actionKey: string;
  trigger: TriggerEvent;
  mapping?: Record<string, string> | null;
}): string[] {
  const def = getSapAction(params.actionKey);
  if (!def) return [`La acción «${params.actionKey}» no existe en el catálogo.`];
  const errors: string[] = [];
  if (def.available === false) errors.push(`«${def.label}» todavía no se puede ejecutar automáticamente.`);
  if (!def.taskKinds.includes(params.taskKind)) {
    errors.push(`«${def.label}» no se puede usar en una tarea de tipo ${params.taskKind}.`);
  }
  if (!def.triggers.includes(params.trigger)) {
    errors.push(`«${def.label}» no admite el disparador «${TRIGGER_LABELS[params.trigger] ?? params.trigger}».`);
  }
  for (const target of Object.keys(params.mapping ?? {})) {
    const field = def.mapping.find((m) => m.target === target);
    if (!field) errors.push(`El campo «${target}» no es parte del mapeo de «${def.label}».`);
    else if (!field.editable) errors.push(`El campo «${target}» es de compatibilidad con SAPSEND y no se puede editar.`);
  }
  return errors;
}
