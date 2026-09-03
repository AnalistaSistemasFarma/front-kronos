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
  ThemeIcon,
} from '@mantine/core';
import { IconCheck, IconFileText } from '@tabler/icons-react';
import type { OrionPostMessage, OrionSignatureState } from '../../lib/orion/types';
import type { OrionParticipant, OrionUserOption } from '../../lib/orion/participants';
import type { SignatureFieldPlacement } from '../../lib/orion/signatureFields';
import { resolveOrionPdfAccessUrl } from '../../lib/orion/signedFileAccess';
import { getCurrentPendingSigner, isSignerCompleted } from '../../lib/orion/signerStatus';
import { resolveOrionPermissions } from '../../lib/orion/permissions';
import SignaturePad from './SignaturePad';
import PdfInlineViewer from './PdfInlineViewer';
import OrionDocumentEditor from './OrionDocumentEditor';
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
  currentUserEmail?: string;
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

async function fetchUrlAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo leer el archivo adjunto');
  const blob = await res.blob();
  return fileToBase64(new File([blob], 'documento.pdf', { type: blob.type || 'application/pdf' }));
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
  currentUserEmail,
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
  const [resolvedEmbedOrigin, setResolvedEmbedOrigin] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [pendingAuthorizationByFile, setPendingAuthorizationByFile] = useState<
    Record<string, boolean>
  >({});
  const [signerModalIntent, setSignerModalIntent] = useState<'view' | 'sign' | 'manage'>('view');
  const [signSuccessMessage, setSignSuccessMessage] = useState<string | null>(null);
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

  const loadUserSignature = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/orion/signature-embed');
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setHasSignature(Boolean(data.hasSignature));
        setSignaturePreview(data.dataUrl ?? null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const refreshState = useCallback(
    async (fileId?: string) => {
      try {
        const qs = new URLSearchParams({ requestId: String(requestId) });
        if (fileId) qs.set('fileId', fileId);
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
        if (fileId && typeof data.pendingAuthorization === 'boolean') {
          setPendingAuthorizationByFile((prev) => ({
            ...prev,
            [fileId]: data.pendingAuthorization,
          }));
        }
      } catch {
        /* polling silencioso */
      }
    },
    [applyFileState, notifyDocuments, requestId]
  );

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void loadUserSignature();
    void refreshState();
  }, [loadUserSignature, refreshState]);

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
        // Si el estado vivo ya tiene documento Orion, no degradar con el bag
        if (current.orionDocumentId) continue;

        next[fileId] = {
          ...incomingDoc,
          ...current,
          fileId,
          orionDocumentId: current.orionDocumentId || incomingDoc.orionDocumentId,
          status: current.status || incomingDoc.status,
          signers:
            (current.signers?.length ?? 0) > 0 ? current.signers : incomingDoc.signers,
          embedUrl: current.embedUrl || incomingDoc.embedUrl,
          signedFileUrl: current.signedFileUrl || incomingDoc.signedFileUrl,
          versions:
            (current.versions?.length ?? 0) > 0 ? current.versions : incomingDoc.versions,
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [initialDocuments, initialState]);

  // Cargar pendingAuthorization por cada documento conocido (solo cuando cambian los fileIds)
  const documentIdsKey = Object.keys(documents).sort().join('|');
  useEffect(() => {
    const ids = documentIdsKey ? documentIdsKey.split('|').filter(Boolean) : [];
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, boolean> = {};
      await Promise.all(
        ids.map(async (fileId) => {
          try {
            const qs = new URLSearchParams({
              requestId: String(requestId),
              fileId,
            });
            const res = await fetch(`/api/integrations/orion/ensure-document?${qs}`);
            const data = await res.json().catch(() => ({}));
            if (res.ok && typeof data.pendingAuthorization === 'boolean') {
              next[fileId] = data.pendingAuthorization;
            }
          } catch {
            /* ignore */
          }
        })
      );
      if (!cancelled) {
        setPendingAuthorizationByFile((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentIdsKey, requestId]);

  const ensureDocument = useCallback(
    async (file: OrionFileMeta, pdfBase64?: string) => {
      setLoading(true);
      setError(null);
      try {
        const current = documents[file.fileId];
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
            refresh: !pdfBase64 && Boolean(current?.orionDocumentId),
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
        state,
        hasAttachment: Boolean(activeFile?.pdfUrl),
        hasPersonalSignature: hasSignature,
        workflowLocked,
      }),
    [activeFile?.pdfUrl, canManage, currentUserEmail, hasSignature, isAdmin, state, workflowLocked]
  );

  userRoleRef.current = permissions.userRole;

  const mySigner = useMemo(() => {
    const me = normalizeEmail(currentUserEmail);
    if (!me || !state.signers?.length) return null;
    return state.signers.find((s) => normalizeEmail(s.email) === me) ?? null;
  }, [currentUserEmail, state.signers]);

  const statusUpper = String(state.status || '').toUpperCase();
  const hasDocument = Boolean(state.orionDocumentId && state.embedUrl);
  const isTerminal = statusUpper === 'FIRMADO' || statusUpper === 'RECHAZADO';
  const isMyTurn = permissions.isMyTurn;

  const confirmSign = useCallback(async () => {
    if (!activeFile) return false;
    setAcceptLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/orion/complete-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId: activeFile.fileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data.error || 'No se pudo confirmar la firma'));
        return false;
      }
      if (data.documents) {
        notifyDocuments(data.documents as Record<string, OrionSignatureState>);
      } else if (data.state) {
        applyFileState(activeFile.fileId, data.state as OrionSignatureState);
      }
      if (data.signerCompleted) {
        setSignSuccessMessage(
          data.message || 'Documento firmado correctamente.'
        );
        setDocumentModalOpen(false);
        setSignerModalIntent('view');
        return true;
      }
      setError(
        String(
          data.message ||
            'No se pudo registrar la firma. Verifique su rúbrica e intente de nuevo.'
        )
      );
      return false;
    } catch {
      setError('Error de conexión al confirmar la firma.');
      return false;
    } finally {
      setAcceptLoading(false);
    }
  }, [activeFile, applyFileState, notifyDocuments, requestId]);

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
        state: fileState,
        hasAttachment: true,
        hasPersonalSignature: hasSignature,
        workflowLocked,
      });

      if (!filePerms.canManageWorkflow) {
        setError('Solo el coordinador puede configurar el documento.');
        return;
      }
      if (!hasSignature && filePerms.canDrawSignature) {
        setSignatureModalOpen(true);
        return;
      }

      setDocumentModalOpen(true);
      if (fileState.orionDocumentId && fileState.embedUrl) {
        await ensureDocument(file);
        return;
      }
      setUploading(true);
      try {
        const pdfBase64 = await fetchUrlAsBase64(file.pdfUrl);
        await ensureDocument(file, pdfBase64);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo usar el archivo adjunto');
      } finally {
        setUploading(false);
      }
    },
    [
      canManage,
      currentUserEmail,
      documents,
      ensureDocument,
      hasSignature,
      isAdmin,
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
        });
        const res = await fetch(`/api/integrations/orion/ensure-document?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (data.documents) {
            notifyDocuments(data.documents as Record<string, OrionSignatureState>);
          } else if (data.state) {
            applyFileState(file.fileId, data.state as OrionSignatureState);
          }
          if (typeof data.pendingAuthorization === 'boolean') {
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

        if (!hasSignature) {
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
      currentUserEmail,
      documents,
      fromAuthorization,
      hasSignature,
      isAdmin,
      notifyDocuments,
      requestId,
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
    [activeFile, canManage, fromAuthorization, openDocumentEditor]
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
      pollRef.current = setInterval(() => void refreshState(activeFile?.fileId), 20000);
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

  // Deep-link post-auth / desde tarea
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!autoOpenFileId || !autoOpenAction || !autoOpenPdfUrl) return;
    autoOpenedRef.current = true;
    const meta: OrionFileMeta = {
      fileId: autoOpenFileId,
      fileName: autoOpenFileName || 'Documento.pdf',
      pdfUrl: autoOpenPdfUrl,
    };
    if (autoOpenAction === 'manage') {
      void openDocumentEditor(meta);
    } else if (autoOpenAction === 'sign') {
      void handleAcceptSign(meta);
    } else {
      openSignerView(meta);
    }
  }, [
    autoOpenAction,
    autoOpenFileId,
    autoOpenFileName,
    autoOpenPdfUrl,
    handleAcceptSign,
    openDocumentEditor,
    openSignerView,
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
          state: fileState,
          hasAttachment: true,
          hasPersonalSignature: hasSignature,
          workflowLocked,
        });
        const me = normalizeEmail(currentUserEmail);
        const mine = fileState.signers?.find((s) => normalizeEmail(s.email) === me);
        return {
          state: fileState,
          permissions: perms,
          currentUserCompleted: Boolean(mine && isSignerCompleted(mine.status)),
        };
      },
      actions: {
        openConfigureSignature: () => setSignatureModalOpen(true),
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
  const signerPdfUrl = activeFile
    ? resolveOrionPdfAccessUrl(state, activeFile.pdfUrl ?? null, {
        requestId,
        fileId: activeFile.fileId,
      })
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
        overlayProps={{ blur: 4 }}
      >
        <SignaturePad
          initialImage={signaturePreview}
          onSave={(dataUrl) => void saveSignature(dataUrl)}
          saving={signatureSaving}
        />
      </Modal>

      <Modal
        opened={documentModalOpen}
        onClose={() => setDocumentModalOpen(false)}
        title={
          signerModalIntent === 'manage' && permissions.canManageWorkflow
            ? `Gestionar: ${activeFile?.fileName || 'documento'}`
            : signerModalIntent === 'sign' || permissions.userRole === 'signer'
              ? 'Aceptar y firmar documento'
              : 'Documento'
        }
        size='xl'
        centered
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
          <Group justify='space-between' mb='md' align='center'>
            <Alert color='green' variant='light' style={{ flex: 1 }}>
              Revise el documento y pulse <strong>Confirmar firma</strong> una sola vez. Con eso
              queda registrada su firma y el turno pasa al siguiente responsable.
            </Alert>
            <Button
              color='green'
              leftSection={<IconCheck size={16} />}
              loading={acceptLoading}
              onClick={() => void confirmSign()}
            >
              Confirmar firma
            </Button>
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
        ) : signOnlyMode && (signerModalIntent === 'view' || signerModalIntent === 'sign') && signerPdfUrl ? (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <PdfInlineViewer
              src={signerPdfUrl}
              fileName={activeFile?.fileName ?? 'Documento.pdf'}
              minHeight={320}
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
