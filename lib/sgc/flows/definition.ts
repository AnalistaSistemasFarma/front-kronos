import { SgcError } from '../errors';

/**
 * Definición de un flujo validado del SGC (motor genérico, Sprint 2).
 *
 * COPIA CONGELADA del modelo del administrador de workflows de SynerLink
 * (procesos → tareas con orden y responsable → formularios → transiciones),
 * reescrita para el sistema validado: se guarda en tablas propias
 * (sgc.flow_*), se versiona y cada cambio queda en sgc.config_change_log.
 * Funciones PURAS (probadas con Vitest): validan y normalizan lo que llega
 * del administrador antes de tocar la base.
 */

export const SGC_FLOW_ROLES = ['solicitante', 'elaborador', 'revisor', 'aprobador', 'calidad', 'alcance', 'capacitacion'] as const;
export type SgcFlowRole = (typeof SGC_FLOW_ROLES)[number];

/** Cómo se asigna la tarea al crearse. */
export const SGC_FLOW_ASSIGNMENTS = ['solicitante', 'elaborador', 'firmantes', 'calidad'] as const;
export type SgcFlowAssignment = (typeof SGC_FLOW_ASSIGNMENTS)[number];

export const SGC_SIGNING_MODES = ['orden', 'paralelo'] as const;
export type SgcSigningMode = (typeof SGC_SIGNING_MODES)[number];

export const SGC_SIGNATURE_MEANINGS = ['elaboro', 'reviso', 'aprobo', 'leyo', 'capacito'] as const;
export type SgcSignatureMeaning = (typeof SGC_SIGNATURE_MEANINGS)[number];

export const SGC_FLOW_ACTIONS = ['aprobar', 'devolver', 'cancelar'] as const;
export type SgcFlowAction = (typeof SGC_FLOW_ACTIONS)[number];

export const SGC_TERMINAL_STATUSES = ['completada', 'cancelada'] as const;
export type SgcTerminalStatus = (typeof SGC_TERMINAL_STATUSES)[number];

export const SGC_FIELD_TYPES = ['texto', 'texto_largo', 'numero', 'fecha', 'seleccion', 'si_no'] as const;
export type SgcFieldType = (typeof SGC_FIELD_TYPES)[number];

/**
 * Condiciones que el motor sabe evaluar (catálogo cerrado: el administrador
 * elige de aquí; nada de expresiones libres en un sistema validado).
 */
export const SGC_CONDITION_KEYS = ['tipo_exige_capacitacion', 'solicitud_es_nueva', 'solicitud_sobre_documento'] as const;
export type SgcConditionKey = (typeof SGC_CONDITION_KEYS)[number];

export const SGC_FLOW_CATEGORIES = ['documental', 'control_cambios', 'desviaciones', 'capa', 'capacitacion', 'auditorias', 'otro'] as const;

export const SGC_ROLE_LABELS: Record<SgcFlowRole, string> = {
  solicitante: 'Solicitante',
  elaborador: 'Elaborador',
  revisor: 'Revisor',
  aprobador: 'Aprobador',
  calidad: 'Aseguramiento de Calidad',
  alcance: 'Personas del alcance',
  capacitacion: 'Capacitación',
};

export const SGC_ASSIGNMENT_LABELS: Record<SgcFlowAssignment, string> = {
  solicitante: 'Quien crea la solicitud',
  elaborador: 'El elaborador del documento',
  firmantes: 'Firmantes que asigna el elaborador',
  calidad: 'Grupo de Aseguramiento de Calidad',
};

export const SGC_SIGNATURE_LABELS: Record<SgcSignatureMeaning, string> = {
  elaboro: 'Elaboró',
  reviso: 'Revisó',
  aprobo: 'Aprobó',
  leyo: 'Leyó',
  capacito: 'Capacitó',
};

export const SGC_ACTION_LABELS: Record<SgcFlowAction, string> = {
  aprobar: 'Aprobar / enviar',
  devolver: 'Devolver',
  cancelar: 'Cancelar solicitud',
};

