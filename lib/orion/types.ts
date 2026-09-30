export type OrionDocumentStatus =
  | 'BORRADOR'
  | 'PENDIENTE_FIRMA'
  | 'EN_PROCESO'
  | 'DEVUELTO'
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
  /** CardCode SAP cuando type = external. */
  cardCode?: string | null;
  /** Inicio del turno activo (ISO). */
  turnStartedAt?: string | null;
  /** Vencimiento del turno (ISO). Por defecto turnStartedAt + 24h. */
  expiresAt?: string | null;
  /** El firmante pidió renovar el plazo al líder. */
  extensionRequestedAt?: string | null;
  /** Enviar correo con link Orion al enviar a firma / turno. */
  notifyByEmail?: boolean | null;
  /** Este firmante debe aportar huella (además de rúbrica). */
  requireFingerprint?: boolean | null;
  /** ID visual de firma en el documento (editable; default = order). */
  signatureMarkId?: number | null;
  /** Orion: accept-sign exigirá biometricConsent* (huella / caja fingerprint). */
  requiresBiometricConsent?: boolean | null;
};

export type OrionDocumentVersionKind = 'original' | 'partial' | 'final' | 'validated';

export type OrionDocumentVersion = {
  id: string;
  kind: OrionDocumentVersionKind;
  label: string;
  url: string;
  createdAt: string;
  signerEmail?: string | null;
  signerName?: string | null;
};

/** Invite SynerLink para firmante externo (token en hash; plain solo al crear/enviar). */
export type OrionSignerInvite = {
  email: string;
  name?: string | null;
  /** SHA-256 del token en claro. */
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  sentAt?: string | null;
  usedAt?: string | null;
  /** Preferido: signUrl de Orion si existe. */
  signUrl?: string | null;
  cardCode?: string | null;
};

/** Intent de firma por adjunto: gestionar/firmar vs solo ver. */
export type OrionSignatureIntent = 'sign' | 'view';

/**
 * Tipo de firma del documento en preparación:
 * - electronic: rúbrica dibujada (flujo actual SynerLink ↔ Orion)
 * - digital: certificado digital (opción abierta; operación pendiente en Orion)
 */
export type OrionDocumentSignatureKind = 'electronic' | 'digital';

export type OrionReviewStatus =
  | 'SIN_VALIDACION'
  | 'EN_VALIDACION'
  | 'DEVUELTO_CORRECCION'
  | 'APROBADO';

export type OrionReviewDecision = 'PENDIENTE' | 'APROBADO' | 'DEVUELTO';

export type OrionReviewApproval = {
  userId?: string | null;
  email: string;
  name?: string | null;
  jobTitle?: string | null;
  order: number;
  decision: OrionReviewDecision;
  decidedAt?: string | null;
  comment?: string | null;
};

/** Validación previa a firma (validadores en secuencia configurados por flujo). */
export type OrionReviewState = {
  status: OrionReviewStatus;
  approvals: OrionReviewApproval[];
  /** Versión del PDF que están validando (p. ej. v1.2). */
  versionLabel?: string | null;
  submittedAt?: string | null;
  submittedBy?: string | null;
  approvedAt?: string | null;
  returnReason?: string | null;
  returnedBy?: string | null;
  returnedAt?: string | null;
  /** Ciclo de validación (1 = primera ronda; +1 por cada reenvío tras devolución). */
  round?: number;
};

/** Documento Orion reemplazado por una subversión nueva (queda en Orion como traza). */
export type OrionSupersededDocument = {
  orionDocumentId: string;
  externalRef?: string | null;
  versionLabel: string;
  supersededAt: string;
  reason?: string | null;
};

