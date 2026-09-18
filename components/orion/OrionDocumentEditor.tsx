'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import {
  IconCertificate,
  IconDeviceFloppy,
  IconPaperclip,
  IconSend,
  IconWriting,
} from '@tabler/icons-react';
import type { SignatureFieldPlacement, SignatureFieldKind } from '../../lib/orion/signatureFields';
import { normalizeFieldKind } from '../../lib/orion/signatureFields';
import type { OrionDocumentSignatureKind, OrionSignatureState } from '../../lib/orion/types';
import {
  emptySignerSlot,
  mergeParticipantSources,
  resizeParticipantSlots,
  type OrionParticipant,
  type OrionParticipantType,
  type OrionUserOption,
} from '../../lib/orion/participants';
import OrionEditorSteps, { editorStepSubtitle } from './OrionEditorSteps';
import OrionSignerAssignment from './OrionSignerAssignment';
import OrionSignersList from './OrionSignersList';
import PdfInlineViewer from './PdfInlineViewer';
import SignaturePlacementCanvas from './SignaturePlacementCanvas';
import { usePdfBlobPreview } from './usePdfBlobPreview';

type EditorStep = 0 | 1 | 2;

type Props = {
  requestId: number;
  documentId: string;
  fileId: string;
  pdfSrc: string | null;
  documentTitle?: string;
  fileName?: string | null;
  participants: OrionParticipant[];
  availableUsers?: OrionUserOption[];
  currentUserEmail?: string;
  currentUserName?: string;
  /** Empresa de la solicitud (búsqueda de socios externos). */
  companyId?: number | null;
  /** Departamento del coordinador (solo visual, v1) */
  departmentLabel?: string | null;
  initialFields?: SignatureFieldPlacement[];
  state: OrionSignatureState;
  onStateUpdate: (state: OrionSignatureState) => void;
  onClose?: () => void;
  assignmentsEditable?: boolean;
  /** 0 = documento, 1 = firmantes, 2 = ubicar firmas */
  initialStep?: EditorStep;
  /** Cambia al reabrir el editor para resetear el paso aunque sea el mismo. */
  openNonce?: number;
};

const EDITOR_HEIGHT = 'min(62vh, 680px)';

function clampStep(step: number): EditorStep {
  return step <= 0 ? 0 : step >= 2 ? 2 : 1;
}

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function reindexParticipants(list: OrionParticipant[]): OrionParticipant[] {
  return list.map((p, idx) => ({ ...p, order: idx + 1 }));
}

function remapFieldsOrder(
  fields: SignatureFieldPlacement[],
  orderMap: Map<number, number>
): SignatureFieldPlacement[] {
  return fields.map((f) => {
    const nextOrder = orderMap.get(f.signerOrder);
    return nextOrder != null ? { ...f, signerOrder: nextOrder } : f;
  });
}

function buildInitialParticipants(
  participants: OrionParticipant[],
  state: OrionSignatureState
): OrionParticipant[] {
  const merged = mergeParticipantSources(participants, state.signers);
  return resizeParticipantSlots(merged, Math.max(merged.length, 1));
}

