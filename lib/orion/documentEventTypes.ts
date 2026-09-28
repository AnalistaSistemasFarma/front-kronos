export const ORION_DOCUMENT_EVENT_LABEL = {
  DOCUMENTO_CARGADO: 'Documento cargado',
  NUEVA_SUBVERSION: 'Nueva subversión',
  ENVIADO_VALIDACION: 'Enviado a validación',
  VALIDACION_APROBADA: 'Validación aprobada',
  VALIDACION_DEVUELTA: 'Devuelto para corrección',
  APROBADO_PARA_FIRMA: 'Aprobado para firma',
  FIRMANTES_ASIGNADOS: 'Firmantes asignados',
  ENVIADO_A_FIRMA: 'Enviado a firma',
  FIRMA_REGISTRADA: 'Firma registrada',
  DEVUELTO_POR_FIRMANTE: 'Devuelto por firmante',
  RECHAZADO: 'Rechazado',
  FIRMADO: 'Documento firmado',
} as const;

export type OrionDocumentEventType = keyof typeof ORION_DOCUMENT_EVENT_LABEL;

export type OrionDocumentEvent = {
  id: number;
  requestId: number;
  fileId: string;
  orionDocumentId: string | null;
  versionLabel: string | null;
  eventType: OrionDocumentEventType | string;
  actorEmail: string | null;
  actorName: string | null;
  detail: string | null;
  createdAt: string;
};

export function orionDocumentEventLabel(type: string): string {
  return (ORION_DOCUMENT_EVENT_LABEL as Record<string, string>)[type] ?? type;
}
