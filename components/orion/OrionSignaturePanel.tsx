'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
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
import { resolveOrionPdfAccessUrl } from '../../lib/orion/signedFileAccess';
import { allSlotsCompletedForEmail, getCurrentPendingSigner, isSignerCompleted } from '../../lib/orion/signerStatus';
import { resolveOrionPermissions } from '../../lib/orion/permissions';
import SignaturePad from './SignaturePad';
import PdfInlineViewer from './PdfInlineViewer';
import OrionDocumentEditor from './OrionDocumentEditor';
import SignerIdentityForm from './SignerIdentityForm';
import type { SignerAcceptIdentity } from '../../lib/orion/signerIdentity';
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
  const [hasSignature, setHasSignature] = useState(false);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [canManage, setCanManage] = useState(false);
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

  const [resolvedEmbedOrigin, setResolvedEmbedOrigin] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [pendingAuthorizationByFile, setPendingAuthorizationByFile] = useState<
    Record<string, boolean>
  >({});
  const [signerModalIntent, setSignerModalIntent] = useState<'view' | 'sign' | 'manage'>('view');
  const [signSuccessMessage, setSignSuccessMessage] = useState<string | null>(null);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userRoleRef = useRef<'coordinator' | 'signer' | 'waiting' | 'viewer'>('viewer');
  const mountedRef = useRef(false);
  const autoOpenedRef = useRef(false);
  const lastNotifyKeyRef = useRef('');
  const lastPatchKeyRef = useRef('');
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableEmbedSrcRef = useRef<string | null>(null);
  /** Tras dibujar rúbrica, abrir el modal de firma del documento */
  const continueToSignAfterPadRef = useRef(false);
  /** Primer GET ensure-document terminó (canManage ya es fiable). */
  const [permissionsReady, setPermissionsReady] = useState(false);

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
    if (mountedRef.current) return;
    if (!isValidRequestId) {
      setPermissionsReady(true);
      return;
    }
    mountedRef.current = true;
    // Solo lite al montar (BD, ms). Soft Orion se difiere / se hace con fileId al firmar.
    void refreshState(undefined, { lite: true, markReady: true });
    const softTimer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      // Soft liviano: sin fileId el API ya no llama Orion (solo BD + pending auth).
      void refreshState(undefined, { soft: true });
    }, 2500);
    return () => window.clearTimeout(softTimer);
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

  const statusUpper = String(state.status || '').toUpperCase();
  const hasDocument = Boolean(state.orionDocumentId && state.embedUrl);
  const isTerminal = statusUpper === 'FIRMADO' || statusUpper === 'RECHAZADO';
  const isMyTurn = permissions.isMyTurn;

  const confirmSign = useCallback(
    async (identity?: SignerAcceptIdentity | null) => {
      const file = activeFile ?? activeFileRef.current;
      if (!file) {
        setIdentityError(
          'No hay documento activo para firmar. Cierre el modal e intente de nuevo desde Firmar.'
        );
        return false;
      }
      setAcceptLoading(true);
      setIdentityError(null);
      setError(null);
      try {
        // Solo reenviar rúbrica si Orion aún no la tiene (evita payload grande).
        const includeRubric =
          !hasSignature && Boolean(signaturePreview?.startsWith('data:image/'));
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
              ...(includeRubric ? { signatureDataUrl: signaturePreview } : {}),
              ...(identity
                ? {
                    fullName: identity.fullName,
                    idDocumentType: identity.idDocumentType,
                    idNumber: identity.idNumber,
                    companySlug: identity.companySlug,
                    companyName: identity.companyName,
                    companyNit: identity.companyNit,
                    jobTitle: identity.jobTitle,
                  }
                : {}),
            }),
          });
        } finally {
          clearTimeout(timeoutId);
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = String(data.error || `No se pudo confirmar la firma (${res.status})`);
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
          setIdentityModalOpen(false);
          setIdentityError(null);
          setSignSuccessMessage(data.message || 'Documento firmado correctamente.');
          setDocumentModalOpen(false);
          setSignerModalIntent('view');
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
        setAcceptLoading(false);
      }
    },
    [activeFile, applyFileState, hasSignature, notifyDocuments, requestId, signaturePreview]
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
      setSignSuccessMessage(
        data.message || 'Documento devuelto para corrección.'
      );
    } catch {
      const msg = 'Error de conexión al devolver el documento.';
      setReturnError(msg);
      setError(msg);
    } finally {
      setReturnLoading(false);
    }
  }, [activeFile, applyFileState, notifyDocuments, requestId, returnReason]);

  const openDocumentEditor = useCallback(
    async (file: OrionFileMeta) => {
      setError(null);
      setActiveFile(file);
      setSignerModalIntent('manage');
      stableEmbedSrcRef.current = null;

      const fileState = documents[file.fileId] ?? {};
      const filePerms = resolveOrionPermissions({
        canManage,
        isAdmin,
        currentUserEmail,
        currentUserId,
        createdByEmail,
        requesterId,
        state: fileState,
        hasAttachment: true,
        hasPersonalSignature: hasSignature,
        workflowLocked,
      });

      if (!filePerms.canManageWorkflow) {
        setError('Solo el creador de la solicitud puede configurar la firma del documento.');
        return false;
      }

      setDocumentModalOpen(true);
      // Preferir OneDrive / original; signed-file solo si no hay URL directa.
      const previewUrl =
        (isLikelyPdfFetchUrl(file.pdfUrl) ? file.pdfUrl : null) ||
        (fileState.originalFileUrl && isLikelyPdfFetchUrl(fileState.originalFileUrl)
          ? fileState.originalFileUrl
          : null) ||
        (fileState.orionDocumentId
          ? `/api/integrations/orion/signed-file?requestId=${requestId}&fileId=${encodeURIComponent(file.fileId)}&versionId=original`
          : null) ||
        file.pdfUrl;

      // Abrir modal ya; rúbrica en paralelo (no bloquear preview).
      const rubricPromise = loadUserSignature();

      if (fileState.orionDocumentId && fileState.embedUrl) {
        setActiveFile({ ...file, pdfUrl: previewUrl || file.pdfUrl });
        const hasRubric = await rubricPromise;
        if (!hasRubric && filePerms.canDrawSignature) {
          setSignatureModalOpen(true);
          return false;
        }
        return true;
      }
      setUploading(true);
      try {
        if (isLikelyPdfFetchUrl(file.pdfUrl)) {
          void fetchUrlAsBase64(file.pdfUrl)
            .then((pdfBase64) => {
              setActiveFile((prev) =>
                prev?.fileId === file.fileId
                  ? { ...prev, pdfUrl: `data:application/pdf;base64,${pdfBase64}` }
                  : prev
              );
            })
            .catch(() => {
              /* preview opcional */
            });
        }
        const [hasRubric, ok] = await Promise.all([
          rubricPromise,
          ensureDocument({
            ...file,
            pdfUrl: file.pdfUrl,
          }),
        ]);
        if (!hasRubric && filePerms.canDrawSignature) {
          setSignatureModalOpen(true);
        }
        if (previewUrl) {
          setActiveFile((prev) =>
            prev?.fileId === file.fileId ? { ...prev, pdfUrl: previewUrl } : prev
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
      loadUserSignature,
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
      setActiveFile(file);
      setAcceptLoading(true);
      setError(null);
      const skipAuthRedirect = Boolean(opts?.skipAuthRedirect || fromAuthorization);
      try {
        const qs = new URLSearchParams({
          requestId: String(requestId),
          fileId: file.fileId,
          soft: '1',
        });
        const [hasRubric, ensureRes] = await Promise.all([
          loadUserSignature(),
          fetch(`/api/integrations/orion/ensure-document?${qs}`),
        ]);
        const data = await ensureRes.json().catch(() => ({}));
        const res = ensureRes;
        if (res.ok) {
          if (data.documents) {
            notifyDocuments(data.documents as Record<string, OrionSignatureState>);
          } else if (data.state) {
            applyFileState(file.fileId, data.state as OrionSignatureState);
          }
          if (
            data.pendingAuthorizationByFile &&
            typeof data.pendingAuthorizationByFile === 'object'
          ) {
            setPendingAuthorizationByFile((prev) => ({
              ...prev,
              ...(data.pendingAuthorizationByFile as Record<string, boolean>),
            }));
          } else if (typeof data.pendingAuthorization === 'boolean') {
            setPendingAuthorizationByFile((prev) => ({
              ...prev,
              [file.fileId]: data.pendingAuthorization,
            }));
          }

          // Si hay auth FIRMA pendiente y es su turno: cerrarla aquí y seguir a firmar
          // (no mandar al coordinador/firmante a /process/authorization "a sí mismo").
          if (data.pendingAuthorization) {
            try {
              const consumeRes = await fetch('/api/integrations/orion/consume-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  requestId,
                  fileId: file.fileId,
                }),
              });
              if (consumeRes.ok) {
                setPendingAuthorizationByFile((prev) => ({
                  ...prev,
                  [file.fileId]: false,
                }));
              } else if (!skipAuthRedirect) {
                setError(
                  'Debe autorizar la firma en Autorizaciones antes de ver y firmar el documento.'
                );
                window.location.href = '/process/authorization';
                return;
              }
            } catch {
              if (!skipAuthRedirect) {
                window.location.href = '/process/authorization';
                return;
              }
            }
          }
        }

        if (!hasRubric) {
          continueToSignAfterPadRef.current = true;
          setSignerModalIntent('sign');
          setSignatureModalOpen(true);
          return;
        }

        const fileState =
          (data.state as OrionSignatureState | undefined) ?? documents[file.fileId] ?? {};
        const filePerms = resolveOrionPermissions({
          canManage,
          isAdmin,
          currentUserEmail,
          currentUserId,
          createdByEmail,
          requesterId,
          state: fileState,
          hasAttachment: true,
          hasPersonalSignature: true,
          workflowLocked,
        });
        if (filePerms.userRole === 'waiting') {
          setSignerModalIntent('view');
          setDocumentModalOpen(true);
          setError('Aún no es su turno de firma. Espere a que firme el responsable anterior.');
          return;
        }

        setSignerModalIntent('sign');
        setDocumentModalOpen(true);
      } finally {
        setAcceptLoading(false);
      }
    },
    [
      applyFileState,
      canManage,
      createdByEmail,
      currentUserEmail,
      currentUserId,
      documents,
      fromAuthorization,
      isAdmin,
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

  // Deep-link post-auth / desde tarea / tras crear FIRMA
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!autoOpenFileId || !autoOpenAction || !autoOpenPdfUrl) return;
    // Gestionar requiere canManage; el primer ensure-document puede tardar varios segundos.
    if (autoOpenAction === 'manage') {
      if (!permissionsReady) return;
      if (!canManage) {
        autoOpenedRef.current = true;
        setError('Solo el creador de la solicitud puede configurar la firma del documento.');
        return;
      }
    }
    autoOpenedRef.current = true;
    const meta: OrionFileMeta = {
      fileId: autoOpenFileId,
      fileName: autoOpenFileName || 'Documento.pdf',
      pdfUrl: autoOpenPdfUrl,
    };
    // Pequeño delay solo si hace falta estabilizar el listado OneDrive
    const t = window.setTimeout(() => {
      if (autoOpenAction === 'manage') {
        void openDocumentEditor(meta);
      } else if (autoOpenAction === 'sign') {
        void handleAcceptSign(meta);
      } else {
        openSignerView(meta);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [
    autoOpenAction,
    autoOpenFileId,
    autoOpenFileName,
    autoOpenPdfUrl,
    canManage,
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

  useEffect(() => {
    if (!registerOrionApi) return;

    const api: OrionSignatureApi = {
      enabled: true,
      documents,
      pendingAuthorizationByFile,
      canManage,
      isAdmin,
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
        openDocumentEditor: (file) => void openDocumentEditor(file),
        openSignedDocument,
      },
    };

    registerOrionApi(api);
    return () => registerOrionApi(null);
  }, [
    acceptLoading,
    canManage,
    currentUserEmail,
    documents,
    handleAcceptSign,
    hasSignature,
    isAdmin,
    openDocumentEditor,
    openSignedDocument,
    openSignerView,
    loadUserSignature,
    pendingAuthorizationByFile,
    registerOrionApi,
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
  // Vista en modal: siempre priorizar el adjunto original (OneDrive downloadUrl).
  // El proxy signed-file solo cuando ya hay firmas y como intento secundario.
  const signerPdfFallback = activeFile?.pdfUrl ?? null;
  const signerPdfUrl = activeFile
    ? hasCompletedSigner
      ? resolveOrionPdfAccessUrl(state, activeFile.pdfUrl ?? null, {
          requestId,
          fileId: activeFile.fileId,
        }) || activeFile.pdfUrl
      : activeFile.pdfUrl || null
    : null;

  // Silencia warning de pendingSigner no usado en host-only
  void getCurrentPendingSigner(state.signers);
  void participants;

  return (
    <>
      {signSuccessMessage && (
        <Alert
          color='green'
          variant='light'
          mb='md'
          withCloseButton
          onClose={() => setSignSuccessMessage(null)}
          icon={<IconCheck size={16} />}
        >
          {signSuccessMessage}
        </Alert>
      )}

      {error && (
        <Alert color='red' mb='md' withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Modal
        opened={signatureModalOpen}
        onClose={() => setSignatureModalOpen(false)}
        title='Dibuje su firma'
        size='md'
        centered
        zIndex={400}
        overlayProps={{ blur: 4 }}
      >
        <SignaturePad
          initialImage={signaturePreview}
          onSave={(dataUrl) => void saveSignature(dataUrl)}
          saving={signatureSaving}
        />
      </Modal>

      <Modal
        opened={identityModalOpen}
        onClose={() => {
          if (!acceptLoading) {
            setIdentityModalOpen(false);
            setIdentityError(null);
          }
        }}
        title='Confirmar identidad'
        size='md'
        centered
        zIndex={420}
        overlayProps={{ blur: 4 }}
      >
        <SignerIdentityForm
          defaultName={currentUserName || mySigner?.name || null}
          currentUserEmail={currentUserEmail}
          confirming={acceptLoading}
          externalError={identityError}
          onCancel={() => {
            if (!acceptLoading) {
              setIdentityModalOpen(false);
              setIdentityError(null);
            }
          }}
          onConfirm={(identity) => void confirmSign(identity)}
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
        size='xl'
        centered
        zIndex={300}
        trapFocus={!identityModalOpen && !signatureModalOpen && !returnModalOpen}
        padding='lg'
        overlayProps={{ blur: 3, backgroundOpacity: 0.45 }}
        styles={{
          content: {
            maxWidth: 1100,
            width: '96vw',
            maxHeight: '92vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--app-surface)',
          },
          header: {
            background: 'var(--app-surface)',
            borderBottom: '1px solid var(--app-border)',
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
            overflow: 'auto',
            background: 'var(--app-surface)',
          },
        }}
      >
        {signOnlyMode && signerModalIntent === 'sign' && activeFile && (
          <Group justify='space-between' mb='md' align='center' wrap='wrap'>
            <Alert color='green' variant='light' style={{ flex: 1, minWidth: 220 }}>
              Revise el documento y pulse <strong>Confirmar firma</strong>. Se le pedirán sus
              datos de identidad (nombre, tipo y número de documento) y quedará registrada su
              firma. Si el documento requiere corrección, puede <strong>devolverlo</strong> a quien
              gestiona la firma.
            </Alert>
            <Group gap='xs'>
              <Button
                variant='light'
                color='orange'
                leftSection={<IconArrowBackUp size={16} />}
                disabled={acceptLoading || returnLoading}
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
                loading={acceptLoading}
                onClick={() => {
                  setIdentityError(null);
                  setIdentityModalOpen(true);
                }}
              >
                Confirmar firma
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
          />
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
              src={
                // Primero el original del adjunto (embebe bien); firmado solo si es distinto.
                signerPdfFallback &&
                (!signerPdfUrl ||
                  signerPdfUrl.includes('/api/integrations/orion/signed-file'))
                  ? signerPdfFallback
                  : signerPdfUrl || signerPdfFallback
              }
              fallbackSrc={
                signerPdfUrl &&
                signerPdfFallback &&
                signerPdfUrl !== signerPdfFallback
                  ? signerPdfUrl.includes('/api/integrations/orion/signed-file')
                    ? signerPdfFallback
                    : signerPdfUrl
                  : null
              }
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
