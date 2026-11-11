'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
} from '@mantine/core';
import { IconArrowBackUp, IconCheck, IconFileText } from '@tabler/icons-react';
import type { OrionPostMessage, OrionSignatureState } from '../../lib/orion/types';
import type { OrionParticipant, OrionUserOption } from '../../lib/orion/participants';
import type { SignatureFieldPlacement } from '../../lib/orion/signatureFields';
import {
  isOrionProtectedFileUrl,
  isOrionSignedFileProxyUrl,
  orionDocumentHasSignedCopy,
  resolveOrionPdfAccessUrl,
} from '../../lib/orion/signedFileAccess';
import { resolveRequestPdfAccessUrl } from '../../lib/attachments/fileUrl';
import { resolveOrionSignatureIntent } from '../../lib/orion/formValue';
import { allSlotsCompletedForEmail, getCurrentPendingSigner, isSignerCompleted } from '../../lib/orion/signerStatus';
import { canViewOrionDocumentVersions, isOrionDocumentSigner } from '../../lib/orion/documentVersions';
import { resolveOrionPermissions } from '../../lib/orion/permissions';
import SignaturePad from './SignaturePad';
import PdfInlineViewer from './PdfInlineViewer';
import OrionDocumentEditor from './OrionDocumentEditor';
import SignerTurnConfirm, { type SignerTurnConfirmation } from './SignerTurnConfirm';
import SignSuccessModal, { type SignSuccessInfo } from './SignSuccessModal';
import { invalidateAuthorizationDetailCache } from '@/lib/authorization/detailPrefetch';
import {
  invalidateUserProfileCache,
  loadUserProfile,
  peekUserProfile,
  prefetchUserProfile,
  type SignerTurnPreview,
} from '@/lib/orion/userProfileClient';
import {
  useOrionSignatureRegister,
  type OrionFileMeta,
  type OrionSignatureApi,
} from './OrionSignatureContext';

type Props = {
  requestId: number;
  requestTitle?: string;
  /** Bag inicial documents[fileId] o estado legacy de un solo doc */
  initialDocuments?: Record<string, OrionSignatureState> | null;
  initialState?: OrionSignatureState | null;
  createdByEmail?: string;
  requesterId?: string | null;
  currentUserEmail?: string;
  currentUserId?: string;
  participants?: OrionParticipant[];
  availableUsers?: OrionUserOption[];
  currentUserName?: string;
  /** Empresa de la solicitud (búsqueda de socios externos). */
  companyId?: number | null;
  onDocumentsChange?: (documents: Record<string, OrionSignatureState>) => void;
  workflowLocked?: boolean;
  /** Deep-link: abrir modal al montar */
  autoOpenFileId?: string | null;
  autoOpenAction?: 'sign' | 'manage' | 'view' | null;
  autoOpenFileName?: string | null;
  autoOpenPdfUrl?: string | null;
  /** Tras aprobar en Autorizaciones: no redirigir de nuevo; ver PDF → firmar */
  fromAuthorization?: boolean;
};

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

const LEGACY_FINGERPRINT_STORAGE_PREFIX = 'orion-fingerprint:';

