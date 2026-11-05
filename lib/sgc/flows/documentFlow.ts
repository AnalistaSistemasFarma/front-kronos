import type { SgcFlowDefinition, SgcTaskDefinition } from './definition';

/**
 * Flujo DOCUMENTAL v1 — primer flujo configurado en el motor de flujos
 * validados (decisiones de Nicolás del 2026-09-30, plan «Flujo final
 * depurado»). Es la misma definición que siembra
 * prisma/manual/2026-09-30-sgc-s2-flujo-documental-olp.sql (una prueba de
 * integración verifica que coincidan).
 *
 *   0 Solicitud documental (dueño del proceso)
 *   1 Elaboración (firma «Elaboró»)
 *   2 Revisión (varios revisores, en orden o en paralelo; firma «Revisó»)
 *   3 Aprobación (varios aprobadores + verificación de estructura de Calidad
 *     integrada; firma «Aprobó»; también llega a Autorizaciones SGC)
 *   4 Divulgación con lectura firmada   ┐ en la v1 y la v2 quedan definidas
 *   5 Capacitación (obligatoria)        ┘ pero deshabilitadas («en espera»);
 *                                         la v3 (Sprint 4) las habilita
 *   ✓ Vigente (automático, Sprint 4)
 *
 * Devolver, reasignar y cancelar son ACCIONES, no pasos.
 */

export const SGC_DOCUMENT_FLOW_CODE = 'DOC';

export const SGC_AUTH_TYPE_APPROVAL = 'SGC-APROBACION';
export const SGC_AUTH_TYPE_QUALITY = 'SGC-VERIF-CALIDAD';

export const SGC_DOCUMENT_REQUEST_TYPES = ['nuevo', 'nueva_version', 'modificacion'] as const;
export type SgcDocumentRequestType = (typeof SGC_DOCUMENT_REQUEST_TYPES)[number];

export const SGC_DOCUMENT_REQUEST_TYPE_LABELS: Record<SgcDocumentRequestType, string> = {
  nuevo: 'Documento nuevo',
  nueva_version: 'Nueva versión de un documento vigente',
  modificacion: 'Modificación de un documento vigente',
};

/**
 * 2026-10-26 (Nicolás Rivera): REDIVULGACIÓN de un documento vigente. Es otra
 * solicitud, con su propio flujo (REDIV: solicitud → divulgación), sobre la
 * versión VIGENTE: no crea versión, no se firma de nuevo y al cerrarse no
 * publica nada. La siembra el SQL 2026-10-26-sgc-redivulgacion-flujo-olp-*.sql.
 */
export const SGC_REDISSEMINATION_FLOW_CODE = 'REDIV';
export const SGC_REDISSEMINATION_REQUEST_TYPE = 'redivulgacion';

/** Rótulo de cualquier tipo de solicitud (los del flujo documental y la redivulgación). */
export function sgcRequestTypeLabel(type: string): string {
  if (type === SGC_REDISSEMINATION_REQUEST_TYPE) return 'Redivulgación de un documento vigente';
  return SGC_DOCUMENT_REQUEST_TYPE_LABELS[type as SgcDocumentRequestType] ?? type;
}

export function isSgcDocumentRequestType(value: unknown): value is SgcDocumentRequestType {
  return typeof value === 'string' && (SGC_DOCUMENT_REQUEST_TYPES as readonly string[]).includes(value);
}