export const SGC_FIELD_TYPE_LABELS: Record<SgcFieldType, string> = {
  texto: 'Texto corto',
  texto_largo: 'Texto largo',
  numero: 'Número',
  fecha: 'Fecha',
  seleccion: 'Lista de opciones',
  si_no: 'Sí / No',
};

export const SGC_CONDITION_LABELS: Record<SgcConditionKey, string> = {
  tipo_exige_capacitacion: 'Solo si el tipo documental exige capacitación',
  solicitud_es_nueva: 'Solo si es un documento nuevo',
  solicitud_sobre_documento: 'Solo si es sobre un documento existente',
};

export interface SgcTaskDefinition {
  key: string;
  name: string;
  stepOrder: number;
  role: SgcFlowRole;
  assignment: SgcFlowAssignment;
  multiAssignee: boolean;
  signingModeDefault: SgcSigningMode | null;
  signatureMeaning: SgcSignatureMeaning | null;
  targetDays: number | null;
  conditionKey: SgcConditionKey | null;
  isAuthorization: boolean;
  authorizationTypeCode: string | null;
  poolAuthorizationTypeCode: string | null;
  isEnabled: boolean;
  description: string | null;
}

export interface SgcTransitionDefinition {
  from: string;
  action: SgcFlowAction;
  to: string | null;
  terminalStatus: SgcTerminalStatus | null;
}

export interface SgcFormFieldDefinition {
  taskKey: string | null;
  key: string;
  label: string;
  type: SgcFieldType;
  required: boolean;
  options: string[];
  helpText: string | null;
  sortOrder: number;
  /**
   * Sprint 3: punto de la LISTA DE CHEQUEO de estructura documental de
   * Calidad (guía de codificación, formato, anexos…). Lo responde el cupo del
   * grupo de verificación de la tarea al firmar: Cumple / No cumple / No
   * aplica (si es obligatorio, «No aplica» no vale).
   */
  qualityCheck?: boolean;
}

export interface SgcFlowDefinition {
  tasks: SgcTaskDefinition[];
  transitions: SgcTransitionDefinition[];
  formFields: SgcFormFieldDefinition[];
}

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const TYPE_CODE_RE = /^[A-Z][A-Z0-9_-]{1,39}$/;

function oneOf<T extends string>(value: unknown, list: readonly T[], label: string, nullable = false): T | null {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  throw new SgcError(`${label}: valor no permitido (${String(value)}).`);
}

function text(value: unknown, label: string, max: number, nullable = false): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (nullable) return null;
    throw new SgcError(`${label} es obligatorio.`);
  }
  if (s.length > max) throw new SgcError(`${label} admite máximo ${max} caracteres.`);
  return s;
}

function key(value: unknown, label: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!KEY_RE.test(s)) throw new SgcError(`${label}: use minúsculas, números y guion bajo (2 a 40, empezando por letra).`);
  return s;
}

function typeCode(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim().toUpperCase();
  if (!TYPE_CODE_RE.test(s)) throw new SgcError(`${label}: código de tipo de autorización inválido.`);
  return s;
}

function int(value: unknown, label: string, min: number, max: number, nullable = false): number | null {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new SgcError(`${label} debe ser un entero entre ${min} y ${max}.`);
  return n;
}

/**
 * Normaliza y VALIDA una definición completa (lo que guarda el administrador).
 * Reglas:
 *  - claves únicas; órdenes únicos; al menos una tarea;
 *  - la primera tarea (menor orden) la asigna "solicitante" o "elaborador";
 *  - multi_assignee solo con asignación "firmantes" (y exige modo por defecto);
 *  - toda tarea no final tiene transición "aprobar"; las transiciones apuntan a
 *    tareas existentes; "devolver" solo hacia una tarea ANTERIOR (nunca a sí
 *    misma ni hacia adelante); a lo sumo una transición por (tarea, acción);
 *  - hay al menos un cierre "completada" alcanzable por "aprobar";
 *  - tarea de autorización ⇒ código de tipo; grupo de Calidad ⇒ código de tipo;
 *  - campos: clave única por tarea, "seleccion" con al menos 2 opciones.
 */
