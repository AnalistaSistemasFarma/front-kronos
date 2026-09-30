import type { SgcFlowDefinition } from './definition';

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
 *   4 Divulgación con lectura firmada   ┐ definidas, pero el motor las deja
 *   5 Capacitación (obligatoria)        ┘ «en espera» hasta el Sprint 4
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