/** Estado Orion de un PDF concreto (por fileId de OneDrive). */
export type OrionSignatureState = {
  /** Versión del documento (v1.0, v1.1…). Nueva subversión por cada corrección. */
  versionLabel?: string | null;
  review?: OrionReviewState | null;
  supersededDocuments?: OrionSupersededDocument[];
  orionDocumentId?: string | null;
  externalRef?: string;
  fileId?: string;
  fileName?: string | null;
  /** URL del PDF adjunto original en OneDrive/SynerLink */
  originalFileUrl?: string | null;
  /**
   * Para firmar (`sign`) o solo consulta (`view`).
   * Ausente en bags viejos: se infiere (flujo Orion activo → sign).
   */
  signatureIntent?: OrionSignatureIntent | null;
  /** Preferencia de tipo de firma en preparación (default operativo: electronic). */
  signatureKind?: OrionDocumentSignatureKind | null;
  /** Si true, el firmante debe aportar huella además de rúbrica. */
  requireFingerprint?: boolean | null;
  /**
   * Política de huella: `per-signer` = solo quien tenga requireFingerprint.
   * Ausente en bags legacy (checkbox global / cajas para todos) → se migra al sincronizar.
   */
  fingerprintPolicy?: 'per-signer' | null;
  status?: OrionDocumentStatus;
  embedUrl?: string | null;
  signedFileUrl?: string | null;
  signedAt?: string | null;
  auditSummary?: string | null;
  /** Solo cuando status = DEVUELTO */
  returnReason?: string | null;
  returnedBy?: string | null;
  signers?: OrionSignerState[];
  /** Invites SynerLink para firmantes external (URL pública + correo). */
  signerInvites?: OrionSignerInvite[];
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
    kind?: 'signature' | 'fingerprint' | 'validation' | 'approval';
  }>;
  /**
   * Cajas de los validadores (kind approval, signerOrder = 900 + orden). No van a Orion:
   * SynerLink estampa ahí el chulito y, en la versión final, la firma guardada del validador.
   */
  validatorFields?: Array<{
    id: string;
    documentId: string;
    signerOrder: number;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
    kind?: 'signature' | 'fingerprint' | 'validation' | 'approval';
    validatorEmail?: string | null;
  }>;
  updatedAt?: string;
};

/** Contenedor persistido en request_form_value (campo orion_signature). */
/** Documento borrado con "Eliminar": los webhooks tardíos de Orion no deben revivirlo. */
export type OrionDeletedDocument = {
  fileId: string;
  fileName?: string | null;
  orionDocumentIds: string[];
  deletedAt: string;
  deletedByEmail?: string | null;
};

export type OrionSignatureBagBag = {
  documents: Record<string, OrionSignatureState>;
  updatedAt?: string;
  deletedDocuments?: OrionDeletedDocument[];
};

export type OrionCreateDocumentPayload = {
  externalRef: string;
  synerlinkRequestId: number;
  synerlinkCompanyId: number;
  synerlinkCategoryId?: number;
  synerlinkProcessId?: number;
  tenantId?: string;
  title: string;
  createdByEmail: string;
  pdfBase64?: string;
  companyName?: string;
  categoryName?: string;
  processName?: string;
  departmentName?: string;
  fileId?: string;
  fileName?: string;
  versionLabel?: string;
  /** orionDocumentId de la versión anterior (subversión). */
  previousOrionDocumentId?: string;
  metadata?: {
    source?: 'synerlink' | string;
    synerlinkRequestId?: number;
    synerlinkCompanyId?: number;
    companyName?: string;
    processName?: string;
    categoryName?: string;
    departmentName?: string;
    fileId?: string;
    fileName?: string;
    createdByEmail?: string;
    versionLabel?: string;
    previousOrionDocumentId?: string;
  };
};

export type OrionAssignSignersPayload = {
  mode: 'sequential' | 'parallel';
  signers: Array<{
    email: string;
    name?: string;
    order?: number;
    type?: 'internal' | 'external';
    cardCode?: string;
    /** Si true, Orion marca invitedAt y puede enviar correo. */
    notifyByEmail?: boolean;
    /** Si true, este firmante exige caja/huella. */
    requireFingerprint?: boolean;
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
    kind?: 'signature' | 'fingerprint' | 'validation';
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
  /** Solo en DEVUELTO */
  returnReason?: string | null;
  returnedBy?: string | null;
  /** Solo en RECHAZADO */
  rejectReason?: string | null;
  versionLabel?: string | null;
  previousOrionDocumentId?: string | null;
  completedSignerEmail?: string | null;
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