export const SGC_DOCUMENT_FLOW_V1: SgcFlowDefinition = {
  tasks: [
    {
      key: 'solicitud',
      name: 'Solicitud documental',
      stepOrder: 0,
      role: 'solicitante',
      assignment: 'solicitante',
      multiAssignee: false,
      signingModeDefault: null,
      signatureMeaning: null,
      targetDays: null,
      conditionKey: null,
      isAuthorization: false,
      authorizationTypeCode: null,
      poolAuthorizationTypeCode: null,
      isEnabled: true,
      description: 'El dueño del proceso registra la necesidad (nuevo, nueva versión o modificación) con su justificación.',
    },
    {
      key: 'elaboracion',
      name: 'Elaboración',
      stepOrder: 1,
      role: 'elaborador',
      assignment: 'elaborador',
      multiAssignee: false,
      signingModeDefault: null,
      signatureMeaning: 'elaboro',
      targetDays: 10,
      conditionKey: null,
      isAuthorization: false,
      authorizationTypeCode: null,
      poolAuthorizationTypeCode: null,
      isEnabled: true,
      description: 'El elaborador carga el borrador (Word) y asigna revisores y aprobadores, con su modo de firma.',
    },
    {
      key: 'revision',
      name: 'Revisión',
      stepOrder: 2,
      role: 'revisor',
      assignment: 'firmantes',
      multiAssignee: true,
      signingModeDefault: 'paralelo',
      signatureMeaning: 'reviso',
      targetDays: 5,
      conditionKey: null,
      isAuthorization: false,
      authorizationTypeCode: null,
      poolAuthorizationTypeCode: null,
      isEnabled: true,
      description: 'Los revisores dejan observaciones y aprueban o devuelven a elaboración.',
    },
    {
      key: 'aprobacion',
      name: 'Aprobación',
      stepOrder: 3,
      role: 'aprobador',
      assignment: 'firmantes',
      multiAssignee: true,
      signingModeDefault: 'orden',
      signatureMeaning: 'aprobo',
      targetDays: 5,
      conditionKey: null,
      isAuthorization: true,
      authorizationTypeCode: SGC_AUTH_TYPE_APPROVAL,
      poolAuthorizationTypeCode: SGC_AUTH_TYPE_QUALITY,
      isEnabled: true,
      description: 'Aprueban los responsables del área; dentro de la misma aprobación Aseguramiento de Calidad verifica la estructura documental.',
    },
    {
      key: 'divulgacion',
      name: 'Divulgación',
      stepOrder: 4,
      role: 'alcance',
      assignment: 'calidad',
      multiAssignee: false,
      signingModeDefault: null,
      signatureMeaning: 'leyo',
      targetDays: 10,
      conditionKey: null,
      isAuthorization: false,
      authorizationTypeCode: null,
      poolAuthorizationTypeCode: SGC_AUTH_TYPE_QUALITY,
      isEnabled: false,
      description: 'Lectura obligatoria firmada por las personas del alcance (se habilita en el Sprint 4).',
    },
    {
      key: 'capacitacion',
      name: 'Capacitación',
      stepOrder: 5,
      role: 'capacitacion',
      assignment: 'calidad',
      multiAssignee: false,
      signingModeDefault: null,
      signatureMeaning: 'capacito',
      targetDays: 15,
      conditionKey: 'tipo_exige_capacitacion',
      isAuthorization: false,
      authorizationTypeCode: null,
      poolAuthorizationTypeCode: SGC_AUTH_TYPE_QUALITY,
      isEnabled: false,
      description: 'Video, evaluación y carga de resultados (obligatoria para todos los tipos; se habilita en el Sprint 4).',
    },
  ],
  transitions: [
    { from: 'solicitud', action: 'aprobar', to: 'elaboracion', terminalStatus: null },
    { from: 'solicitud', action: 'cancelar', to: null, terminalStatus: 'cancelada' },
    { from: 'elaboracion', action: 'aprobar', to: 'revision', terminalStatus: null },
    { from: 'elaboracion', action: 'cancelar', to: null, terminalStatus: 'cancelada' },
    { from: 'revision', action: 'aprobar', to: 'aprobacion', terminalStatus: null },
    { from: 'revision', action: 'devolver', to: 'elaboracion', terminalStatus: null },
    { from: 'revision', action: 'cancelar', to: null, terminalStatus: 'cancelada' },
    { from: 'aprobacion', action: 'aprobar', to: 'divulgacion', terminalStatus: null },
    { from: 'aprobacion', action: 'devolver', to: 'elaboracion', terminalStatus: null },
    { from: 'aprobacion', action: 'cancelar', to: null, terminalStatus: 'cancelada' },
    { from: 'divulgacion', action: 'aprobar', to: 'capacitacion', terminalStatus: null },
    { from: 'capacitacion', action: 'aprobar', to: null, terminalStatus: 'completada' },
  ],
  formFields: [
    {
      taskKey: null,
      key: 'referencia_cambio',
      label: 'Referencia de control de cambios',
      type: 'texto',
      required: false,
      options: [],
      helpText: 'Número del control de cambios que origina la solicitud, si existe.',
      sortOrder: 1,
    },
    {
      taskKey: null,
      key: 'urgencia',
      label: 'Prioridad',
      type: 'seleccion',
      required: true,
      options: ['Normal', 'Alta', 'Requerimiento regulatorio'],
      helpText: null,
      sortOrder: 2,
    },
    {
      taskKey: 'elaboracion',
      key: 'resumen_cambios',
      label: 'Resumen de los cambios frente a la versión anterior',
      type: 'texto_largo',
      required: false,
      options: [],
      helpText: 'Para nuevas versiones y modificaciones.',
      sortOrder: 3,
    },
  ],
};

