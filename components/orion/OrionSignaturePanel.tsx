'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  FileButton,
  Group,
  Loader,
  Modal,
  Stack,
  Stepper,
  Table,
  Text,
  ThemeIcon,
} from '@mantine/core';
import {
  IconCheck,
  IconEdit,
  IconFileText,
  IconPencil,
  IconRefresh,
  IconSignature,
  IconUpload,
  IconUserCircle,
} from '@tabler/icons-react';
import type { OrionPostMessage, OrionSignatureState, OrionSignerState } from '../../lib/orion/types';
import type { OrionParticipant, OrionUserOption } from '../../lib/orion/participants';
import type { SignatureFieldPlacement } from '../../lib/orion/signatureFields';
import SignaturePad from './SignaturePad';
import PdfInlineViewer from './PdfInlineViewer';
import OrionSignersList from './OrionSignersList';
import OrionDocumentEditor from './OrionDocumentEditor';

type Props = {
  requestId: number;
  requestTitle?: string;
  initialState?: OrionSignatureState | null;
  createdByEmail?: string;
  currentUserEmail?: string;
  attachmentPdfUrl?: string | null;
  attachmentFileName?: string | null;
  participants?: OrionParticipant[];
  availableUsers?: OrionUserOption[];
  currentUserName?: string;
  onStateChange?: (state: OrionSignatureState) => void;
};