export function normalizeFlowDefinition(input: unknown): SgcFlowDefinition {
  if (!input || typeof input !== 'object') throw new SgcError('La definición del flujo es inválida.');
  const raw = input as { tasks?: unknown; transitions?: unknown; formFields?: unknown };
  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) throw new SgcError('El flujo debe tener al menos una tarea.');
  if (raw.tasks.length > 30) throw new SgcError('El flujo admite máximo 30 tareas.');

  const tasks: SgcTaskDefinition[] = raw.tasks.map((t: Record<string, unknown>, i: number) => {
    const label = `Tarea ${i + 1}`;
    const assignment = oneOf(t?.assignment, SGC_FLOW_ASSIGNMENTS, `${label} · asignación`)!;
    const multi = Boolean(t?.multiAssignee);
    const isAuthorization = Boolean(t?.isAuthorization);
    const def: SgcTaskDefinition = {
      key: key(t?.key, `${label} · clave`),
      name: text(t?.name, `${label} · nombre`, 150)!,
      stepOrder: int(t?.stepOrder, `${label} · orden`, 0, 99)!,
      role: oneOf(t?.role, SGC_FLOW_ROLES, `${label} · rol`)!,
      assignment,
      multiAssignee: multi,
      signingModeDefault: oneOf(t?.signingModeDefault, SGC_SIGNING_MODES, `${label} · modo de firma`, true),
      signatureMeaning: oneOf(t?.signatureMeaning, SGC_SIGNATURE_MEANINGS, `${label} · significado de la firma`, true),
      targetDays: int(t?.targetDays, `${label} · días objetivo`, 1, 365, true),
      conditionKey: oneOf(t?.conditionKey, SGC_CONDITION_KEYS, `${label} · condición`, true),
      isAuthorization,
      authorizationTypeCode: typeCode(t?.authorizationTypeCode, `${label} · tipo de autorización`),
      poolAuthorizationTypeCode: typeCode(t?.poolAuthorizationTypeCode, `${label} · grupo de verificación`),
      isEnabled: t?.isEnabled === undefined ? true : Boolean(t.isEnabled),
      description: text(t?.description, `${label} · descripción`, 1000, true),
    };
    if (def.multiAssignee && def.assignment !== 'firmantes') {
      throw new SgcError(`${label}: varios responsables solo aplica cuando los asigna el elaborador ("firmantes").`);
    }
    if (def.assignment === 'firmantes' && !def.multiAssignee) {
      throw new SgcError(`${label}: una tarea de firmantes admite varios responsables (márquela como tal).`);
    }
    if (def.multiAssignee && !def.signingModeDefault) {
      throw new SgcError(`${label}: indique el modo de firma por defecto (en orden o en paralelo).`);
    }
    if (def.isAuthorization && !def.authorizationTypeCode) {
      throw new SgcError(`${label}: una tarea de autorización necesita su tipo de autorización.`);
    }
    if (!def.isAuthorization) def.authorizationTypeCode = null;
    if (def.assignment === 'calidad' && !def.poolAuthorizationTypeCode) {
      throw new SgcError(`${label}: la asignación al grupo de Calidad necesita el tipo de autorización del grupo.`);
    }
    return def;
  });

  const keys = new Set<string>();
  const orders = new Set<number>();
  for (const t of tasks) {
    if (keys.has(t.key)) throw new SgcError(`Clave de tarea repetida: ${t.key}.`);
    if (orders.has(t.stepOrder)) throw new SgcError(`Orden de tarea repetido: ${t.stepOrder}.`);
    keys.add(t.key);
    orders.add(t.stepOrder);
  }
  tasks.sort((a, b) => a.stepOrder - b.stepOrder);
  const first = tasks[0];
  if (first.assignment !== 'solicitante' && first.assignment !== 'elaborador') {
    throw new SgcError('La primera tarea del flujo la ejecuta el solicitante o el elaborador.');
  }
  if (first.conditionKey) throw new SgcError('La primera tarea del flujo no puede tener condición.');

  const rawTransitions = Array.isArray(raw.transitions) ? raw.transitions : [];
  const orderOf = new Map(tasks.map((t) => [t.key, t.stepOrder]));
  const seen = new Set<string>();
  const transitions: SgcTransitionDefinition[] = rawTransitions.map((tr: Record<string, unknown>, i: number) => {
    const label = `Transición ${i + 1}`;
    const from = key(tr?.from, `${label} · origen`);
    if (!keys.has(from)) throw new SgcError(`${label}: la tarea de origen "${from}" no existe.`);
    const action = oneOf(tr?.action, SGC_FLOW_ACTIONS, `${label} · acción`)!;
    const to = tr?.to ? key(tr.to, `${label} · destino`) : null;
    const terminalStatus = oneOf(tr?.terminalStatus, SGC_TERMINAL_STATUSES, `${label} · cierre`, true);
    if (!to && !terminalStatus) throw new SgcError(`${label}: indique la tarea destino o el cierre.`);
    if (to && terminalStatus) throw new SgcError(`${label}: una transición va a una tarea O cierra la solicitud, no ambas.`);
    if (to && !keys.has(to)) throw new SgcError(`${label}: la tarea destino "${to}" no existe.`);
    if (to && to === from) throw new SgcError(`${label}: una tarea no puede transitar a sí misma.`);
    if (action === 'devolver') {
      if (!to) throw new SgcError(`${label}: "devolver" debe indicar a qué tarea anterior regresa.`);
      if (orderOf.get(to)! >= orderOf.get(from)!) throw new SgcError(`${label}: solo se puede devolver a una tarea anterior.`);
    }
    if (action === 'aprobar' && to && orderOf.get(to)! <= orderOf.get(from)!) {
      throw new SgcError(`${label}: "aprobar" avanza a una tarea posterior.`);
    }
    if (action === 'aprobar' && terminalStatus === 'cancelada') throw new SgcError(`${label}: "aprobar" no puede cancelar la solicitud.`);
    if (action === 'cancelar' && (to || terminalStatus !== 'cancelada')) throw new SgcError(`${label}: "cancelar" cierra la solicitud como cancelada.`);
    const id = `${from}:${action}`;
    if (seen.has(id)) throw new SgcError(`${label}: ya existe una transición "${action}" desde "${from}".`);
    seen.add(id);
    return { from, action, to, terminalStatus };
  });

  for (const t of tasks) {
    if (!seen.has(`${t.key}:aprobar`)) throw new SgcError(`La tarea "${t.name}" no tiene transición "aprobar".`);
  }
  // Recorrido por "aprobar" desde la primera tarea: debe llegar a un cierre completado.
  const approveOf = new Map(transitions.filter((t) => t.action === 'aprobar').map((t) => [t.from, t]));
  let cursor: string | null = first.key;
  const visited = new Set<string>();
  let completes = false;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const tr = approveOf.get(cursor);
    if (!tr) break;
    if (tr.terminalStatus === 'completada') {
      completes = true;
      break;
    }
    cursor = tr.to;
  }
  if (!completes) throw new SgcError('El flujo no llega a un cierre "completada" aprobando sus tareas en orden.');

  const rawFields = Array.isArray(raw.formFields) ? raw.formFields : [];
  if (rawFields.length > 60) throw new SgcError('El flujo admite máximo 60 campos.');
  const fieldIds = new Set<string>();
  const formFields: SgcFormFieldDefinition[] = rawFields.map((f: Record<string, unknown>, i: number) => {
    const label = `Campo ${i + 1}`;
    const taskKey = f?.taskKey ? key(f.taskKey, `${label} · tarea`) : null;
    if (taskKey && !keys.has(taskKey)) throw new SgcError(`${label}: la tarea "${taskKey}" no existe.`);
    const type = oneOf(f?.type, SGC_FIELD_TYPES, `${label} · tipo`)!;
    const options = Array.isArray(f?.options)
      ? [...new Set((f.options as unknown[]).map((o) => String(o ?? '').trim()).filter(Boolean))]
      : [];
    if (type === 'seleccion' && options.length < 2) throw new SgcError(`${label}: una lista necesita al menos 2 opciones.`);
    if (options.some((o) => o.length > 150)) throw new SgcError(`${label}: cada opción admite máximo 150 caracteres.`);
    const def: SgcFormFieldDefinition = {
      taskKey,
      key: key(f?.key, `${label} · clave`),
      label: text(f?.label, `${label} · etiqueta`, 150)!,
      type,
      required: Boolean(f?.required),
      options: type === 'seleccion' ? options : [],
      helpText: text(f?.helpText, `${label} · ayuda`, 500, true),
      sortOrder: int(f?.sortOrder ?? i, `${label} · orden`, 0, 999)!,
      qualityCheck: Boolean(f?.qualityCheck),
    };
    if (def.qualityCheck) {
      const owner = tasks.find((t) => t.key === taskKey);
      if (!owner || !owner.poolAuthorizationTypeCode) {
        throw new SgcError(`${label}: un punto de la lista de chequeo de Calidad va en una tarea con grupo de verificación.`);
      }
      // La respuesta es Cumple / No cumple / No aplica (no depende del tipo).
      def.type = 'si_no';
      def.options = [];
    }
    const id = `${taskKey ?? ''}:${def.key}`;
    if (fieldIds.has(id)) throw new SgcError(`${label}: la clave "${def.key}" ya existe en ese formulario.`);
    fieldIds.add(id);
    return def;
  });
  formFields.sort((a, b) => a.sortOrder - b.sortOrder);

  return { tasks, transitions, formFields };
}