/** Dato biométrico (Ley 1581): la huella vive en Orion ("Mi huella"), nunca en el navegador. */
function clearLegacyFingerprintStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_FINGERPRINT_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* private mode */
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1]! : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isLikelyPdfFetchUrl(url: string): boolean {
  const value = String(url || '').trim();
  if (!value) return false;
  if (value.startsWith('data:application/pdf') || value.startsWith('blob:')) return true;
  // Proxy Orion signed-file: en borrador responde 409 — no es el adjunto SynerLink.
  if (isOrionSignedFileProxyUrl(value) || isOrionProtectedFileUrl(value)) return false;
  if (value.startsWith('/')) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  // webUrl de SharePoint/OneDrive (visor), no el binario del PDF.
  if (/\/:([bwx]):\//i.test(value)) return false;
  return true;
}

async function fetchUrlAsBase64(url: string): Promise<string> {
  if (!isLikelyPdfFetchUrl(url)) {
    throw new Error('La URL del adjunto no es un PDF descargable');
  }
  const sameOrigin =
    url.startsWith('/') ||
    (typeof window !== 'undefined' && url.startsWith(window.location.origin));
  const res = await fetch(url, {
    credentials: sameOrigin ? 'include' : 'omit',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('No se pudo leer el archivo adjunto');
  const blob = await res.blob();
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  const magic = String.fromCharCode(...head);
  if (!magic.startsWith('%PDF')) {
    throw new Error('El adjunto no devolvió un PDF válido');
  }
  return fileToBase64(new File([blob], 'documento.pdf', { type: 'application/pdf' }));
}

function bootstrapDocuments(
  initialDocuments?: Record<string, OrionSignatureState> | null,
  initialState?: OrionSignatureState | null
): Record<string, OrionSignatureState> {
  if (initialDocuments && Object.keys(initialDocuments).length > 0) {
    return { ...initialDocuments };
  }
  if (initialState && (initialState.orionDocumentId || initialState.status || initialState.fileId)) {
    const key = String(initialState.fileId || '_legacy');
    return { [key]: { ...initialState, fileId: key } };
  }
  return {};
}

export default function OrionSignaturePanel({
  requestId,
  requestTitle,
  initialDocuments,
  initialState,
  createdByEmail,
  requesterId = null,
  currentUserEmail,
  currentUserId,
  participants = [],
  availableUsers = [],
  currentUserName,
  companyId = null,
  onDocumentsChange,
  workflowLocked = false,
  autoOpenFileId = null,
  autoOpenAction = null,
  autoOpenFileName = null,
  autoOpenPdfUrl = null,
  fromAuthorization = false,
}: Props) {
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [documentModalOpen, setDocumentModalOpen] = useState(false);
  const [editorInitialStep, setEditorInitialStep] = useState<0 | 1 | 2>(0);
  const [editorOpenNonce, setEditorOpenNonce] = useState(0);
  const [hasSignature, setHasSignature] = useState(false);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canSignPermission, setCanSignPermission] = useState(false);
  const [canFingerprintPermission, setCanFingerprintPermission] = useState(false);
  const [isFlowResponsible, setIsFlowResponsible] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Record<string, OrionSignatureState>>(() =>
    bootstrapDocuments(initialDocuments, initialState)
  );
  const [activeFile, setActiveFile] = useState<OrionFileMeta | null>(null);
  const activeFileRef = useRef<OrionFileMeta | null>(null);

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  // Calentar complete-sign apenas el firmante entra (evita compile 40–60 s en el 1er Firmar).
  useEffect(() => {
    if (!fromAuthorization) return;
    void fetch('/api/integrations/orion/complete-sign', { method: 'GET', cache: 'no-store' }).catch(
      () => undefined
    );
  }, [fromAuthorization]);

  const [resolvedEmbedOrigin, setResolvedEmbedOrigin] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);
  /** Solo el POST complete-sign; no mezclar con soft ensure al abrir el modal. */
  const [signingBusy, setSigningBusy] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [pendingAuthorizationByFile, setPendingAuthorizationByFile] = useState<
    Record<string, boolean>
  >({});
  const [signerModalIntent, setSignerModalIntent] = useState<'view' | 'sign' | 'manage'>('view');
  const [signSuccess, setSignSuccess] = useState<SignSuccessInfo | null>(null);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [personHasSigningConsent, setPersonHasSigningConsent] = useState(false);
  const [personHasBiometricConsent, setPersonHasBiometricConsent] = useState(false);
  /** Vista previa de solo lectura desde Orion (rúbrica, nombre, cédula, cargo, huella). */
  const [signerPreview, setSignerPreview] = useState<SignerTurnPreview | null>(null);
  const [signerPreviewLoading, setSignerPreviewLoading] = useState(false);
  /** Rúbrica dibujada en este turno: reemplaza la guardada en Orion. */
  const [turnSignature, setTurnSignature] = useState<string | null>(null);
  const [fingerprintHelpUrl, setFingerprintHelpUrl] = useState<string | null>(null);
  const padForTurnRef = useRef(false);
  /** Evita doble POST complete-sign (clic mientras carga perfil). */
  const confirmSignInFlightRef = useRef(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userRoleRef = useRef<'coordinator' | 'signer' | 'waiting' | 'viewer'>('viewer');
  const autoOpenedRef = useRef(false);
  const lastNotifyKeyRef = useRef('');
  const lastPatchKeyRef = useRef('');
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableEmbedSrcRef = useRef<string | null>(null);
  /** Tras dibujar rúbrica, abrir el modal de firma del documento */
  const continueToSignAfterPadRef = useRef(false);
  /** Primer GET ensure-document terminó (canManage ya es fiable). */
  const [permissionsReady, setPermissionsReady] = useState(false);
  /** Tras autorizar: overlay hasta abrir pad / modal de firma o fallar el deep-link. */
  const [postAuthPreparing, setPostAuthPreparing] = useState(
    () => Boolean(fromAuthorization && autoOpenAction === 'sign')
  );

  const state = activeFile ? documents[activeFile.fileId] ?? {} : {};

  const notifyDocuments = useCallback(
    (next: Record<string, OrionSignatureState>) => {
      const key = JSON.stringify(
        Object.entries(next).map(([id, doc]) => [
          id,
          doc.orionDocumentId,
          doc.status,
          (doc.signers ?? []).map((s) => `${s.email}:${s.status}`).join('|'),
        ])
      );
      if (key !== lastNotifyKeyRef.current) {
        lastNotifyKeyRef.current = key;
        onDocumentsChange?.(next);
      }
      setDocuments(next);
    },
    [onDocumentsChange]
  );

  const applyFileState = useCallback(
    (fileId: string, next: OrionSignatureState) => {
      setDocuments((prev) => {
        const merged = {
          ...prev,
          [fileId]: { ...next, fileId },
        };
        const key = JSON.stringify(
          Object.entries(merged).map(([id, doc]) => [
            id,
            doc.orionDocumentId,
            doc.status,
            (doc.signers ?? []).map((s) => `${s.email}:${s.status}`).join('|'),
          ])
        );
        if (key !== lastNotifyKeyRef.current) {
          lastNotifyKeyRef.current = key;
          onDocumentsChange?.(merged);
        }
        return merged;
      });
    },
    [onDocumentsChange]
  );

  const isValidRequestId =
    typeof requestId === 'number' && Number.isInteger(requestId) && requestId > 0;

  const loadUserSignature = useCallback(
    async (opts?: { force?: boolean }): Promise<boolean> => {
      const emailKey = normalizeEmail(currentUserEmail) || '_';
      const cacheKey = `orion-sig-embed:${emailKey}`;
      if (!opts?.force && typeof sessionStorage !== 'undefined') {
        try {
          const raw = sessionStorage.getItem(cacheKey);
          if (raw) {
            const cached = JSON.parse(raw) as {
              ts?: number;
              hasSignature?: boolean;
              dataUrl?: string | null;
            };
            if (cached.ts && Date.now() - cached.ts < 5 * 60_000) {
              const nextHas = Boolean(cached.hasSignature);
              setHasSignature(nextHas);
              setSignaturePreview(cached.dataUrl ?? null);
              return nextHas;
            }
          }
        } catch {
          /* ignore cache */
        }
      }
      try {
        const res = await fetch('/api/integrations/orion/signature-embed');
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const nextHas = Boolean(data.hasSignature);
          const nextPreview = (data.dataUrl as string | null) ?? null;
          setHasSignature(nextHas);
          setSignaturePreview(nextPreview);
          try {
            sessionStorage.setItem(
              cacheKey,
              JSON.stringify({ ts: Date.now(), hasSignature: nextHas, dataUrl: nextPreview })
            );
          } catch {
            /* ignore */
          }
          return nextHas;
        }
      } catch {
        /* ignore */
      }
      return false;
    },
    [currentUserEmail]
  );

  const refreshState = useCallback(
    async (
      fileId?: string,
      opts?: { lite?: boolean; soft?: boolean; rebuild?: boolean; markReady?: boolean }
    ) => {
      if (!isValidRequestId) {
        if (opts?.markReady) setPermissionsReady(true);
        return;
      }
      try {
        const qs = new URLSearchParams({ requestId: String(requestId) });
        if (fileId) qs.set('fileId', fileId);
        if (opts?.lite) qs.set('lite', '1');
        else if (opts?.soft) qs.set('soft', '1');
        if (opts?.rebuild) qs.set('rebuild', '1');
        const res = await fetch(`/api/integrations/orion/ensure-document?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (data.embedOrigin) setResolvedEmbedOrigin(data.embedOrigin);
        if (typeof data.canManage === 'boolean') setCanManage(data.canManage);
        if (typeof data.canSignPermission === 'boolean') {
          setCanSignPermission(data.canSignPermission);
        }
        if (typeof data.canFingerprintPermission === 'boolean') {
          setCanFingerprintPermission(data.canFingerprintPermission);
        }
        if (typeof data.isFlowResponsible === 'boolean') {
          setIsFlowResponsible(data.isFlowResponsible);
        }
        if (typeof data.isAdmin === 'boolean') setIsAdmin(data.isAdmin);
        if (data.documents && typeof data.documents === 'object') {
          notifyDocuments(data.documents as Record<string, OrionSignatureState>);
        } else if (data.state && fileId) {
          applyFileState(fileId, data.state as OrionSignatureState);
        }
        if (
          data.pendingAuthorizationByFile &&
          typeof data.pendingAuthorizationByFile === 'object'
        ) {
          setPendingAuthorizationByFile((prev) => ({
            ...prev,
            ...(data.pendingAuthorizationByFile as Record<string, boolean>),
          }));
        } else if (fileId && typeof data.pendingAuthorization === 'boolean') {
          setPendingAuthorizationByFile((prev) => ({
            ...prev,
            [fileId]: data.pendingAuthorization,
          }));
        }
      } catch {
        /* polling silencioso */
      } finally {
        if (opts?.markReady) setPermissionsReady(true);
      }
    },
    [applyFileState, isValidRequestId, notifyDocuments, requestId]
  );

  useEffect(() => {
    if (!isValidRequestId) {
      setPermissionsReady(true);
      return;
    }
    // lite: permisos/BD al instante. Luego sync real con Orion (sin soft)
    // para traer firmas hechas por /sign/{token} cuando el webhook no llegó.
    // Importante: no usar mountedRef aquí — si refreshState cambia, el cleanup
    // cancelaba el timer y el early-return impedía volver a sincronizar.
    let cancelled = false;
    void refreshState(undefined, { lite: true, markReady: true });
    const syncTimer = window.setTimeout(() => {
      if (cancelled || document.visibilityState !== 'visible') return;
      void refreshState(undefined, { markReady: false });
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(syncTimer);
    };
  }, [isValidRequestId, refreshState]);

  // Al volver a la pestaña, re-sincronizar con Orion (firma externa puede haber avanzado).
  useEffect(() => {
    if (!isValidRequestId) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshState(undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isValidRequestId, refreshState]);

  // Si el bag llega después (form values async), incorporar documentos sin pisar sync en vivo
  useEffect(() => {
    const incoming = bootstrapDocuments(initialDocuments, initialState);
    if (Object.keys(incoming).length === 0) return;
    setDocuments((prev) => {
      const next: Record<string, OrionSignatureState> = { ...prev };
      let changed = false;
      for (const [fileId, incomingDoc] of Object.entries(incoming)) {
        const current = prev[fileId];
        if (!current) {
          next[fileId] = { ...incomingDoc, fileId };
          changed = true;
          continue;
        }
        // Si el estado vivo ya tiene documento Orion, actualizar firmas/versiones del bag
        // sin degradar el flujo en curso.
        if (current.orionDocumentId) {
          const currentVersions = current.versions ?? [];
          const incomingVersions = incomingDoc.versions ?? [];
          const nextSigned = incomingDoc.signedFileUrl || current.signedFileUrl;
          const nextVersions =
            incomingVersions.length >= currentVersions.length
              ? incomingVersions
              : currentVersions;
          const nextStatus = incomingDoc.status || current.status;
          const nextSigners =
            (incomingDoc.signers?.length ?? 0) >= (current.signers?.length ?? 0)
              ? incomingDoc.signers
              : current.signers;
          if (
            nextSigned !== current.signedFileUrl ||
            nextVersions !== current.versions ||
            nextStatus !== current.status ||
            nextSigners !== current.signers
          ) {
            next[fileId] = {
              ...current,
              signedFileUrl: nextSigned,
              versions: nextVersions,
              status: nextStatus,
              signers: nextSigners,
            };
            changed = true;
          }
          continue;
        }

        const currentVersions = current.versions ?? [];
        const incomingVersions = incomingDoc.versions ?? [];
        next[fileId] = {
          ...incomingDoc,
          ...current,
          fileId,
          orionDocumentId: current.orionDocumentId || incomingDoc.orionDocumentId,
          status: current.status || incomingDoc.status,
          signers:
            (current.signers?.length ?? 0) > 0 ? current.signers : incomingDoc.signers,
          embedUrl: current.embedUrl || incomingDoc.embedUrl,
          signedFileUrl: incomingDoc.signedFileUrl || current.signedFileUrl,
          versions:
            incomingVersions.length >= currentVersions.length
              ? incomingVersions
              : currentVersions,
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [initialDocuments, initialState]);

  const ensureDocument = useCallback(
    async (
      file: OrionFileMeta,
      pdfBase64?: string,
      opts?: { refresh?: boolean }
    ) => {
      setLoading(true);
      setError(null);
      try {
        const current = documents[file.fileId];
        const alreadyReady = Boolean(current?.orionDocumentId && current?.embedUrl);
        // No refrescar Orion si el doc ya está listo (salvo PDF nuevo o refresh explícito).
        const refresh =
          Boolean(opts?.refresh) ||
          (Boolean(pdfBase64) ? false : !alreadyReady && Boolean(current?.orionDocumentId));
        const res = await fetch('/api/integrations/orion/ensure-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            fileId: file.fileId,
            fileName: file.fileName,
            title: requestTitle,
            createdByEmail,
            pdfBase64,
            refresh,
            originalFileUrl: file.pdfUrl,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo preparar el documento');
        if (data.embedOrigin) setResolvedEmbedOrigin(data.embedOrigin);
        if (data.state?.embedUrl) stableEmbedSrcRef.current = data.state.embedUrl;
        if (data.documents) {
          notifyDocuments(data.documents as Record<string, OrionSignatureState>);
        } else if (data.state) {
          applyFileState(file.fileId, data.state as OrionSignatureState);
        }
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al conectar con el motor de firma');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [applyFileState, createdByEmail, documents, notifyDocuments, requestId, requestTitle]
  );

  const permissions = useMemo(
    () =>
      resolveOrionPermissions({
        canManage,
        isAdmin,
        currentUserEmail,
        currentUserId,
        createdByEmail,
        requesterId,
        isFlowResponsible,
        state,
        hasAttachment: Boolean(activeFile?.pdfUrl),
        hasPersonalSignature: hasSignature,
        workflowLocked,
      }),
    [
      activeFile?.pdfUrl,
      canManage,
      createdByEmail,
      currentUserEmail,
      currentUserId,
      hasSignature,
      isAdmin,
      isFlowResponsible,
      requesterId,
      state,
      workflowLocked,
    ]
  );

  userRoleRef.current = permissions.userRole;

  const mySigner = useMemo(() => {
    const me = normalizeEmail(currentUserEmail);
    if (!me || !state.signers?.length) return null;
    const pending = getCurrentPendingSigner(state.signers);
    if (pending && normalizeEmail(pending.email) === me) return pending;
    return state.signers.find((s) => normalizeEmail(s.email) === me) ?? null;
  }, [currentUserEmail, state.signers]);

  // Prefetch de perfil Orion (consentimiento + rúbrica) apenas hay correo.
  useEffect(() => {
    if (!currentUserEmail) return;
    const needsFp = mySigner?.requireFingerprint === true;
    prefetchUserProfile(currentUserEmail, needsFp);
    const cached = peekUserProfile(currentUserEmail, needsFp);
    if (cached) {
      setPersonHasSigningConsent(Boolean(cached.hasSigningLegalConsent));
      setPersonHasBiometricConsent(Boolean(cached.hasBiometricConsent));
      if (cached.hasSignature) setHasSignature(true);
      return;
    }
    void loadUserProfile(currentUserEmail, needsFp).then((preview) => {
      if (!preview) return;
      setPersonHasSigningConsent(Boolean(preview.hasSigningLegalConsent));
      setPersonHasBiometricConsent(Boolean(preview.hasBiometricConsent));
      if (preview.hasSignature) setHasSignature(true);
    });
  }, [currentUserEmail, mySigner?.requireFingerprint]);

  useEffect(() => {
    clearLegacyFingerprintStorage();
  }, []);

  // Rúbrica, nombre, cédula, cargo, huella y consentimientos (caché → UI al toque).
  useEffect(() => {
    if (!identityModalOpen || !currentUserEmail) return;
    let cancelled = false;
    const needsFp = mySigner?.requireFingerprint === true;
    const cached = peekUserProfile(currentUserEmail, needsFp);
    if (cached) {
      setSignerPreview(cached);
      setSignerPreviewLoading(false);
      if (cached.hasSigningLegalConsent) setPersonHasSigningConsent(true);
      if (cached.hasBiometricConsent) setPersonHasBiometricConsent(true);
      if (cached.hasSignature) setHasSignature(true);
    } else {
      setSignerPreviewLoading(true);
    }
    void loadUserProfile(currentUserEmail, needsFp)
      .then((preview) => {
        if (cancelled || !preview) return;
        setSignerPreview(preview);
        if (preview.hasSigningLegalConsent) setPersonHasSigningConsent(true);
        if (preview.hasBiometricConsent) setPersonHasBiometricConsent(true);
        if (preview.hasSignature) setHasSignature(true);
      })
      .finally(() => {
        if (!cancelled) setSignerPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identityModalOpen, currentUserEmail, mySigner?.requireFingerprint]);

  useEffect(() => {
    setIdentityError(null);
    setTurnSignature(null);
    setFingerprintHelpUrl(null);
  }, [mySigner?.order, activeFile?.fileId, currentUserEmail]);

  const statusUpper = String(state.status || '').toUpperCase();
  const hasDocument = Boolean(state.orionDocumentId && state.embedUrl);
  const isTerminal = statusUpper === 'FIRMADO' || statusUpper === 'RECHAZADO';
  const isMyTurn = permissions.isMyTurn;
  const currentUserCompleted = currentUserEmail
    ? allSlotsCompletedForEmail(state.signers, currentUserEmail)
    : false;

  const confirmSign = useCallback(
    async (confirmation?: SignerTurnConfirmation | null, drawnOverride?: string | null) => {
      const file = activeFile ?? activeFileRef.current;
      if (!file) {
        setIdentityError(
          'No hay documento activo para firmar. Cierre el modal e intente de nuevo desde Firmar.'
        );
        return false;
      }
      if (confirmSignInFlightRef.current) return false;
      confirmSignInFlightRef.current = true;
      setSigningBusy(true);
      setAcceptLoading(true);
      setIdentityError(null);
      setFingerprintHelpUrl(null);
      setError(null);

      const needsFingerprint = mySigner?.requireFingerprint === true;
      // Sin modal: si ya hay rúbrica y consentimientos, firmar al toque.
      let effectiveConfirmation = confirmation ?? null;
      try {
        if (!effectiveConfirmation) {
          const needsFp = needsFingerprint;
          let preview =
            signerPreview ??
            (currentUserEmail ? peekUserProfile(currentUserEmail, needsFp) : null);
          if (!preview && currentUserEmail) {
            preview = await loadUserProfile(currentUserEmail, needsFp);
            if (preview) {
              setSignerPreview(preview);
              if (preview.hasSigningLegalConsent) setPersonHasSigningConsent(true);
              if (preview.hasBiometricConsent) setPersonHasBiometricConsent(true);
              if (preview.hasSignature) setHasSignature(true);
            }
          }
          const consentOk = personHasSigningConsent || Boolean(preview?.hasSigningLegalConsent);
          const biometricOk =
            !needsFp || personHasBiometricConsent || Boolean(preview?.hasBiometricConsent);
          const hasRubric = Boolean(
            drawnOverride?.startsWith('data:image/') ||
              turnSignature?.startsWith('data:image/') ||
              preview?.hasSignature ||
              hasSignature
          );
          if (!hasRubric) {
            padForTurnRef.current = true;
            setSignatureModalOpen(true);
            return false;
          }
          if (
            !consentOk ||
            (needsFp && !canFingerprintPermission) ||
            (needsFp && !biometricOk) ||
            (needsFp && !preview?.hasFingerprint)
          ) {
            setIdentityModalOpen(true);
            return false;
          }
          // Un clic solo si Orion ya tiene los datos del sello; si falta cédula/nombre/cargo, modal.
          if ((preview?.missingInOrion?.length ?? 0) > 0) {
            setIdentityModalOpen(true);
            return false;
          }
          effectiveConfirmation = {
            acceptedTerms: true,
            acceptedBiometric: needsFp ? true : undefined,
            identity: {
              fullName: preview?.fullName || preview?.suggested.fullName || currentUserName || '',
              // Precedencia Orion → sugerencia SynerLink (nunca al revés en el sello).
              idNumber: preview?.idNumber || preview?.suggested.idNumber || '',
              jobTitle: preview?.jobTitle ?? null,
            },
          };
        }
        // Solo el checkbox por slot (requireFingerprint): el mismo email puede firmar sin huella en otro turno.
        if (!personHasSigningConsent && effectiveConfirmation.acceptedTerms !== true) {
          setIdentityError('Debe leer y aceptar las condiciones de firma para continuar.');
          setIdentityModalOpen(true);
          return false;
        }
        if (needsFingerprint) {
          if (!canFingerprintPermission) {
            setIdentityError(
              'No tiene permiso “Registrar huella”. Pídalo en Administración → Usuarios.'
            );
            setIdentityModalOpen(true);
            return false;
          }
          if (!personHasBiometricConsent && effectiveConfirmation.acceptedBiometric !== true) {
            setIdentityError(
              'Debe autorizar el tratamiento de su huella dactilar para continuar.'
            );
            setIdentityModalOpen(true);
            return false;
          }
        }

        const drawn =
          (drawnOverride?.startsWith('data:image/') ? drawnOverride : null) ||
          (turnSignature?.startsWith('data:image/') ? turnSignature : null);
        const confirmation = effectiveConfirmation;
        const supplement = confirmation.supplement;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90_000);
        let res: Response;
        try {
          res = await fetch('/api/integrations/orion/complete-sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: controller.signal,
            body: JSON.stringify({
              requestId,
              fileId: file.fileId,
              // Sin rúbrica dibujada, Orion usa la guardada en su perfil.
              ...(drawn ? { signatureDataUrl: drawn } : {}),
              // Orion usa la huella de "Mi huella"; no se envía imagen por turno.
              requireFingerprint: needsFingerprint,
              acceptedTerms: personHasSigningConsent || confirmation.acceptedTerms === true,
              ...(needsFingerprint
                ? {
                    acceptedBiometric:
                      personHasBiometricConsent || confirmation.acceptedBiometric === true,
                  }
                : {}),
              // Identidad del turno (cédula/cargo editables en el modal).
              ...(() => {
                const identity = confirmation.identity || supplement;
                if (!identity && !signerPreview?.fullName && !currentUserName) return {};
                return {
                  fullName:
                    identity?.fullName ||
                    signerPreview?.fullName ||
                    currentUserName ||
                    '',
                  idDocumentType: 'CC',
                  idNumber:
                    identity?.idNumber ??
                    signerPreview?.idNumber ??
                    '',
                  jobTitle:
                    identity && 'jobTitle' in identity
                      ? identity.jobTitle
                      : signerPreview?.jobTitle ?? null,
                };
              })(),
            }),
          });
        } finally {
          clearTimeout(timeoutId);
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const code = typeof data.code === 'string' ? data.code : '';
          const msg = String(data.error || `No se pudo confirmar la firma (${res.status})`);
          if (code === 'SIGNER_ALREADY_SIGNED') {
            setIdentityModalOpen(false);
            setIdentityError(null);
            setSignSuccess({
              kind: 'already',
              message: 'Su firma ya estaba registrada. Continúe con el flujo.',
              fileName: file.fileName,
            });
            setDocumentModalOpen(false);
            setSignerModalIntent('view');
            void refreshState(file.fileId, { soft: true });
            return true;
          }
          if (code === 'NOT_YOUR_TURN' || code === 'DOCUMENT_CLOSED' || code === 'SIGNER_NOT_FOUND') {
            setIdentityModalOpen(false);
            setIdentityError(null);
            setDocumentModalOpen(false);
            setSignerModalIntent('view');
            setError(msg);
            void refreshState(file.fileId, { soft: true });
            return false;
          }
          if (code === 'SIGNATURE_NOT_REGISTERED') {
            // Pad del turno: la rúbrica dibujada viaja en accept-sign y queda guardada en Orion.
            setIdentityModalOpen(false);
            setHasSignature(false);
            padForTurnRef.current = true;
            setSignatureModalOpen(true);
            setIdentityError(msg);
            return false;
          }
          if (code === 'FINGERPRINT_NOT_REGISTERED') {
            setFingerprintHelpUrl(
              String(data.fingerprintProfileUrl || signerPreview?.fingerprintProfileUrl || '') ||
                null
            );
            setIdentityError(msg);
            return false;
          }
          setIdentityError(msg);
          setError(msg);
          return false;
        }
        if (data.documents) {
          notifyDocuments(data.documents as Record<string, OrionSignatureState>);
        } else if (data.state) {
          applyFileState(file.fileId, data.state as OrionSignatureState);
        }
        if (data.signerCompleted) {
          // Cerrar UI de inmediato; el consentimiento persona puede persistir en paralelo.
          // complete-sign ya cerró la autorización FIRMA de este PDF.
          setPendingAuthorizationByFile((prev) => ({ ...prev, [file.fileId]: false }));
          setIdentityModalOpen(false);
          setIdentityError(null);
          setSigningBusy(false);
          {
            const nextState: OrionSignatureState | null =
              (data.documents &&
                typeof data.documents === 'object' &&
                (data.documents as Record<string, OrionSignatureState>)[file.fileId]) ||
              (data.state as OrionSignatureState | undefined) ||
              null;
            const statusUp = String(nextState?.status || data.status || '').toUpperCase();
            const documentComplete =
              statusUp === 'FIRMADO' ||
              Boolean(
                nextState?.signers?.length &&
                  nextState.signers.every((s) => isSignerCompleted(s.status))
              );
            const nextPending = nextState ? getCurrentPendingSigner(nextState.signers) : null;
            const nextSignerLabel = nextPending
              ? String(nextPending.name || nextPending.email || '').trim() || null
              : null;
            setSignSuccess({
              kind: 'signed',
              message: String(data.message || 'Documento firmado correctamente.'),
              fileName: file.fileName,
              documentComplete,
              nextSignerLabel: documentComplete ? null : nextSignerLabel,
              signedAt: new Date(),
            });
            invalidateAuthorizationDetailCache(requestId, currentUserEmail);
          }
          setDocumentModalOpen(false);
          setSignerModalIntent('view');
          setTurnSignature(null);
          const justAcceptedTerms =
            !personHasSigningConsent && confirmation.acceptedTerms === true;
          const justAcceptedBiometric =
            needsFingerprint &&
            !personHasBiometricConsent &&
            confirmation.acceptedBiometric === true;
          if (justAcceptedTerms || justAcceptedBiometric) {
            void fetch('/api/integrations/orion/signing-consent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                ...(justAcceptedTerms ? { acceptedTerms: true } : {}),
                ...(justAcceptedBiometric ? { acceptedBiometric: true } : {}),
              }),
            })
              .then(async (consentRes) => {
                const consentData = await consentRes.json().catch(() => ({}));
                if (!consentRes.ok) return;
                if (consentData.hasSigningLegalConsent === true || justAcceptedTerms) {
                  setPersonHasSigningConsent(true);
                }
                if (consentData.hasBiometricConsent === true || justAcceptedBiometric) {
                  setPersonHasBiometricConsent(true);
                }
                invalidateUserProfileCache(currentUserEmail);
              })
              .catch(() => {
                /* no bloquear la firma por fallo de persistencia */
              });
          }
          // Quitar deep-link para que un F5 no vuelva a abrir “Firmar”.
          try {
            const url = new URL(window.location.href);
            let changed = false;
            for (const key of ['orionAction', 'orionFileId']) {
              if (url.searchParams.has(key)) {
                url.searchParams.delete(key);
                changed = true;
              }
            }
            if (url.searchParams.get('from') === 'authorization') {
              url.searchParams.set('from', 'assigned-activities');
              changed = true;
            }
            if (changed) {
              window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
            }
          } catch {
            /* ignore */
          }
          return true;
        }
        const msg = String(
          data.message ||
            'No se pudo registrar la firma. Verifique su rúbrica e intente de nuevo.'
        );
        setIdentityError(msg);
        setError(msg);
        return false;
      } catch (err) {
        const aborted =
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && /abort/i.test(err.message));
        const detail = err instanceof Error ? err.message : '';
        const msg = aborted
          ? 'La confirmación tardó demasiado. Verifique GSS Firma (Orion) e intente de nuevo.'
          : detail && /fetch|network|failed/i.test(detail)
            ? `Error de conexión al confirmar la firma (${detail}). Verifique que GSS Firma (Orion) esté en marcha.`
            : 'Error de conexión al confirmar la firma. Verifique que GSS Firma (Orion) esté en marcha e intente de nuevo.';
        setIdentityError(msg);
        setError(msg);
        return false;
      } finally {
        confirmSignInFlightRef.current = false;
        setSigningBusy(false);
        setAcceptLoading(false);
      }
    },
    [
      activeFile,
      applyFileState,
      canFingerprintPermission,
      currentUserEmail,
      hasSignature,
      mySigner?.requireFingerprint,
      notifyDocuments,
      personHasBiometricConsent,
      personHasSigningConsent,
      refreshState,
      requestId,
      currentUserName,
      signerPreview,
      turnSignature,
    ]
  );

  const confirmReturnDocument = useCallback(async () => {
    const file = activeFile ?? activeFileRef.current;
    if (!file) {
      setReturnError('No hay documento activo. Cierre e intente de nuevo.');
      return;
    }
    const reason = returnReason.trim();
    if (reason.length < 3) {
      setReturnError('Indique el motivo de la devolución (mín. 3 caracteres).');
      return;
    }
    setReturnLoading(true);
    setReturnError(null);
    setError(null);
    try {
      const res = await fetch('/api/integrations/orion/return-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          requestId,
          fileId: file.fileId,
          reason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = String(data.error || `No se pudo devolver el documento (${res.status})`);
        setReturnError(msg);
        setError(msg);
        return;
      }
      if (data.documents) {
        notifyDocuments(data.documents as Record<string, OrionSignatureState>);
      } else if (data.state) {
        applyFileState(file.fileId, data.state as OrionSignatureState);
      }
      setReturnModalOpen(false);
      setReturnReason('');
      setReturnError(null);
      setDocumentModalOpen(false);
      setSignerModalIntent('view');
      setError(null);
      setSignSuccess({
        kind: 'returned',
        message: String(data.message || 'Documento devuelto para corrección.'),
        fileName: file.fileName,
      });
    } catch {
      const msg = 'Error de conexión al devolver el documento.';
      setReturnError(msg);
      setError(msg);
    } finally {
      setReturnLoading(false);
    }
  }, [activeFile, applyFileState, notifyDocuments, requestId, returnReason]);

  const openDocumentEditor = useCallback(
    async (file: OrionFileMeta, options?: { initialStep?: 0 | 1 | 2 }) => {
      setError(null);
      setSignerModalIntent('manage');
      stableEmbedSrcRef.current = null;
      const step = options?.initialStep;
      setEditorInitialStep(step === 1 || step === 2 ? step : 0);
      setEditorOpenNonce((n) => n + 1);

      const fileState = documents[file.fileId] ?? {};
      const filePerms = resolveOrionPermissions({
        canManage,
        isAdmin,
        currentUserEmail,
        currentUserId,
        createdByEmail,
        requesterId,
        isFlowResponsible,
        state: fileState,
        hasAttachment: true,
        hasPersonalSignature: hasSignature,
        workflowLocked,
      });

      if (!filePerms.canManageWorkflow) {
        setError(
          !filePerms.isFlowResponsible
            ? 'Solo un preparador documento asignado al flujo (con permiso Preparar firma) puede preparar el documento.'
            : !canManage
              ? 'No tiene permiso “Preparar firma”. Asígueselo en Administración → Usuarios.'
              : workflowLocked
                ? 'Esta tarea o solicitud ya está cerrada. Abra la solicitud o su tarea pendiente para preparar el documento.'
                : 'El documento ya tiene firmas o está finalizado; ya no se puede cambiar la preparación.'
        );
        return false;
      }

      // Preparar documento ⇒ Orion. Si aún estaba en Solo ver, marcar Para firmar primero.
      if (resolveOrionSignatureIntent(fileState) !== 'sign') {
        try {
          const intentRes = await fetch('/api/integrations/orion/signature-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId,
              fileId: file.fileId,
              fileName: file.fileName,
              intent: 'sign',
              originalFileUrl: file.pdfUrl || null,
            }),
          });
          const intentData = await intentRes.json().catch(() => ({}));
          if (intentRes.ok && intentData.documents) {
            notifyDocuments(intentData.documents as Record<string, OrionSignatureState>);
          } else if (!intentRes.ok) {
            setError(
              typeof intentData.error === 'string'
                ? intentData.error
                : 'Marque el PDF como “Para firmar” antes de prepararlo.'
            );
            return false;
          }
        } catch {
          setError('No se pudo marcar el documento para firma.');
          return false;
        }
      }

      const hasSignedProgress = orionDocumentHasSignedCopy(fileState);
      const resolvedPdfUrl = resolveRequestPdfAccessUrl({
        requestId,
        fileId: file.fileId,
        state: fileState,
      });
      const liveOdUrl =
        (isLikelyPdfFetchUrl(file.pdfUrl) ? file.pdfUrl : null) ||
        (fileState.originalFileUrl && isLikelyPdfFetchUrl(fileState.originalFileUrl)
          ? fileState.originalFileUrl
          : null) ||
        (!hasSignedProgress ? resolvedPdfUrl : null);

      // No abrir el canvas con signed-file (409 en borrador) ni URL muerta del bag.
      setDocumentModalOpen(true);
      setUploading(true);
      const rubricPromise = loadUserSignature();

      try {
        let editorSrc: string | null = null;
        let pdfBase64: string | undefined;

        if (hasSignedProgress) {
          editorSrc =
            resolveOrionPdfAccessUrl(fileState, file.pdfUrl ?? null, {
              requestId,
              fileId: file.fileId,
            }) || resolvedPdfUrl;
        } else if (liveOdUrl) {
          try {
            pdfBase64 = await fetchUrlAsBase64(liveOdUrl);
            editorSrc = `data:application/pdf;base64,${pdfBase64}`;
          } catch {
            setError(
              'No se pudo leer el PDF en SynerLink. Vuelva a subir el archivo e intente Preparar de nuevo.'
            );
            setActiveFile({ ...file, pdfUrl: '' });
            await rubricPromise;
            return false;
          }
        } else {
          setError(
            'Este PDF ya no está en SynerLink (solo queda el registro de firma). Elimínelo de la lista, súbalo otra vez y vuelva a Preparar.'
          );
          setActiveFile({ ...file, pdfUrl: '' });
          await rubricPromise;
          return false;
        }

        setActiveFile({ ...file, pdfUrl: editorSrc || file.pdfUrl });

        if (fileState.orionDocumentId && fileState.embedUrl) {
          const hasRubric = await rubricPromise;
          if (!hasRubric && filePerms.canDrawSignature) {
            setSignatureModalOpen(true);
            return false;
          }
          return true;
        }

        const [hasRubric, ok] = await Promise.all([
          rubricPromise,
          ensureDocument(
            {
              ...file,
              pdfUrl: liveOdUrl || file.pdfUrl,
            },
            pdfBase64
          ),
        ]);
        if (!hasRubric && filePerms.canDrawSignature) {
          setSignatureModalOpen(true);
        }
        if (editorSrc?.startsWith('data:')) {
          setActiveFile((prev) =>
            prev?.fileId === file.fileId ? { ...prev, pdfUrl: editorSrc! } : prev
          );
        }
        return ok;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo usar el archivo adjunto');
        return false;
      } finally {
        setUploading(false);
      }
    },
    [
      canManage,
      createdByEmail,
      currentUserEmail,
      currentUserId,
      documents,
      ensureDocument,
      hasSignature,
      isAdmin,
      isFlowResponsible,
      loadUserSignature,
      notifyDocuments,
      requestId,
      requesterId,
      workflowLocked,
    ]
  );

  const openSignerView = useCallback((file: OrionFileMeta) => {
    setActiveFile(file);
    setSignerModalIntent('view');
    setDocumentModalOpen(true);
  }, []);

  /** Tras ver el PDF: dibujar rúbrica si falta, luego abrir firma del documento. */
  const proceedToAcceptSign = useCallback(
    async (file: OrionFileMeta, opts?: { skipAuthRedirect?: boolean }) => {
      void opts;
      setActiveFile(file);
      setAcceptLoading(true);
      setError(null);
      if (!canSignPermission) {
        setError(
          'No tiene permiso “Firmar documento”. Sin ese permiso no puede firmar aunque esté asignado como firmante.'
        );
        setAcceptLoading(false);
        return;
      }
      try {
        const qs = new URLSearchParams({
          requestId: String(requestId),
          fileId: file.fileId,
          // Solo BD + auth pendiente (sin Orion GET): el PDF ya está en el adjunto.
          soft: '1',
        });
        const ensureUrl = `/api/integrations/orion/ensure-document?${qs}`;
        const localState = documents[file.fileId] ?? {};
        const hasLocalSigners = (localState.signers?.length ?? 0) > 0;

        const applyEnsurePayload = (data: Record<string, unknown>) => {
          if (data.documents) {
            notifyDocuments(data.documents as Record<string, OrionSignatureState>);
          } else if (data.state) {
            applyFileState(file.fileId, data.state as OrionSignatureState);
          }
          if (data.pendingAuthorizationByFile && typeof data.pendingAuthorizationByFile === 'object') {
            setPendingAuthorizationByFile((prev) => ({
              ...prev,
              ...(data.pendingAuthorizationByFile as Record<string, boolean>),
            }));
          } else if (typeof data.pendingAuthorization === 'boolean') {
            const pending = data.pendingAuthorization;
            setPendingAuthorizationByFile((prev) => ({
              ...prev,
              [file.fileId]: pending,
            }));
          }
        };

        const meEarly = normalizeEmail(currentUserEmail);
        const alreadyDoneLocal = meEarly
          ? allSlotsCompletedForEmail(localState.signers, meEarly)
          : false;
        const statusLocal = String(localState.status || '').toUpperCase();
        const terminalLocal = statusLocal === 'FIRMADO' || statusLocal === 'RECHAZADO';
        if (alreadyDoneLocal || terminalLocal) {
          setSignSuccess({
            kind: alreadyDoneLocal ? 'already' : 'closed',
            message: alreadyDoneLocal
              ? 'Su firma ya estaba registrada en el documento. No es necesario firmar de nuevo.'
              : 'Este documento ya está cerrado. No hay firma pendiente.',
            fileName: file.fileName,
          });
          setSignerModalIntent('view');
          setDocumentModalOpen(false);
          setError(null);
          return;
        }

        // Abrir el modal al toque; ensure/rúbrica en paralelo (Firmar no debe girar aquí).
        setSignerModalIntent('sign');
        setDocumentModalOpen(true);
        setAcceptLoading(false);
        void fetch('/api/integrations/orion/complete-sign', { method: 'GET', cache: 'no-store' }).catch(
          () => undefined
        );

        const rubricPromise = loadUserSignature();
        let fileState: OrionSignatureState = localState;
        if (hasLocalSigners) {
          void fetch(ensureUrl)
            .then(async (ensureRes) => {
              const data = (await ensureRes.json().catch(() => ({}))) as Record<string, unknown>;
              if (ensureRes.ok) applyEnsurePayload(data);
            })
            .catch(() => {
              /* soft sync opcional */
            });
        } else {
          const [ensureRes] = await Promise.all([fetch(ensureUrl), rubricPromise]);
          const data = (await ensureRes.json().catch(() => ({}))) as Record<string, unknown>;
          if (ensureRes.ok) {
            applyEnsurePayload(data);
            const syncedDocs =
              data.documents && typeof data.documents === 'object'
                ? (data.documents as Record<string, OrionSignatureState>)
                : null;
            fileState =
              syncedDocs?.[file.fileId] ??
              (data.state as OrionSignatureState | undefined) ??
              localState;
          }
        }

        const hasRubric = await rubricPromise;
        const me = normalizeEmail(currentUserEmail);
        const alreadyDone = me ? allSlotsCompletedForEmail(fileState.signers, me) : false;
        const fileStatus = String(fileState.status || '').toUpperCase();
        const fileTerminal = fileStatus === 'FIRMADO' || fileStatus === 'RECHAZADO';

        if (alreadyDone || fileTerminal) {
          setSignSuccess({
            kind: alreadyDone ? 'already' : 'closed',
            message: alreadyDone
              ? 'Su firma ya estaba registrada en el documento. No es necesario firmar de nuevo.'
              : 'Este documento ya está cerrado. No hay firma pendiente.',
            fileName: file.fileName,
          });
          setSignerModalIntent('view');
          setDocumentModalOpen(false);
          setError(null);
          return;
        }

        if (currentUserEmail) {
          const pending = getCurrentPendingSigner(fileState.signers);
          const needsFp =
            pending?.requireFingerprint === true &&
            normalizeEmail(pending.email) === normalizeEmail(currentUserEmail);
          prefetchUserProfile(currentUserEmail, needsFp);
        }

        if (!hasRubric) {
          continueToSignAfterPadRef.current = true;
          setSignatureModalOpen(true);
          return;
        }

        const filePerms = resolveOrionPermissions({
          canManage,
          isAdmin,
          currentUserEmail,
          currentUserId,
          createdByEmail,
          requesterId,
          isFlowResponsible,
          state: fileState,
          hasAttachment: true,
          hasPersonalSignature: true,
          workflowLocked,
        });
        if (filePerms.userRole === 'waiting') {
          setSignerModalIntent('view');
          setError('Aún no es su turno de firma. Espere a que firme el responsable anterior.');
          return;
        }
      } finally {
        setAcceptLoading(false);
      }
    },
    [
      applyFileState,
      canManage,
      canSignPermission,
      createdByEmail,
      currentUserEmail,
      currentUserId,
      documents,
      isAdmin,
      isFlowResponsible,
      loadUserSignature,
      notifyDocuments,
      requestId,
      requesterId,
      workflowLocked,
    ]
  );

  const handleAcceptSign = useCallback(
    async (file: OrionFileMeta) => {
      // Tras autorizar (o desde "Firmar"): ir directo a rúbrica/confirmar,
      // sin el paso intermedio "Aceptar y firmar" que obligaba a firmar dos veces.
      await proceedToAcceptSign(file, {
        skipAuthRedirect: fromAuthorization,
      });
    },
    [fromAuthorization, proceedToAcceptSign]
  );

  const saveSignature = useCallback(
    async (dataUrl: string) => {
      setSignatureSaving(true);
      setError(null);
      try {
        const res = await fetch('/api/integrations/orion/signature-embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureDataUrl: dataUrl, method: 'drawn' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar la firma');
        setHasSignature(true);
        setSignaturePreview(dataUrl);
        invalidateUserProfileCache(currentUserEmail);
        try {
          const emailKey = normalizeEmail(currentUserEmail) || '_';
          sessionStorage.setItem(
            `orion-sig-embed:${emailKey}`,
            JSON.stringify({ ts: Date.now(), hasSignature: true, dataUrl })
          );
        } catch {
          /* ignore */
        }
        setSignatureModalOpen(false);

        if (continueToSignAfterPadRef.current && activeFile) {
          continueToSignAfterPadRef.current = false;
          setSignerModalIntent('sign');
          setDocumentModalOpen(true);
          return;
        }

        // Solo el coordinador vuelve al editor de firmantes tras dibujar rúbrica
        if (activeFile && canManage && !fromAuthorization) {
          await openDocumentEditor(activeFile);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al guardar la firma');
      } finally {
        setSignatureSaving(false);
      }
    },
    [activeFile, canManage, currentUserEmail, fromAuthorization, openDocumentEditor]
  );

  const patchFromPostMessage = useCallback(
    (message: OrionPostMessage) => {
      if (!activeFile) return;
      const patch: OrionSignatureState = {
        orionDocumentId: message.orionDocumentId,
        status: message.status ?? message.payload?.status,
        embedUrl: state.embedUrl ?? message.payload?.embedUrl,
        signedFileUrl: message.payload?.signedFileUrl ?? state.signedFileUrl,
        signedAt: message.payload?.signedAt ?? state.signedAt,
        signers: message.payload?.signers ?? state.signers,
        auditSummary: message.payload?.auditSummary ?? state.auditSummary,
        fileId: activeFile.fileId,
      };
      const merged = { ...state, ...patch };
      const patchKey = JSON.stringify(merged);
      if (patchKey === lastPatchKeyRef.current) return;
      lastPatchKeyRef.current = patchKey;
      applyFileState(activeFile.fileId, merged);

      if (userRoleRef.current === 'signer') {
        if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
        patchTimerRef.current = setTimeout(() => {
          void confirmSign();
        }, 600);
        return;
      }

      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      patchTimerRef.current = setTimeout(() => {
        void fetch('/api/integrations/orion/ensure-document', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, fileId: activeFile.fileId, patch }),
        });
      }, 400);
    },
    [activeFile, applyFileState, confirmSign, requestId, state]
  );

  useEffect(() => {
    if (!documentModalOpen) return;
    const handler = (event: MessageEvent) => {
      const allowedOrigins = new Set<string>();
      if (resolvedEmbedOrigin) allowedOrigins.add(resolvedEmbedOrigin);
      if (state.embedUrl) {
        try {
          allowedOrigins.add(new URL(state.embedUrl).origin);
        } catch {
          /* ignore */
        }
      }
      if (allowedOrigins.size > 0 && !allowedOrigins.has(event.origin)) return;
      const data = event.data as OrionPostMessage | undefined;
      if (!data || data.source !== 'gss-firma') return;
      patchFromPostMessage(data);
    };
    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    };
  }, [documentModalOpen, patchFromPostMessage, resolvedEmbedOrigin, state.embedUrl]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const active = ['PENDIENTE_FIRMA', 'EN_PROCESO'].includes(statusUpper);
    // Solo el coordinador hace polling de estado; la firma se confirma con el botón
    if (active && hasDocument && documentModalOpen && permissions.userRole === 'coordinator') {
      pollRef.current = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        void refreshState(activeFile?.fileId, { soft: true });
      }, 45000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [
    activeFile?.fileId,
    documentModalOpen,
    hasDocument,
    permissions.userRole,
    refreshState,
    statusUpper,
  ]);

  useEffect(() => {
    if (state.embedUrl && !stableEmbedSrcRef.current) {
      stableEmbedSrcRef.current = state.embedUrl;
    }
  }, [state.embedUrl]);

  useEffect(() => {
    if (
      postAuthPreparing &&
      (signatureModalOpen || identityModalOpen || documentModalOpen || Boolean(error))
    ) {
      setPostAuthPreparing(false);
    }
  }, [
    documentModalOpen,
    error,
    identityModalOpen,
    postAuthPreparing,
    signatureModalOpen,
  ]);

  // Deep-link post-auth / desde tarea: solo si aún corresponde firmar/gestionar.
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!autoOpenFileId || !autoOpenAction || !autoOpenPdfUrl) return;
    if (!permissionsReady) return;

    const doc = documents[autoOpenFileId] ?? {};
    const me = normalizeEmail(currentUserEmail);
    const alreadyDone = me ? allSlotsCompletedForEmail(doc.signers, me) : false;
    const statusUpperDoc = String(doc.status || '').toUpperCase();
    const docTerminal = statusUpperDoc === 'FIRMADO' || statusUpperDoc === 'RECHAZADO';
    const pending = getCurrentPendingSigner(doc.signers);
    const isMyTurnNow = Boolean(
      me && pending && normalizeEmail(pending.email) === me
    );

    const clearDeepLink = () => {
      if (typeof window === 'undefined') return;
      try {
        const url = new URL(window.location.href);
        let changed = false;
        for (const key of ['orionAction', 'orionFileId']) {
          if (url.searchParams.has(key)) {
            url.searchParams.delete(key);
            changed = true;
          }
        }
        if (url.searchParams.get('from') === 'authorization') {
          url.searchParams.set('from', 'assigned-activities');
          changed = true;
        }
        if (changed) {
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        }
      } catch {
        /* ignore */
      }
    };

    if (autoOpenAction === 'manage') {
      if (!canManage) {
        autoOpenedRef.current = true;
        setPostAuthPreparing(false);
        clearDeepLink();
        setError('Solo el creador de la solicitud puede configurar la firma del documento.');
        return;
      }
    }

    if (autoOpenAction === 'sign') {
      // Ya firmó o el documento terminó: no reabrir el asistente al recargar.
      if (alreadyDone || docTerminal || (doc.signers?.length && !isMyTurnNow)) {
        autoOpenedRef.current = true;
        setPostAuthPreparing(false);
        clearDeepLink();
        return;
      }
    }

    autoOpenedRef.current = true;
    const meta: OrionFileMeta = {
      fileId: autoOpenFileId,
      fileName: autoOpenFileName || 'Documento.pdf',
      pdfUrl: autoOpenPdfUrl,
    };
    const t = window.setTimeout(() => {
      if (autoOpenAction === 'manage') {
        void openDocumentEditor(meta)
          .finally(() => {
            setPostAuthPreparing(false);
            clearDeepLink();
          });
      } else if (autoOpenAction === 'sign') {
        void handleAcceptSign(meta)
          .finally(() => {
            setPostAuthPreparing(false);
            clearDeepLink();
          });
      } else {
        openSignerView(meta);
        setPostAuthPreparing(false);
        clearDeepLink();
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [
    autoOpenAction,
    autoOpenFileId,
    autoOpenFileName,
    autoOpenPdfUrl,
    canManage,
    currentUserEmail,
    documents,
    handleAcceptSign,
    openDocumentEditor,
    openSignerView,
    permissionsReady,
  ]);

  // CTA desde adjuntos (evento global): garantiza Firmar aunque el context tarde
  useEffect(() => {
    const onOpenSign = (ev: Event) => {
      const detail = (ev as CustomEvent<OrionFileMeta>).detail;
      if (!detail?.fileId) return;
      void handleAcceptSign({
        fileId: String(detail.fileId),
        fileName: detail.fileName || 'Documento.pdf',
        pdfUrl: detail.pdfUrl || '',
      });
    };
    window.addEventListener('orion-open-sign', onOpenSign as EventListener);
    return () => window.removeEventListener('orion-open-sign', onOpenSign as EventListener);
  }, [handleAcceptSign]);

  const documentIframeSrc =
    hasDocument &&
    (isMyTurn && mySigner?.signUrl
      ? mySigner.signUrl
      : stableEmbedSrcRef.current ?? state.embedUrl);

  const registerOrionApi = useOrionSignatureRegister();

  const openSignedDocument = useCallback(
    (fileId: string) => {
      const fileState = documents[fileId] ?? {};
      const proxyUrl = resolveOrionPdfAccessUrl(fileState, null, { requestId, fileId });
      if (proxyUrl) window.open(proxyUrl, '_blank', 'noopener,noreferrer');
    },
    [documents, requestId]
  );

  const canViewVersions = canViewOrionDocumentVersions({
    isAdmin,
    currentUserId,
    requesterId,
    currentUserEmail,
    requesterEmail: createdByEmail,
    isFlowResponsible,
    // Admin que también es firmante no ve historial (salvo que sea el creador/preparador).
    isSigner: Object.values(documents).some((doc) =>
      isOrionDocumentSigner(doc, currentUserEmail)
    ),
  });

  useEffect(() => {
    if (!registerOrionApi) return;

    const api: OrionSignatureApi = {
      enabled: true,
      documents,
      pendingAuthorizationByFile,
      canManage,
      canSignPermission,
      canFingerprintPermission,
      isFlowResponsible,
      permissionsReady,
      isAdmin,
      canViewVersions,
      hasSignature,
      acceptLoading,
      resolveForFile: (fileId: string) => {
        const fileState = documents[fileId] ?? {};
        const perms = resolveOrionPermissions({
          canManage,
          isAdmin,
          currentUserEmail,
          currentUserId,
          createdByEmail,
          requesterId,
          isFlowResponsible,
          state: fileState,
          hasAttachment: true,
          hasPersonalSignature: hasSignature,
          workflowLocked,
        });
        const me = normalizeEmail(currentUserEmail);
        return {
          state: fileState,
          permissions: perms,
          currentUserCompleted: me ? allSlotsCompletedForEmail(fileState.signers, me) : false,
        };
      },
      actions: {
        openConfigureSignature: () => {
          void loadUserSignature().then(() => setSignatureModalOpen(true));
        },
        openSignFlow: (file) => void handleAcceptSign(file),
        openViewDocument: openSignerView,
        openDocumentEditor: (file, options) => void openDocumentEditor(file, options),
        openSignedDocument,
      },
    };

    registerOrionApi(api);
    return () => registerOrionApi(null);
  }, [
    acceptLoading,
    canManage,
    canSignPermission,
    canFingerprintPermission,
    canViewVersions,
    currentUserEmail,
    currentUserId,
    createdByEmail,
    documents,
    handleAcceptSign,
    hasSignature,
    isAdmin,
    isFlowResponsible,
    openDocumentEditor,
    openSignedDocument,
    openSignerView,
    loadUserSignature,
    pendingAuthorizationByFile,
    permissionsReady,
    registerOrionApi,
    requesterId,
    workflowLocked,
  ]);

  const signatureFields = (state.signatureFields ?? []) as SignatureFieldPlacement[];
  const editorPdfSrc = activeFile?.pdfUrl ?? null;
  /** Editor de firmantes solo con intent explícito "manage" (nunca en flujo firmante / post-auth). */
  const useNativeEditor = Boolean(
    signerModalIntent === 'manage' &&
      hasDocument &&
      editorPdfSrc &&
      permissions.canManageWorkflow
  );
  const signOnlyMode =
    fromAuthorization ||
    signerModalIntent === 'view' ||
    signerModalIntent === 'sign' ||
    permissions.userRole === 'signer' ||
    permissions.userRole === 'waiting';
  const hasCompletedSigner = (state.signers ?? []).some((s) => isSignerCompleted(s.status));
  // Vista en modal: con firmas previas priorizar PDF acumulado (proxy Orion);
  // el original OneDrive queda como fallback si el firmado aún no está listo (409).
  const signerPdfOriginal = activeFile?.pdfUrl ?? null;
  // En modo firma: PDF sin sello/anotaciones (watermark=0&annotations=0) — el proxy
  // se ahorra pdf-lib y abre mucho más rápido; los overlays se ven aparte si hace falta.
  const signerPdfSigned = activeFile
    ? hasCompletedSigner
      ? resolveOrionPdfAccessUrl(state, activeFile.pdfUrl ?? null, {
          requestId,
          fileId: activeFile.fileId,
          light: Boolean(signOnlyMode),
        })
      : null
    : null;
  // Al firmar: priorizar el adjunto OneDrive (rápido). El firmado acumulado va de respaldo
  // para no dejar el visor en blanco mientras signed-file tarda.
  const signerPdfUrl =
    signOnlyMode
      ? signerPdfOriginal || signerPdfSigned
      : signerPdfSigned || signerPdfOriginal;
  const signerPdfFallback =
    signerPdfSigned &&
    signerPdfOriginal &&
    signerPdfSigned !== signerPdfOriginal
      ? signOnlyMode
        ? signerPdfSigned
        : signerPdfOriginal
      : null;

  // Silencia warning de pendingSigner no usado en host-only
  void getCurrentPendingSigner(state.signers);
  void participants;

  return (
    <>
      {(postAuthPreparing || (fromAuthorization && acceptLoading && !identityModalOpen && !signatureModalOpen && !documentModalOpen)) && (
        <Box
          role='status'
          aria-live='polite'
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'color-mix(in srgb, var(--mantine-color-body) 72%, transparent)',
            backdropFilter: 'blur(3px)',
            padding: 24,
          }}
        >
          <Card shadow='md' radius='md' withBorder p='xl' style={{ maxWidth: 420, width: '100%' }}>
            <Stack align='center' gap='md'>
              <Loader size='lg' />
              <Text fw={700} ta='center'>
                Preparando la firma…
              </Text>
              <Text size='sm' c='dimmed' ta='center'>
                Cargando el documento tras la autorización. Espere un momento.
              </Text>
            </Stack>
          </Card>
        </Box>
      )}
      <SignSuccessModal
        info={signSuccess}
        userName={currentUserName}
        requestTitle={requestTitle}
        onClose={() => setSignSuccess(null)}
      />

      {error && (
        <Alert color='red' mb='md' withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Modal
        opened={signatureModalOpen}
        onClose={() => {
          setSignatureModalOpen(false);
          if (padForTurnRef.current) {
            padForTurnRef.current = false;
            setIdentityModalOpen(true);
          }
        }}
        title='Dibuje o suba su firma'
        size='md'
        centered
        zIndex={430}
        overlayProps={{ blur: 4 }}
      >
        <SignaturePad
          initialImage={padForTurnRef.current ? turnSignature : signaturePreview}
          onSave={(dataUrl) => {
            if (padForTurnRef.current) {
              // Tras dibujar: firmar directo (sin volver al modal de revisar firma).
              padForTurnRef.current = false;
              setTurnSignature(dataUrl);
              setSignatureModalOpen(false);
              setIdentityError(null);
              void confirmSign(null, dataUrl);
              return;
            }
            void saveSignature(dataUrl);
          }}
          saving={signatureSaving}
        />
      </Modal>

      <Modal
        opened={identityModalOpen}
        onClose={() => {
          if (!signingBusy && !acceptLoading) {
            setIdentityModalOpen(false);
            setIdentityError(null);
          }
        }}
        title={
          activeFile?.fileName ? `Confirmar firma · ${activeFile.fileName}` : 'Confirmar firma'
        }
        size='md'
        centered
        zIndex={420}
        overlayProps={{ blur: 4 }}
      >
        <SignerTurnConfirm
          documentFileName={activeFile?.fileName || null}
          currentUserEmail={currentUserEmail}
          preview={signerPreview}
          previewLoading={signerPreviewLoading}
          drawnSignature={turnSignature}
          onDrawSignature={() => {
            padForTurnRef.current = true;
            setIdentityModalOpen(false);
            setSignatureModalOpen(true);
          }}
          onDiscardDrawnSignature={() => setTurnSignature(null)}
          requireFingerprint={mySigner?.requireFingerprint === true}
          canFingerprint={canFingerprintPermission}
          personHasSigningConsent={personHasSigningConsent}
          personHasBiometricConsent={personHasBiometricConsent}
          confirming={signingBusy || acceptLoading}
          externalError={identityError}
          fingerprintHelpUrl={fingerprintHelpUrl}
          onCancel={() => {
            if (!signingBusy && !acceptLoading) {
              setIdentityModalOpen(false);
              setIdentityError(null);
            }
          }}
          onConfirm={(confirmation) => void confirmSign(confirmation)}
        />
      </Modal>

      <Modal
        opened={returnModalOpen}
        onClose={() => {
          if (!returnLoading) {
            setReturnModalOpen(false);
            setReturnError(null);
          }
        }}
        title='Devolver documento'
        size='md'
        centered
        zIndex={420}
      >
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            El documento volverá a quien gestiona la firma para corrección. La cadena de firmas se reinicia.
          </Text>
          <Textarea
            label='Motivo'
            placeholder='Indique por qué devuelve el documento…'
            minRows={3}
            value={returnReason}
            onChange={(e) => {
              setReturnReason(e.currentTarget.value);
              if (returnError) setReturnError(null);
            }}
            disabled={returnLoading}
            required
          />
          {returnError && (
            <Alert color='red' variant='light'>
              {returnError}
            </Alert>
          )}
          <Group justify='flex-end'>
            <Button
              variant='default'
              disabled={returnLoading}
              onClick={() => {
                setReturnModalOpen(false);
                setReturnError(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              color='orange'
              leftSection={<IconArrowBackUp size={16} />}
              loading={returnLoading}
              onClick={() => void confirmReturnDocument()}
            >
              Confirmar devolución
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={documentModalOpen}
        onClose={() => setDocumentModalOpen(false)}
        title={
          signerModalIntent === 'manage' && permissions.canManageWorkflow
            ? `Preparar documento — ${activeFile?.fileName || 'PDF'}`
            : signerModalIntent === 'sign' || permissions.userRole === 'signer'
              ? 'Aceptar y firmar documento'
              : 'Documento'
        }
        size='100%'
        centered
        zIndex={300}
        trapFocus={!identityModalOpen && !signatureModalOpen && !returnModalOpen}
        padding='md'
        overlayProps={{ blur: 3, backgroundOpacity: 0.45 }}
        styles={{
          content: {
            maxWidth: 'min(1600px, 98vw)',
            width: '98vw',
            height: '96vh',
            maxHeight: '96vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--app-surface)',
          },
          header: {
            background: 'var(--app-surface)',
            borderBottom: '1px solid var(--app-border)',
            flexShrink: 0,
          },
          title: {
            fontWeight: 700,
            color: 'var(--app-text)',
          },
          body: {
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--app-surface)',
          },
        }}
      >
        {signOnlyMode &&
          signerModalIntent === 'sign' &&
          activeFile &&
          (currentUserCompleted || isTerminal) && (
          <Alert color='teal' variant='light' mb='md'>
            {currentUserCompleted
              ? 'Su firma ya está registrada en este documento. No es necesario confirmar de nuevo.'
              : 'Este documento ya está cerrado. No hay firma pendiente.'}
          </Alert>
        )}

        {signOnlyMode &&
          signerModalIntent === 'sign' &&
          activeFile &&
          !currentUserCompleted &&
          !isTerminal && (
          <Group justify='space-between' mb='md' align='center' wrap='wrap'>
            <Alert color='green' variant='light' style={{ flex: 1, minWidth: 220 }}>
              Revise el documento y pulse <strong>Firmar</strong>. Se usará su rúbrica guardada
              (o se le pedirá dibujarla si aún no tiene). Si el documento requiere corrección,
              puede <strong>devolverlo</strong> a quien gestiona la firma.
            </Alert>
            <Group gap='xs'>
              <Button
                variant='light'
                color='orange'
                leftSection={<IconArrowBackUp size={16} />}
                disabled={signingBusy || acceptLoading || returnLoading}
                onClick={() => {
                  setReturnReason('');
                  setReturnError(null);
                  setReturnModalOpen(true);
                }}
              >
                Devolver
              </Button>
              <Button
                color='green'
                leftSection={<IconCheck size={16} />}
                loading={signingBusy || acceptLoading}
                onClick={() => void confirmSign()}
              >
                Firmar
              </Button>
            </Group>
          </Group>
        )}

        {signerModalIntent === 'view' && activeFile && (
          <Group justify='space-between' mb='md' align='flex-start'>
            {permissions.userRole === 'waiting' ? (
              <Alert color='yellow' variant='light' style={{ flex: 1 }}>
                Puede revisar el documento. Aún no es su turno de firma; cuando el firmante anterior
                termine, podrá aceptar y firmar.
              </Alert>
            ) : (
              <>
                <Alert color='blue' variant='light' style={{ flex: 1 }}>
                  {hasSignature
                    ? 'Revise el documento. Al continuar firmará con su rúbrica guardada.'
                    : 'Revise el documento. Al continuar se le pedirá dibujar su rúbrica y firmar.'}
                </Alert>
                <Button
                  color='green'
                  leftSection={<IconCheck size={16} />}
                  loading={acceptLoading}
                  onClick={() =>
                    void proceedToAcceptSign(activeFile, {
                      skipAuthRedirect: fromAuthorization,
                    })
                  }
                >
                  {hasSignature ? 'Continuar a firmar' : 'Continuar'}
                </Button>
              </>
            )}
          </Group>
        )}

        {loading || uploading ? (
          <Group justify='center' py='xl' style={{ flex: 1 }}>
            <Loader />
            <Text size='sm' c='dimmed'>
              Preparando documento en GSS Firma…
            </Text>
          </Group>
        ) : useNativeEditor && state.orionDocumentId && activeFile ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <OrionDocumentEditor
            requestId={requestId}
            documentId={state.orionDocumentId}
            fileId={activeFile.fileId}
            pdfSrc={editorPdfSrc ?? null}
            documentTitle={requestTitle}
            fileName={activeFile.fileName}
            availableUsers={availableUsers}
            currentUserEmail={currentUserEmail}
            currentUserName={currentUserName}
            companyId={companyId}
            participants={participants.map((p) => ({
              ...p,
              signatureDataUrl:
                p.signatureDataUrl ??
                (normalizeEmail(p.email) === normalizeEmail(currentUserEmail)
                  ? signaturePreview
                  : null),
            }))}
            initialFields={signatureFields}
            state={state}
            onStateUpdate={(next) => applyFileState(activeFile.fileId, next)}
            onClose={() => setDocumentModalOpen(false)}
            assignmentsEditable={permissions.canEditAssignments}
            canUseFingerprint={canFingerprintPermission}
            initialStep={editorInitialStep}
            openNonce={editorOpenNonce}
          />
          </div>
        ) : signOnlyMode &&
          (signerModalIntent === 'view' || signerModalIntent === 'sign') &&
          (signerPdfUrl || signerPdfFallback) ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <PdfInlineViewer
              src={signerPdfUrl}
              fallbackSrc={signerPdfFallback}
              fileName={activeFile?.fileName ?? 'Documento.pdf'}
              minHeight={520}
            />
          </div>
        ) : signerModalIntent === 'manage' && documentIframeSrc ? (
          <iframe
            title='Editor GSS Firma'
            src={documentIframeSrc}
            style={{
              flex: 1,
              width: '100%',
              minHeight: '55vh',
              maxHeight: '70vh',
              border: '1px solid var(--app-border)',
              borderRadius: 8,
              background: 'var(--app-surface-raised)',
            }}
          />
        ) : signerModalIntent === 'manage' && activeFile && !hasDocument ? (
          <Stack gap='md' style={{ flex: 1, minHeight: 0 }}>
            <Alert color='red' variant='light' title='No se pudo preparar el documento'>
              {error ||
                'GSS Firma (Orion) no está disponible. Inicie el servicio Orion (ORION_API_BASE_URL) y pulse Reintentar.'}
            </Alert>
            <Group>
              <Button
                loading={loading || uploading}
                onClick={() => void openDocumentEditor(activeFile)}
              >
                Reintentar preparación
              </Button>
            </Group>
            {activeFile.pdfUrl ? (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <PdfInlineViewer
                  src={activeFile.pdfUrl}
                  fileName={activeFile.fileName}
                  minHeight={280}
                />
              </div>
            ) : null}
          </Stack>
        ) : activeFile?.pdfUrl && !hasDocument ? (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <PdfInlineViewer
              src={activeFile.pdfUrl}
              fileName={activeFile.fileName}
              minHeight={280}
            />
          </div>
        ) : (
          <Stack align='center' justify='center' style={{ flex: 1 }} gap='md'>
            <ThemeIcon size={48} radius='xl' variant='light'>
              <IconFileText size={24} />
            </ThemeIcon>
            <Text size='sm' c='dimmed' ta='center'>
              Use Gestionar en Archivos adjuntos para orquestar la firma de cada PDF.
            </Text>
          </Stack>
        )}
      </Modal>
    </>
  );
}