/**
 * Sprint 3 — lista de chequeo de ESTRUCTURA DOCUMENTAL de Calidad dentro de la
 * Aprobación (paso 3): la responde el cupo del grupo SGC-VERIF-CALIDAD al
 * firmar. Es configurable desde el administrador de flujos (campos marcados
 * «Chequeo Calidad»); estos son los puntos iniciales de OLP (supuesto a
 * validar con Calidad).
 */
export const SGC_QUALITY_CHECKLIST_OLP: SgcFlowDefinition['formFields'] = [
  {
    taskKey: 'aprobacion',
    key: 'chk_codificacion',
    label: 'Codificación conforme a la guía de codificación',
    type: 'si_no',
    required: true,
    options: [],
    helpText: 'Código, versión y tipo documental según la guía de la empresa.',
    sortOrder: 10,
    qualityCheck: true,
  },
  {
    taskKey: 'aprobacion',
    key: 'chk_formato',
    label: 'Formato institucional (encabezado, estructura y numeración)',
    type: 'si_no',
    required: true,
    options: [],
    helpText: 'Plantilla vigente, secciones obligatorias y paginación.',
    sortOrder: 11,
    qualityCheck: true,
  },
  {
    taskKey: 'aprobacion',
    key: 'chk_anexos',
    label: 'Anexos y formatos relacionados completos y referenciados',
    type: 'si_no',
    required: false,
    options: [],
    helpText: 'Si el documento no tiene anexos, marque «No aplica».',
    sortOrder: 12,
    qualityCheck: true,
  },
];

/**
 * Flujo DOCUMENTAL v2 (Sprint 3): la v1 más la lista de chequeo de Calidad en
 * la Aprobación. La siembra prisma/manual/2026-09-30-sgc-s3-firma-calidad-olp.sql
 * como versión nueva (la v1 queda retirada; las solicitudes en curso siguen
 * con la v1).
 */
export const SGC_DOCUMENT_FLOW_V2: SgcFlowDefinition = {
  tasks: SGC_DOCUMENT_FLOW_V1.tasks,
  transitions: SGC_DOCUMENT_FLOW_V1.transitions,
  formFields: [...SGC_DOCUMENT_FLOW_V1.formFields, ...SGC_QUALITY_CHECKLIST_OLP],
};

/**
 * Flujo DOCUMENTAL v3 (Sprint 4): la v2 con los pasos 4 y 5 HABILITADOS.
 *
 *   4 Divulgación: cada persona del ALCANCE (departamentos, cargos, personas
 *     o toda la empresa) lee el PDF controlado hasta el final y firma «Leyó».
 *     El grupo de Calidad la administra (alcance, recordatorios, cierre con
 *     justificación). Mientras tanto, la versión anterior SIGUE VIGENTE.
 *   5 Capacitación (obligatoria para todos los tipos): Calidad registra la
 *     sesión o el video y la evaluación de Microsoft Forms, carga el Excel de
 *     resultados (nota mínima configurable) y firma «Capacitó».
 *   ✓ Vigente automático: la versión nueva pasa a vigente y la anterior a
 *     OBSOLETA (con fecha); su PDF se muestra marcado «OBSOLETO».
 *
 * En estos dos pasos solo Calidad puede cancelar la solicitud (la versión
 * aprobada se anula y nunca llega a vigente).
 *
 * La siembra prisma/manual/2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql
 * como versión nueva de DOC (el número en la base puede ser mayor: cada pase
 * y cada reversa probada crean una versión nueva; nunca se edita una vigente).
 */
export const SGC_DOCUMENT_FLOW_V3: SgcFlowDefinition = {
  tasks: SGC_DOCUMENT_FLOW_V2.tasks.map((t) => {
    if (t.key === 'divulgacion') {
      return {
        ...t,
        assignment: 'alcance' as const,
        isEnabled: true,
        description: 'Lectura obligatoria del PDF controlado hasta el final y firma «Leyó» de cada persona del alcance (departamentos, cargos, personas o toda la empresa). La administra Aseguramiento de Calidad.',
      };
    }
    if (t.key === 'capacitacion') {
      return {
        ...t,
        isEnabled: true,
        description: 'Sesión o video y evaluación en Microsoft Forms; Calidad carga el Excel de resultados (nota mínima configurable) y firma «Capacitó». Obligatoria para todos los tipos documentales.',
      };
    }
    return t;
  }),
  transitions: [
    ...SGC_DOCUMENT_FLOW_V2.transitions,
    { from: 'divulgacion', action: 'cancelar', to: null, terminalStatus: 'cancelada' },
    { from: 'capacitacion', action: 'cancelar', to: null, terminalStatus: 'cancelada' },
  ],
  formFields: SGC_DOCUMENT_FLOW_V2.formFields,
};

