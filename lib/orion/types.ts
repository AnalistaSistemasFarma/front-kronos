export type OrionDocumentStatus =
  | 'BORRADOR'
  | 'PENDIENTE_FIRMA'
  | 'EN_PROCESO'
  | 'FIRMADO'
  | 'RECHAZADO'
  | string;

export type OrionSignerState = {
  email?: string;
  name?: string;
  status?: string;
  signedAt?: string | null;
  signUrl?: string | null;
  order?: number;
  type?: 'internal' | 'external' | string;
};

export type OrionDocumentVersionKind = 'original' | 'partial' | 'final';

export type OrionDocumentVersion = {
  id: string;
  kind: OrionDocumentVersionKind;
  label: string;
  url: string;
  createdAt: string;
  signerEmail?: string | null;
  signerName?: string | null;
};

/** Estado Orion de un PDF concreto (por fileId de OneDrive). */
export type OrionSignatureState = {
  orionDocumentId?: string | null;
  externalRef?: string;
  fileId?: string;
  fileName?: string | null;
  /** URL del PDF adjunto original en OneDrive/SynerLink */
  originalFileUrl?: string | null;
  status?: OrionDocumentStatus;
  embedUrl?: string | null;
  signedFileUrl?: string | null;
  signedAt?: string | null;
  auditSummary?: string | null;
  signers?: OrionSignerState[];
  /** Historial de versiones (original + tras cada firma) */
  versions?: OrionDocumentVersion[];
  signatureFields?: Array<{
    id: string;
    documentId: string;
    signerOrder: number;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
  }>;
  updatedAt?: string;
};

/** Contenedor persistido en request_form_value (campo orion_signature). */
export type OrionSignatureBagBag = {
  documents: Record<string, OrionSignatureState>;
  updatedAt?: string;
};

export type OrionCreateDocumentPayload = {
  externalRef: string;
  synerlinkRequestId: number;
  synerlinkCompanyId: number;
  tenantId?: string;
  title: string;
  createdByEmail: string;
  pdfBase64?: string;
  metadata?: {
    processName?: string;
    categoryName?: string;
    fileId?: string;
    fileName?: string;
  };
};

export type OrionAssignSignersPayload = {
  mode: 'sequential' | 'parallel';
  signers: Array<{
    email: string;
    name?: string;
    order?: number;
    type?: 'internal' | 'external';
  }>;
};

export type OrionDocumentResponse = {
  orionDocumentId: string;
  externalRef?: string;
  status: OrionDocumentStatus;
  embedUrl?: string | null;
  signedFileUrl?: string | null;
  signedAt?: string | null;
  title?: string;
  signers?: OrionSignerState[];
  auditSummary?: string | null;
  signatureFields?: Array<{
    id: string;
    signerOrder: number;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
  }>;
};

export type OrionWebhookPayload = {
  orionDocumentId: string;
  externalRef?: string;
  synerlinkRequestId: number;
  status: OrionDocumentStatus;
  signedFileUrl?: string | null;
  signedAt?: string | null;
  signers?: OrionSignerState[];
  auditSummary?: string | null;
};

export type OrionPostMessageEvent =
  | 'DOCUMENT_UPDATED'
  | 'DOCUMENT_SIGNED'
  | 'DOCUMENT_REJECTED';

export type OrionPostMessage = {
  source: 'gss-firma';
  event: OrionPostMessageEvent;
  orionDocumentId?: string;
  synerlinkRequestId?: number;
  status?: OrionDocumentStatus;
  payload?: Partial<OrionSignatureState>;
};