/** Tipos de autorización que la definición necesita (deben existir y estar activos en la empresa). */
export function requiredAuthorizationTypes(def: SgcFlowDefinition): string[] {
  const codes = new Set<string>();
  for (const t of def.tasks) {
    if (t.authorizationTypeCode) codes.add(t.authorizationTypeCode);
    if (t.poolAuthorizationTypeCode) codes.add(t.poolAuthorizationTypeCode);
  }
  return [...codes].sort();
}

/**
 * Resumen legible de lo que cambió entre dos definiciones (para el registro
 * de cambios; el antes/después completo también se guarda en JSON).
 */
export function describeDefinitionChanges(before: SgcFlowDefinition | null, after: SgcFlowDefinition): string[] {
  if (!before) return [`Definición inicial con ${after.tasks.length} tareas, ${after.transitions.length} transiciones y ${after.formFields.length} campos.`];
  const out: string[] = [];
  const bTasks = new Map(before.tasks.map((t) => [t.key, t]));
  const aTasks = new Map(after.tasks.map((t) => [t.key, t]));
  for (const [k, t] of aTasks) {
    const prev = bTasks.get(k);
    if (!prev) out.push(`Tarea agregada: ${t.name} (${k}).`);
    else {
      const changed = (Object.keys(t) as (keyof SgcTaskDefinition)[]).filter((f) => JSON.stringify(t[f]) !== JSON.stringify(prev[f]));
      if (changed.length) out.push(`Tarea ${t.name} (${k}) cambió: ${changed.join(', ')}.`);
    }
  }
  for (const [k, t] of bTasks) if (!aTasks.has(k)) out.push(`Tarea retirada: ${t.name} (${k}).`);
  const trId = (t: SgcTransitionDefinition) => `${t.from}:${t.action}->${t.to ?? t.terminalStatus}`;
  const bTr = new Set(before.transitions.map(trId));
  const aTr = new Set(after.transitions.map(trId));
  for (const t of aTr) if (!bTr.has(t)) out.push(`Transición agregada: ${t}.`);
  for (const t of bTr) if (!aTr.has(t)) out.push(`Transición retirada: ${t}.`);
  const fId = (f: SgcFormFieldDefinition) => `${f.taskKey ?? 'solicitud'}.${f.key}`;
  const bF = new Map(before.formFields.map((f) => [fId(f), f]));
  const aF = new Map(after.formFields.map((f) => [fId(f), f]));
  for (const [k, f] of aF) {
    const prev = bF.get(k);
    if (!prev) out.push(`Campo agregado: ${f.label} (${k}).`);
    else if (JSON.stringify(prev) !== JSON.stringify(f)) out.push(`Campo ${f.label} (${k}) cambió.`);
  }
  for (const [k, f] of bF) if (!aF.has(k)) out.push(`Campo retirado: ${f.label} (${k}).`);
  return out.length ? out : ['Sin cambios en la definición.'];
}