/**
 * Flujo DOCUMENTAL con CAPACITACIÓN PREVIA (Sprint 10, «DOC v6» del plan;
 * socialización con Calidad OLP del 2026-10-07: el material se configura
 * ANTES de la divulgación y la capacitación es OPCIONAL por solicitud):
 *
 *   3 Aprobación → 4 Preparación de la capacitación (Calidad registra el video
 *   o la sesión y la evaluación en Microsoft Forms o Google Forms; solo si la
 *   solicitud requiere capacitación) → 5 Divulgación (lectura con el video y
 *   el enlace de la evaluación) → 6 Capacitación (resultados, 2 intentos y
 *   recapacitación; solo si la solicitud la requiere) → vigente.
 *
 * La siembra prisma/manual/2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql
 * como versión nueva de DOC (el número en la base puede ser otro); las
 * solicitudes en curso siguen con su versión.
 */
export const SGC_DOCUMENT_FLOW_TRAINING_FIRST: SgcFlowDefinition = {
  tasks: ([
    ...SGC_DOCUMENT_FLOW_V3.tasks.map((t): SgcTaskDefinition => {
      if (t.key === 'divulgacion') return { ...t, stepOrder: 5, description: 'Lectura obligatoria del PDF controlado hasta el final y firma «Leyó» de cada persona del alcance; si la solicitud requiere capacitación, debajo del documento van el video y la evaluación.' };
      if (t.key === 'capacitacion') {
        return { ...t, stepOrder: 6, conditionKey: 'requiere_capacitacion' as const, description: 'Calidad carga los resultados de la evaluación (Microsoft Forms o Google Forms; cuentan 2 intentos), registra la recapacitación de quien no aprobó y firma «Capacitó». Solo si la solicitud requiere capacitación.' };
      }
      return t;
    }),
    {
      key: 'preparacion_capacitacion',
      name: 'Preparación de la capacitación',
      stepOrder: 4,
      role: 'material',
      assignment: 'calidad',
      multiAssignee: false,
      signingModeDefault: null,
      signatureMeaning: null,
      targetDays: 5,
      conditionKey: 'requiere_capacitacion',
      isAuthorization: false,
      authorizationTypeCode: null,
      poolAuthorizationTypeCode: SGC_AUTH_TYPE_QUALITY,
      isEnabled: true,
      description: 'Antes de la divulgación, Calidad registra el material de la capacitación: video o sesión y evaluación en Microsoft Forms o Google Forms. Solo si la solicitud requiere capacitación.',
    },
  ] as SgcTaskDefinition[]).sort((a, b) => a.stepOrder - b.stepOrder),
  transitions: [
    ...SGC_DOCUMENT_FLOW_V3.transitions.filter((t) => !(t.from === 'aprobacion' && t.action === 'aprobar')),
    { from: 'aprobacion', action: 'aprobar', to: 'preparacion_capacitacion', terminalStatus: null },
    { from: 'preparacion_capacitacion', action: 'aprobar', to: 'divulgacion', terminalStatus: null },
    { from: 'preparacion_capacitacion', action: 'cancelar', to: null, terminalStatus: 'cancelada' },
  ],
  formFields: SGC_DOCUMENT_FLOW_V3.formFields,
};

/**
 * Flujo DOCUMENTAL v7 — NUEVO MODELO DE ROLES (S15; RN de la primera prueba en
 * producción con Calidad OLP, 2026-10-13, y decisiones de Nicolás de las 14:44):
 *
 *   0 Solicitud (cualquier área)
 *   1 Autorización de la creación (R15): Aseguramiento de Calidad AUTORIZA o
 *     RECHAZA que el documento se cree (el rechazo cierra la solicitud con su
 *     motivo y, si aplica, el documento vigente que ya cubre el tema). Si el
 *     solicitante es de Calidad, autoriza OTRA persona de Calidad (D15).
 *   2 Elaboración (R16): la hace el mismo solicitante (sin la restricción de
 *     segregación solicitante ≠ elaborador, D15); asigna revisores y
 *     aprobadores de SU departamento (R17), sin confirmación de Calidad.
 *   3 Revisión (R18): alguien del área o de Calidad, nunca el elaborador
 *     (salvo el ajuste por empresa «Calidad revisa lo que elaboró», D14).
 *   4 Aprobación (R19): el líder del departamento según la lista por
 *     departamento, SIN restricción por ahora (D16: la lista existe y se
 *     aplica solo si la empresa enciende «Restringir la aprobación a los
 *     líderes autorizados por departamento»). La verificación de Calidad
 *     sigue siendo la lista de chequeo del cupo SGC-VERIF-CALIDAD (R20, S14).
 *   5 Preparación de la capacitación (R27): la hace el CREADOR del documento.
 *   6 Divulgación (sin cambios).
 *   7 Capacitación (R27): el creador la dicta y carga los resultados; el
 *     cierre de Aseguramiento de Calidad se conserva (D18 abierta) y es un
 *     ajuste por empresa («Aseguramiento de Calidad cierra la capacitación»,
 *     ENCENDIDO por defecto).
 *
 * La siembra prisma/manual/2026-10-14-sgc-s15-flujo-doc-v7-olp.sql como versión
 * nueva de DOC; las solicitudes en curso conservan su versión (v6 o anterior).
 */