export default function OrionDocumentEditor({
  requestId,
  documentId,
  fileId,
  pdfSrc,
  documentTitle,
  fileName,
  participants,
  availableUsers = [],
  currentUserEmail,
  currentUserName,
  companyId = null,
  departmentLabel = null,
  initialFields = [],
  state,
  onStateUpdate,
  onClose,
  assignmentsEditable = true,
  initialStep = 0,
  openNonce = 0,
}: Props) {
  const [editorStep, setEditorStep] = useState<EditorStep>(() => clampStep(initialStep));

  useEffect(() => {
    setEditorStep(clampStep(initialStep));
  }, [initialStep, openNonce, documentId, fileId]);
  // Una sola carga de blob compartida entre preview (paso 0) y canvas (paso 2).
  const { blobUrl: sharedPdfBlob } = usePdfBlobPreview(pdfSrc, Boolean(pdfSrc));
  const sharedPdfSrc = sharedPdfBlob || pdfSrc;
  const [orderedParticipants, setOrderedParticipants] = useState<OrionParticipant[]>(() =>
    buildInitialParticipants(participants, state)
  );
  const [signerCount, setSignerCount] = useState(() =>
    Math.max(buildInitialParticipants(participants, state).length, 1)
  );
  const [includeSelf, setIncludeSelf] = useState(() => {
    const me = normalizeEmail(currentUserEmail);
    if (!me) return false;
    return buildInitialParticipants(participants, state).some(
      (p) => normalizeEmail(p.email) === me
    );
  });
  const [sequential, setSequential] = useState(true);
  const [activeOrder, setActiveOrder] = useState(1);
  const [activeFieldKind, setActiveFieldKind] = useState<SignatureFieldKind>('signature');
  const [requireFingerprint, setRequireFingerprint] = useState(() =>
    Boolean(state.requireFingerprint)
  );
  const [fields, setFields] = useState<SignatureFieldPlacement[]>(initialFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signatureKind, setSignatureKind] = useState<OrionDocumentSignatureKind>(
    () => state.signatureKind || 'electronic'
  );

  useEffect(() => {
    setSignatureKind(state.signatureKind || 'electronic');
  }, [state.signatureKind, documentId, fileId, openNonce]);

  const selectSignatureKind = useCallback(
    (kind: OrionDocumentSignatureKind) => {
      setSignatureKind(kind);
      onStateUpdate({
        ...state,
        signatureKind: kind,
        fileId,
        fileName: state.fileName || fileName || null,
      });
    },
    [fileId, fileName, onStateUpdate, state]
  );

  useEffect(() => {
    setFields(initialFields);
  }, [initialFields]);

  useEffect(() => {
    if (orderedParticipants.length && !orderedParticipants.some((p) => p.order === activeOrder)) {
      setActiveOrder(orderedParticipants[0]!.order);
    }
  }, [activeOrder, orderedParticipants]);

  const signerStatuses = useMemo(() => {
    // Clave por orden de slot (mismo email puede aparecer varias veces).
    const map: Record<string, string> = {};
    for (const s of state.signers ?? []) {
      const order = Number(s.order);
      if (Number.isFinite(order) && order > 0) {
        map[`order:${order}`] = String(s.status || 'PENDIENTE');
      }
      if (s.email) map[s.email.toLowerCase()] = String(s.status || 'PENDIENTE');
    }
    return map;
  }, [state.signers]);

  const assignedParticipants = useMemo(
    () => orderedParticipants.filter((p) => Boolean(p.email)),
    [orderedParticipants]
  );

  const allPlaced =
    assignedParticipants.length > 0 &&
    assignedParticipants.every((p) => {
      const hasSig = fields.some(
        (f) => f.signerOrder === p.order && normalizeFieldKind(f.kind) === 'signature'
      );
      if (!hasSig) return false;
      if (!requireFingerprint) return true;
      return fields.some(
        (f) => f.signerOrder === p.order && normalizeFieldKind(f.kind) === 'fingerprint'
      );
    });

  const handleSignerCountChange = useCallback((count: number) => {
    setSignerCount(count);
    setOrderedParticipants((prev) => resizeParticipantSlots(prev, count));
    setFields((prev) => prev.filter((f) => f.signerOrder <= count));
  }, []);

  const handleAssignSigner = useCallback(
    (
      order: number,
      email: string,
      name: string,
      meta?: { type?: OrionParticipantType; cardCode?: string | null }
    ) => {
      setOrderedParticipants((prev) =>
        prev.map((p) =>
          p.order === order
            ? {
                ...p,
                email: normalizeEmail(email),
                name: name.trim() || email,
                role: 'Firmante',
                type: meta?.type || 'internal',
                cardCode: meta?.cardCode ?? null,
              }
            : p
        )
      );
    },
    []
  );

  const handleClearSigner = useCallback((order: number) => {
    setOrderedParticipants((prev) =>
      prev.map((p) => (p.order === order ? emptySignerSlot(order) : p))
    );
    setFields((prev) => prev.filter((f) => f.signerOrder !== order));
  }, []);

  const handleIncludeSelfChange = useCallback(
    (checked: boolean) => {
      setIncludeSelf(checked);
      const me = normalizeEmail(currentUserEmail);
      if (!me) return;

      if (checked) {
        // Solo asegura el slot 1; no quita el mismo email de otros slots
        // (una persona puede firmar varias veces en el documento).
        setOrderedParticipants((prev) => {
          const next = [...prev];
          const slot1 = next.find((p) => p.order === 1) ?? emptySignerSlot(1);
          const updated = {
            ...slot1,
            order: 1,
            email: me,
            name: currentUserName?.trim() || me,
            role: 'Firmante' as const,
          };
          const without1 = next.filter((p) => p.order !== 1);
          return reindexParticipants(
            resizeParticipantSlots([updated, ...without1], signerCount)
          );
        });
        return;
      }

      setOrderedParticipants((prev) =>
        resizeParticipantSlots(
          prev.map((p) =>
            p.order === 1 && normalizeEmail(p.email) === me ? emptySignerSlot(p.order) : p
          ),
          signerCount
        )
      );
    },
    [currentUserEmail, currentUserName, signerCount]
  );

  const reorderParticipant = useCallback((order: number, direction: 'up' | 'down') => {
    setOrderedParticipants((prev) => {
      const idx = prev.findIndex((p) => p.order === order);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;

      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!];
      const reindexed = reindexParticipants(next);

      const orderMap = new Map<number, number>();
      prev.forEach((p, i) => {
        const updated = reindexed[i];
        if (updated) orderMap.set(p.order, updated.order);
      });
      setFields((current) => remapFieldsOrder(current, orderMap));
      setActiveOrder((current) => orderMap.get(current) ?? reindexed[0]?.order ?? 1);
      return reindexed;
    });
  }, []);

  const validateAssignments = useCallback(() => {
    const pending = orderedParticipants.filter((p) => !p.email);
    if (pending.length > 0) {
      return `Asigne todos los firmantes (${pending.length} pendiente(s)).`;
    }
    return null;
  }, [orderedParticipants]);

  const assignSigners = useCallback(async () => {
    const validationError = validateAssignments();
    if (validationError) throw new Error(validationError);

    const res = await fetch('/api/integrations/orion/signers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        fileId,
        mode: sequential ? 'sequential' : 'parallel',
        signers: orderedParticipants
          .filter((p) => p.email)
          .map((p) => ({
            email: p.email,
            name: p.name,
            order: p.order,
            type: p.type === 'external' ? 'external' : 'internal',
            ...(p.cardCode ? { cardCode: p.cardCode } : {}),
          })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudieron asignar los firmantes');
    if (data.state) {
      const next = data.state as OrionSignatureState;
      // Preserva type/cardCode locales si Orion no los devuelve.
      const byEmail = new Map(
        orderedParticipants.map((p) => [normalizeEmail(p.email), p] as const)
      );
      const signers = (next.signers ?? []).map((s) => {
        const local = byEmail.get(normalizeEmail(s.email));
        if (!local) return s;
        return {
          ...s,
          type: local.type || s.type || 'internal',
          cardCode: local.cardCode ?? s.cardCode ?? null,
        };
      });
      onStateUpdate({ ...next, signers, requireFingerprint });
    }
  }, [fileId, onStateUpdate, orderedParticipants, requestId, requireFingerprint, sequential, validateAssignments]);

  const persistFields = useCallback(async () => {
    const postFields = () =>
      fetch('/api/integrations/orion/signature-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId, signatureFields: fields }),
      });

    let res = await postFields();
    let data = await res.json().catch(() => ({}));

    const tokenStale =
      !res.ok &&
      (res.status === 401 ||
        res.status === 403 ||
        /embed|token|expir|inv[aá]lid/i.test(String(data.error || '')));

    if (tokenStale) {
      // Renueva embedUrl en Orion/bag y reintenta guardar ubicaciones.
      const refreshRes = await fetch('/api/integrations/orion/ensure-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          fileId,
          fileName: fileName ?? undefined,
          refresh: true,
        }),
      });
      const refreshData = await refreshRes.json().catch(() => ({}));
      if (refreshRes.ok && refreshData.state) {
        onStateUpdate(refreshData.state as OrionSignatureState);
      }
      res = await postFields();
      data = await res.json().catch(() => ({}));
    }

    if (!res.ok) {
      throw new Error(data.error || 'No se guardaron las ubicaciones en Orion');
    }
    if (data.state) {
      onStateUpdate(data.state as OrionSignatureState);
    } else {
      onStateUpdate({ ...state, signatureFields: fields });
    }
  }, [fields, fileId, fileName, onStateUpdate, requestId, state]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await assignSigners();
      await persistFields();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }, [assignSigners, persistFields]);

  const handleSend = useCallback(async () => {
    if (!allPlaced) {
      setError('Ubique la firma de cada firmante en el documento antes de enviar.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await assignSigners();
      await persistFields();
      const res = await fetch('/api/integrations/orion/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, fileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar a firma');
      if (data.state) onStateUpdate(data.state as OrionSignatureState);
      onClose?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al enviar');
    } finally {
      setSaving(false);
    }
  }, [allPlaced, assignSigners, fileId, onClose, onStateUpdate, persistFields, requestId]);

  const goNext = useCallback(async () => {
    if (editorStep === 1) {
      const validationError = validateAssignments();
      if (validationError) {
        setError(validationError);
        return;
      }
      setSaving(true);
      setError(null);
      try {
        await assignSigners();
        setEditorStep(2);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudieron asignar los firmantes');
      } finally {
        setSaving(false);
      }
      return;
    }
    setEditorStep((s) => clampStep(s + 1));
  }, [assignSigners, editorStep, validateAssignments]);

  if (!pdfSrc) {
    return (
      <Stack align='center' py='xl'>
        <Text size='sm' c='dimmed'>
          No hay documento PDF disponible.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap='md' style={{ height: EDITOR_HEIGHT }}>
      <Box>
        <Text size='xs' c='dimmed' mb='xs'>
          {editorStepSubtitle(editorStep)}
        </Text>
        <OrionEditorSteps active={editorStep} />
      </Box>

      {error && (
        <Alert color='red' withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {editorStep === 0 && (
          <ScrollArea style={{ flex: 1 }} offsetScrollbars type='scroll'>
            <Stack gap='md' maw={640}>
              <Box>
                <Text size='sm' fw={600} mb={4}>
                  Archivo del documento *
                </Text>
                <Text size='xs' c='dimmed' mb='xs'>
                  Formatos admitidos: PDF. El archivo ya está adjunto a esta solicitud.
                </Text>
                <Paper
                  withBorder
                  p='xl'
                  radius='md'
                  style={{
                    background: 'var(--app-surface-raised)',
                    borderStyle: 'dashed',
                    textAlign: 'center',
                  }}
                >
                  <Stack gap={6} align='center'>
                    <IconPaperclip size={28} style={{ opacity: 0.65 }} />
                    <Text size='sm' fw={600}>
                      {fileName || 'Documento adjunto'}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      PDF listo para preparar firmantes
                    </Text>
                  </Stack>
                </Paper>
                {sharedPdfSrc ? (
                  <Box mt='md'>
                    <PdfInlineViewer
                      src={sharedPdfSrc}
                      fileName={fileName ?? undefined}
                      minHeight={320}
                    />
                  </Box>
                ) : null}
              </Box>

              <Box>
                <Text size='sm' fw={600} mb={4}>
                  Título
                </Text>
                <Paper withBorder p='sm' radius='md' style={{ background: 'var(--app-surface)' }}>
                  <Text size='sm'>{documentTitle || fileName || 'Sin título'}</Text>
                </Paper>
              </Box>

              <Box>
                <Text size='sm' fw={600} mb={8}>
                  Tipo de firma del documento
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
                  <UnstyledButton
                    onClick={() => selectSignatureKind('electronic')}
                    style={{ textAlign: 'left', width: '100%' }}
                    aria-pressed={signatureKind === 'electronic'}
                  >
                    <Paper
                      withBorder
                      p='sm'
                      radius='md'
                      style={{
                        background:
                          signatureKind === 'electronic'
                            ? 'color-mix(in srgb, var(--app-accent) 10%, var(--app-surface))'
                            : 'var(--app-surface)',
                        borderColor:
                          signatureKind === 'electronic'
                            ? 'color-mix(in srgb, var(--app-accent) 45%, var(--app-border))'
                            : undefined,
                        borderWidth: signatureKind === 'electronic' ? 2 : 1,
                      }}
                    >
                      <Group gap='xs' mb={4} justify='space-between' wrap='nowrap'>
                        <Group gap='xs' wrap='nowrap'>
                          <IconWriting size={16} />
                          <Text size='sm' fw={700}>
                            Firma electrónica
                          </Text>
                        </Group>
                        {signatureKind === 'electronic' ? (
                          <Text size='10px' fw={700} c='blue' tt='uppercase'>
                            Principal
                          </Text>
                        ) : null}
                      </Group>
                      <Text size='xs' c='dimmed'>
                        Rúbrica dibujada + identidad en GSS Firma. Es el flujo activo hoy (plazo
                        24 h por turno).
                      </Text>
                    </Paper>
                  </UnstyledButton>

                  <UnstyledButton
                    onClick={() => selectSignatureKind('digital')}
                    style={{ textAlign: 'left', width: '100%' }}
                    aria-pressed={signatureKind === 'digital'}
                  >
                    <Paper
                      withBorder
                      p='sm'
                      radius='md'
                      style={{
                        background:
                          signatureKind === 'digital'
                            ? 'color-mix(in srgb, var(--app-accent) 10%, var(--app-surface))'
                            : 'var(--app-surface)',
                        borderColor:
                          signatureKind === 'digital'
                            ? 'color-mix(in srgb, var(--app-accent) 45%, var(--app-border))'
                            : undefined,
                        borderWidth: signatureKind === 'digital' ? 2 : 1,
                      }}
                    >
                      <Group gap='xs' mb={4} wrap='nowrap'>
                        <IconCertificate size={16} />
                        <Text size='sm' fw={700}>
                          Firma digital
                        </Text>
                      </Group>
                      <Text size='xs' c='dimmed'>
                        Certificado digital. Opción disponible para preparar; la firma con
                        certificado se habilitará en Orion.
                      </Text>
                    </Paper>
                  </UnstyledButton>
                </SimpleGrid>
                {signatureKind === 'digital' ? (
                  <Alert color='yellow' variant='light' mt='sm'>
                    Por ahora el firmante sigue usando rúbrica electrónica al confirmar. La firma
                    digital con certificado quedará operativa cuando Orion la active.
                  </Alert>
                ) : (
                  <Text size='xs' c='dimmed' mt='sm'>
                    Procedencia SynerLink: el documento queda trazado en Orion con empresa y origen
                    SynerLink.
                  </Text>
                )}
              </Box>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
                <Box>
                  <Text size='sm' fw={600} mb={4}>
                    Responsable
                  </Text>
                  <Paper withBorder p='sm' radius='md' style={{ background: 'var(--app-surface)' }}>
                    <Text size='sm'>{currentUserName || currentUserEmail || '—'}</Text>
                  </Paper>
                </Box>
                <Box>
                  <Text size='sm' fw={600} mb={4}>
                    Departamento
                  </Text>
                  <Paper withBorder p='sm' radius='md' style={{ background: 'var(--app-surface)' }}>
                    <Text size='sm'>{departmentLabel || 'Según su perfil SynerLink'}</Text>
                  </Paper>
                </Box>
              </SimpleGrid>

              <Alert color='blue' variant='light'>
                Continúe para asignar firmantes (puede incluirse usted) y ubicar las firmas en el
                PDF, igual que en GSS Firma.
              </Alert>
            </Stack>
          </ScrollArea>
        )}

        {editorStep === 1 && !assignmentsEditable && (
          <Alert color='gray' variant='light' mb='md'>
            Solo el creador puede editar firmantes y posiciones mientras la solicitud esté abierta y
            nadie haya firmado.
          </Alert>
        )}

        {editorStep === 1 && assignmentsEditable && (
          <Alert color='blue' variant='light' mb='md'>
            Cada firmante tendrá 24 horas para firmar cuando sea su turno. Si vence, podrá solicitar
            renovación al líder del proceso.
          </Alert>
        )}

        {editorStep === 1 && (
          <ScrollArea style={{ flex: 1 }} offsetScrollbars type='scroll'>
            <OrionSignerAssignment
              participants={orderedParticipants}
              signerCount={signerCount}
              sequential={sequential}
              includeSelf={includeSelf}
              availableUsers={availableUsers}
              currentUserEmail={currentUserEmail}
              currentUserName={currentUserName}
              companyId={companyId}
              signerStatuses={signerStatuses}
              readOnly={!assignmentsEditable}
              onSignerCountChange={handleSignerCountChange}
              onSequentialChange={setSequential}
              onIncludeSelfChange={handleIncludeSelfChange}
              onAssign={handleAssignSigner}
              onClear={handleClearSigner}
              onReorder={signerCount > 1 && assignmentsEditable ? reorderParticipant : undefined}
            />
            {assignmentsEditable ? (
              <Checkbox
                mt='md'
                label='Requiere huella dactilar'
                description='Además de la rúbrica, coloque una caja de huella por firmante.'
                checked={requireFingerprint}
                onChange={(e) => setRequireFingerprint(e.currentTarget.checked)}
              />
            ) : null}
          </ScrollArea>
        )}

        {editorStep === 2 && (
          <Box
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'row',
              gap: 16,
            }}
          >
            <Box
              style={{
                width: '30%',
                minWidth: 260,
                maxWidth: 320,
                minHeight: 0,
                borderRadius: 12,
                border: '1px solid var(--app-border)',
                background: 'var(--app-surface-raised)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box
                px='md'
                py='sm'
                style={{
                  borderBottom: '1px solid var(--app-border)',
                  background: 'var(--app-surface)',
                }}
              >
                <Text size='sm' fw={600}>
                  Orden de firma
                </Text>
                <Text size='xs' c='dimmed'>
                  Seleccione un firmante y el tipo de caja; luego ubíquela en el PDF.
                </Text>
                <SegmentedControl
                  mt='sm'
                  size='xs'
                  fullWidth
                  value={activeFieldKind}
                  onChange={(v) => setActiveFieldKind(v as SignatureFieldKind)}
                  data={[
                    { label: 'Firma', value: 'signature' },
                    { label: 'Huella', value: 'fingerprint' },
                    { label: 'Validación', value: 'validation' },
                  ]}
                />
              </Box>
              <ScrollArea style={{ flex: 1 }} offsetScrollbars type='scroll' scrollbarSize={8}>
                <Box p='md'>
                  <OrionSignersList
                    participants={assignedParticipants}
                    activeOrder={activeOrder}
                    onSelect={setActiveOrder}
                    fields={fields}
                    signerStatuses={signerStatuses}
                    variant='placement'
                    sequential={sequential}
                  />
                </Box>
              </ScrollArea>
            </Box>

            <Box
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 12,
                border: '1px solid var(--app-border)',
                background: 'var(--app-bg)',
                overflow: 'hidden',
              }}
            >
              <SignaturePlacementCanvas
                pdfSrc={sharedPdfSrc}
                documentId={documentId}
                participants={assignedParticipants}
                activeOrder={activeOrder}
                activeKind={activeFieldKind}
                fields={fields}
                onChange={setFields}
              />
            </Box>
          </Box>
        )}
      </Box>

      <Group
        justify='space-between'
        wrap='wrap'
        pt='xs'
        style={{ borderTop: '1px solid var(--app-border-subtle)' }}
      >
        {editorStep === 2 ? (
          <Text size='sm' c='dimmed' fw={500}>
            {fields.length} de {assignedParticipants.length} firma(s) ubicada(s)
          </Text>
        ) : (
          <Button variant='subtle' onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
        )}

        <Group>
          {editorStep > 0 && (
            <Button variant='default' onClick={() => setEditorStep((s) => clampStep(s - 1))} disabled={saving}>
              Atrás
            </Button>
          )}
          {editorStep < 2 ? (
            <Button onClick={() => void goNext()} loading={saving} disabled={!assignmentsEditable && editorStep === 1}>
              Continuar
            </Button>
          ) : (
            <>
              <Button
                variant='default'
                leftSection={saving ? <Loader size={14} /> : <IconDeviceFloppy size={16} />}
                onClick={() => void handleSave()}
                disabled={saving || !assignmentsEditable}
              >
                Guardar ubicaciones
              </Button>
              <Button
                color='blue'
                leftSection={saving ? <Loader size={14} /> : <IconSend size={16} />}
                onClick={() => void handleSend()}
                disabled={saving || !allPlaced || !assignmentsEditable}
              >
                Enviar a firma
              </Button>
            </>
          )}
        </Group>
      </Group>
    </Stack>
  );
}