function statusColor(status?: string | null): string {
  switch (String(status || '').toUpperCase()) {
    case 'FIRMADO':
      return 'green';
    case 'RECHAZADO':
      return 'red';
    case 'EN_PROCESO':
    case 'PENDIENTE_FIRMA':
      return 'blue';
    default:
      return 'gray';
  }
}

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function signerPending(signer: OrionSignerState): boolean {
  const st = String(signer.status || '').toUpperCase();
  return !['FIRMADO', 'SIGNED', 'COMPLETED', 'RECHAZADO', 'REJECTED'].includes(st);
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

export default function OrionSignaturePanel({
  requestId,
  requestTitle,
  initialState,
  createdByEmail,
  currentUserEmail,
  attachmentPdfUrl,
  attachmentFileName,
  participants = [],
  availableUsers = [],
  currentUserName,
  onStateChange,
}: Props) {
  const [activeSignerOrder, setActiveSignerOrder] = useState(1);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [documentModalOpen, setDocumentModalOpen] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [signatureLoading, setSignatureLoading] = useState(true);

  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<OrionSignatureState>(initialState ?? {});
  const [resolvedEmbedOrigin, setResolvedEmbedOrigin] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(false);
  const lastNotifyKeyRef = useRef('');
  const lastPatchKeyRef = useRef('');
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialStateKeyRef = useRef('');
  const stableEmbedSrcRef = useRef<string | null>(null);

  const stateNotifyKey = useCallback((value: OrionSignatureState) => {
    return JSON.stringify({
      id: value.orionDocumentId ?? null,
      status: value.status ?? null,
      signed: value.signedFileUrl ?? null,
      signers: (value.signers ?? []).map((s) => `${s.email}:${s.status}`).join('|'),
    });
  }, []);

  useEffect(() => {
    const nextKey = JSON.stringify(initialState ?? {});
    if (nextKey === initialStateKeyRef.current) return;
    initialStateKeyRef.current = nextKey;
    setState(initialState ?? {});
    lastNotifyKeyRef.current = stateNotifyKey(initialState ?? {});
  }, [initialState, stateNotifyKey]);

  const applyState = useCallback(
    (next: OrionSignatureState) => {
      const nextKey = stateNotifyKey(next);
      if (nextKey !== lastNotifyKeyRef.current) {
        lastNotifyKeyRef.current = nextKey;
        onStateChange?.(next);
      }
      setState(next);
    },
    [onStateChange, stateNotifyKey]
  );

  const loadUserSignature = useCallback(async () => {
    setSignatureLoading(true);
    try {
      const res = await fetch('/api/integrations/orion/signature-embed');
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setHasSignature(Boolean(data.hasSignature));
        setSignaturePreview(data.dataUrl ?? null);
      }
    } catch {
      /* ignore */
    } finally {
      setSignatureLoading(false);
    }
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const res = await fetch(`/api/integrations/orion/ensure-document?requestId=${requestId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.state) {
        if (data.embedOrigin) setResolvedEmbedOrigin(data.embedOrigin);
        if (typeof data.canManage === 'boolean') setCanManage(data.canManage);
        applyState(data.state as OrionSignatureState);
      }
    } catch {
      /* polling silencioso */
    }
  }, [applyState, requestId]);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void loadUserSignature();
    void refreshState();
  }, [loadUserSignature, refreshState, requestId]);

  const ensureDocument = useCallback(
    async (pdfBase64?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/integrations/orion/ensure-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            title: requestTitle,
            createdByEmail,
            pdfBase64,
            refresh: !pdfBase64 && Boolean(state.orionDocumentId),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo preparar el documento');
        if (data.embedOrigin) setResolvedEmbedOrigin(data.embedOrigin);
        if (data.state?.embedUrl) stableEmbedSrcRef.current = data.state.embedUrl;
        applyState(data.state as OrionSignatureState);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al conectar con el motor de firma');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [applyState, createdByEmail, requestId, requestTitle, state.orionDocumentId]
  );

  const statusUpper = String(state.status || '').toUpperCase();
  const hasDocument = Boolean(state.orionDocumentId && state.embedUrl);
  const isTerminal = statusUpper === 'FIRMADO' || statusUpper === 'RECHAZADO';

  const openDocumentEditor = useCallback(async () => {
    setError(null);
    if (!hasSignature) {
      setSignatureModalOpen(true);
      return;
    }
    setDocumentModalOpen(true);
    if (hasDocument) {
      await ensureDocument();
      return;
    }
    if (attachmentPdfUrl) {
      setUploading(true);
      try {
        const pdfBase64 = await fetchUrlAsBase64(attachmentPdfUrl);
        await ensureDocument(pdfBase64);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo usar el archivo adjunto');
      } finally {
        setUploading(false);
      }
    }
  }, [attachmentPdfUrl, ensureDocument, hasDocument, hasSignature]);

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
        if (canManage || attachmentPdfUrl) {
          setDocumentModalOpen(true);
          if (!hasDocument && attachmentPdfUrl) {
            setUploading(true);
            try {
              const pdfBase64 = await fetchUrlAsBase64(attachmentPdfUrl);
              await ensureDocument(pdfBase64);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'No se pudo preparar el documento');
            } finally {
              setUploading(false);
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al guardar la firma');
      } finally {
        setSignatureSaving(false);
      }
    },
    [attachmentPdfUrl, canManage, ensureDocument, hasDocument]
  );

  const useAttachmentForSigning = useCallback(async () => {
    if (!attachmentPdfUrl) return;
    setUploading(true);
    setError(null);
    try {
      const pdfBase64 = await fetchUrlAsBase64(attachmentPdfUrl);
      await ensureDocument(pdfBase64);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo usar el archivo adjunto');
    } finally {
      setUploading(false);
    }
  }, [attachmentPdfUrl, ensureDocument]);

  const handleUploadAndCreate = useCallback(async () => {
    if (!pdfFile) {
      setError('Seleccione un archivo PDF');
      return;
    }
    setUploading(true);
    try {
      const pdfBase64 = await fileToBase64(pdfFile);
      const ok = await ensureDocument(pdfBase64);
      if (ok) setPdfFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al leer el PDF');
    } finally {
      setUploading(false);
    }
  }, [ensureDocument, pdfFile]);

  const patchFromPostMessage = useCallback(
    (message: OrionPostMessage) => {
      const patch: OrionSignatureState = {
        orionDocumentId: message.orionDocumentId,
        status: message.status ?? message.payload?.status,
        embedUrl: state.embedUrl ?? message.payload?.embedUrl,
        signedFileUrl: message.payload?.signedFileUrl ?? state.signedFileUrl,
        signedAt: message.payload?.signedAt ?? state.signedAt,
        signers: message.payload?.signers ?? state.signers,
        auditSummary: message.payload?.auditSummary ?? state.auditSummary,
      };
      const merged = { ...state, ...patch };
      const patchKey = stateNotifyKey(merged);
      if (patchKey === lastPatchKeyRef.current) return;
      lastPatchKeyRef.current = patchKey;

      applyState(merged);

      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      patchTimerRef.current = setTimeout(() => {
        void fetch('/api/integrations/orion/ensure-document', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, patch }),
        });
      }, 400);
    },
    [applyState, requestId, state, stateNotifyKey]
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
    if (active && hasDocument && documentModalOpen) {
      pollRef.current = setInterval(() => void refreshState(), 20000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [documentModalOpen, refreshState, statusUpper, hasDocument]);

  const mySigner = useMemo(() => {
    const me = normalizeEmail(currentUserEmail);
    if (!me || !state.signers?.length) return null;
    return state.signers.find((s) => normalizeEmail(s.email) === me) ?? null;
  }, [currentUserEmail, state.signers]);

  const isMyTurn = Boolean(mySigner && signerPending(mySigner));

  useEffect(() => {
    if (state.embedUrl && !stableEmbedSrcRef.current) {
      stableEmbedSrcRef.current = state.embedUrl;
    }
  }, [state.embedUrl]);

  const documentIframeSrc =
    hasDocument &&
    (isMyTurn && mySigner?.signUrl
      ? mySigner.signUrl
      : stableEmbedSrcRef.current ?? state.embedUrl);

  const signatureFields = (state.signatureFields ?? []) as SignatureFieldPlacement[];
  const editorPdfSrc = attachmentPdfUrl ?? null;
  const useNativeEditor = Boolean(hasDocument && editorPdfSrc);

  const allFieldsPlaced =
    participants.length > 0 &&
    participants.every((p) => signatureFields.some((f) => f.signerOrder === p.order));

  const workflowStep = (() => {
    if (isTerminal) return 4;
    if (!hasSignature) return 0;
    if (!hasDocument) return 1;
    if (!allFieldsPlaced) return signatureFields.length > 0 ? 3 : 2;
    return 4;
  })();
  const statusLabel = state.status || 'SIN INICIAR';

  const signersPanel =
    participants.length > 0 ? (
      <Box mt='md'>
        <OrionSignersList
          participants={participants}
          activeOrder={activeSignerOrder}
          onSelect={setActiveSignerOrder}
          fields={signatureFields}
          signerStatuses={Object.fromEntries(
            (state.signers ?? []).map((s) => [normalizeEmail(s.email), String(s.status || 'PENDIENTE')])
          )}
        />
      </Box>
    ) : state.signers && state.signers.length > 0 ? (
      <Table striped withTableBorder mt='md'>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Firmante</Table.Th>
            <Table.Th>Estado</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {state.signers.map((signer, idx) => (
            <Table.Tr key={`${signer.email}-${idx}`}>
              <Table.Td>{signer.name || signer.email}</Table.Td>
              <Table.Td>
                <Badge size='sm' variant='light' color={signerPending(signer) ? 'blue' : 'green'}>
                  {signer.status || 'PENDIENTE'}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    ) : null;

  return (
    <>
      <Card withBorder radius='md' p='lg' shadow='sm'>
        <Group justify='space-between' mb='md'>
          <Group gap='sm'>
            <ThemeIcon size={38} radius='md' variant='light' color='blue'>
              <IconSignature size={20} />
            </ThemeIcon>
            <div>
              <Text fw={700}>Firma digital</Text>
              <Text size='xs' c='dimmed'>
                Paso 1: su firma · Paso 2–4: documento, firmantes y ubicación
              </Text>
            </div>
          </Group>
          <Badge color={statusColor(state.status)} variant='light'>
            {statusLabel}
          </Badge>
        </Group>

        <Stepper active={workflowStep} size='xs' mb='lg'>
          <Stepper.Step label='Mi firma' description={hasSignature ? 'Lista' : 'Pendiente'} />
          <Stepper.Step label='Documento' description={hasDocument ? 'Cargado' : 'Pendiente'} />
          <Stepper.Step label='Firmantes' description={participants.length ? `${participants.length} asignado(s)` : 'Pendiente'} />
          <Stepper.Step label='Ubicación' description={signatureFields.length ? 'En progreso' : 'Pendiente'} />
          <Stepper.Step label='Firmar' description={isTerminal ? 'Hecho' : '—'} />
        </Stepper>

        {error && (
          <Alert color='red' mb='md' withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Group gap='sm' mb='md' wrap='wrap'>
          <Button
            variant={hasSignature ? 'light' : 'filled'}
            leftSection={<IconUserCircle size={16} />}
            onClick={() => setSignatureModalOpen(true)}
            loading={signatureLoading}
          >
            {hasSignature ? 'Editar mi firma' : '1. Dibujar mi firma'}
          </Button>

          {(canManage || isMyTurn || hasDocument) && !isTerminal && (
            <Button
              leftSection={<IconEdit size={16} />}
              onClick={() => void openDocumentEditor()}
              disabled={!hasSignature && !signatureLoading}
            >
              2. Editar documento y ubicar firmas
            </Button>
          )}

          {isMyTurn && (
            <Button color='green' leftSection={<IconPencil size={16} />} onClick={() => void openDocumentEditor()}>
              Firmar ahora
            </Button>
          )}

          <Button variant='subtle' size='compact-sm' leftSection={<IconRefresh size={14} />} onClick={() => { void refreshState(); void loadUserSignature(); }}>
            Actualizar
          </Button>
        </Group>

        {hasSignature && signaturePreview && (
          <Group gap='xs' mb='sm'>
            <IconCheck size={14} color='var(--mantine-color-green-6)' />
            <Text size='xs' c='dimmed'>
              Firma guardada en GSS Firma (Orion)
            </Text>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={signaturePreview} alt='Mi firma' style={{ height: 28, maxWidth: 120, objectFit: 'contain' }} />
          </Group>
        )}

        {isTerminal && state.signedFileUrl && (
          <PdfInlineViewer src={state.signedFileUrl} fileName='Documento firmado.pdf' minHeight={200} />
        )}

        {signersPanel}
      </Card>

      {/* Popup 1: dibujar firma (nativo SynerLink, sin iframe Orion) */}
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

      {/* Popup 2: editor Orion dentro de SynerLink (modal contenido, no pantalla completa) */}
      <Modal
        opened={documentModalOpen}
        onClose={() => setDocumentModalOpen(false)}
        title='Editar documento'
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
        {!hasDocument && !isTerminal && (canManage || attachmentPdfUrl) && (
          <Stack gap='sm' mb='md' maw={560}>
            <Text size='sm'>Seleccione el PDF y luego ubique las firmas en el editor (como en GSS Firma).</Text>
            <Group>
              <FileButton onChange={setPdfFile} accept='application/pdf,.doc,.docx'>
                {(props) => (
                  <Button {...props} variant='light' leftSection={<IconUpload size={16} />}>
                    {pdfFile ? pdfFile.name : 'Seleccionar PDF'}
                  </Button>
                )}
              </FileButton>
              {pdfFile && (
                <Button onClick={() => void handleUploadAndCreate()} loading={uploading || loading}>
                  Cargar al editor
                </Button>
              )}
              {attachmentPdfUrl && (
                <Button variant='outline' onClick={() => void useAttachmentForSigning()} loading={uploading || loading}>
                  Usar archivo adjunto
                </Button>
              )}
            </Group>
          </Stack>
        )}

        {loading || uploading ? (
          <Group justify='center' py='xl' style={{ flex: 1 }}>
            <Loader />
            <Text size='sm' c='dimmed'>
              Preparando documento en GSS Firma…
            </Text>
          </Group>
        ) : useNativeEditor && state.orionDocumentId ? (
          <OrionDocumentEditor
            requestId={requestId}
            documentId={state.orionDocumentId}
            pdfSrc={editorPdfSrc ?? null}
            documentTitle={requestTitle}
            fileName={attachmentFileName}
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
            onStateUpdate={applyState}
            onClose={() => setDocumentModalOpen(false)}
          />
        ) : documentIframeSrc ? (
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
        ) : attachmentPdfUrl && !hasDocument ? (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <PdfInlineViewer src={attachmentPdfUrl} fileName={attachmentFileName ?? 'Vista previa.pdf'} minHeight={280} />
          </div>
        ) : (
          <Stack align='center' justify='center' style={{ flex: 1 }} gap='md'>
            <ThemeIcon size={48} radius='xl' variant='light'>
              <IconFileText size={24} />
            </ThemeIcon>
            <Text size='sm' c='dimmed' ta='center'>
              Cargue un documento para abrir el editor de firmas.
            </Text>
          </Stack>
        )}
      </Modal>
    </>
  );
}