export const SGC_TASK_CREATION_AUTHORIZATION = 'autorizacion_creacion';

export const SGC_DOCUMENT_FLOW_V7: SgcFlowDefinition = {
  roleModel: 'solicitante_elabora',
  tasks: ([
    ...SGC_DOCUMENT_FLOW_TRAINING_FIRST.tasks.map((t): SgcTaskDefinition => {
      const stepOrder = t.stepOrder >= 1 ? t.stepOrder + 1 : t.stepOrder;
      if (t.key === 'solicitud') return { ...t, description: 'Cualquier persona del área registra la necesidad (nuevo, nueva versión o modificación) con su justificación; ella misma elaborará el documento.' };
      if (t.key === 'elaboracion') return { ...t, stepOrder, description: 'Quien hizo la solicitud elabora el documento: carga el borrador y asigna revisores y aprobadores de su departamento (un revisor también puede ser de Aseguramiento de Calidad).' };
      if (t.key === 'revision') return { ...t, stepOrder, description: 'Revisa alguien del área o de Aseguramiento de Calidad, nunca el elaborador.' };
      if (t.key === 'aprobacion') return { ...t, stepOrder, description: 'Aprueba el líder del departamento; dentro de la misma aprobación Aseguramiento de Calidad verifica la estructura documental con la lista de chequeo (no se estampa en el documento).' };
      if (t.key === 'preparacion_capacitacion') {
        return { ...t, stepOrder, assignment: 'creador', poolAuthorizationTypeCode: null, description: 'Antes de la divulgación, el creador del documento registra el material de la capacitación: video o sesión, quién dicta y la evaluación. Solo si la solicitud requiere capacitación.' };
      }
      if (t.key === 'capacitacion') {
        return { ...t, stepOrder, assignment: 'creador', description: 'El creador del documento dicta la capacitación, carga los resultados de la evaluación y firma «Capacitó»; Aseguramiento de Calidad la cierra si la empresa lo mantiene. Solo si la solicitud requiere capacitación.' };
      }
      return { ...t, stepOrder };
    }),
    {
      key: SGC_TASK_CREATION_AUTHORIZATION,
      name: 'Autorización de la creación',
      stepOrder: 1,
      role: 'calidad',
      assignment: 'calidad',
      multiAssignee: false,
      signingModeDefault: null,
      signatureMeaning: null,
      targetDays: 3,
      conditionKey: null,
      isAuthorization: true,
      authorizationTypeCode: SGC_AUTH_TYPE_QUALITY,
      poolAuthorizationTypeCode: SGC_AUTH_TYPE_QUALITY,
      isEnabled: true,
      description: 'Aseguramiento de Calidad autoriza o rechaza la creación del documento (por ejemplo, porque ya existe uno vigente que cubre el tema). Mientras no la autorice, nadie elabora.',
    },
  ] as SgcTaskDefinition[]).sort((a, b) => a.stepOrder - b.stepOrder),
  transitions: [
    ...SGC_DOCUMENT_FLOW_TRAINING_FIRST.transitions.filter((t) => !(t.from === 'solicitud' && t.action === 'aprobar')),
    { from: 'solicitud', action: 'aprobar', to: SGC_TASK_CREATION_AUTHORIZATION, terminalStatus: null },
    { from: SGC_TASK_CREATION_AUTHORIZATION, action: 'aprobar', to: 'elaboracion', terminalStatus: null },
    { from: SGC_TASK_CREATION_AUTHORIZATION, action: 'rechazar', to: null, terminalStatus: 'cancelada' },
    { from: SGC_TASK_CREATION_AUTHORIZATION, action: 'cancelar', to: null, terminalStatus: 'cancelada' },
  ],
  formFields: SGC_DOCUMENT_FLOW_TRAINING_FIRST.formFields,
};
