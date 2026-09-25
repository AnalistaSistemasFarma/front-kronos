'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconCertificate,
  IconCheck,
  IconDeviceFloppy,
  IconFileText,
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
import { showEmailSentNotification } from '../../lib/notifications/showEmailSentNotification';

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
  /** Permiso “Registrar huella”: exige/coloca cajas de huella. */
  canUseFingerprint?: boolean;
  /** 0 = documento, 1 = firmantes, 2 = ubicar firmas */
  initialStep?: EditorStep;
  /** Cambia al reabrir el editor para resetear el paso aunque sea el mismo. */
  openNonce?: number;
};

const EDITOR_HEIGHT = '100%';

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
  canUseFingerprint = false,
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
  const [fields, setFields] = useState<SignatureFieldPlacement[]>(initialFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signatureKind, setSignatureKind] = useState<OrionDocumentSignatureKind>(
    () => state.signatureKind || 'electronic'
  );
  const isNarrowPrep = useMediaQuery('(max-width: 900px)');

  useEffect(() => {
    setSignatureKind(state.signatureKind || 'electronic');
  }, [state.signatureKind, documentId, fileId, openNonce]);

  const selectSignatureKind = useCallback(
    (kind: OrionDocumentSignatureKind) => {
      // Firma digital (certificado) aún no operativa: solo permitir electrónica.
      if (kind !== 'electronic') return;
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
    if (signatureKind !== 'electronic') {
      setSignatureKind('electronic');
    }
  }, [signatureKind]);

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

  const anySignerNeedsFingerprint = assignedParticipants.some((p) =>
    Boolean(p.requireFingerprint)
  );
  const effectiveRequireFingerprint = canUseFingerprint && anySignerNeedsFingerprint;

  /** Caja requerida por participante: firma (+huella) o solo validación. */
  const participantHasRequiredBoxes = useCallback(
    (p: OrionParticipant) => {
      const kinds = fields
        .filter((f) => f.signerOrder === p.order)
        .map((f) => normalizeFieldKind(f.kind));
      const hasValidation = kinds.includes('validation');
      const hasSig = kinds.includes('signature');
      // Solo validador: basta con caja de validación (sin firma ni huella).
      if (hasValidation && !hasSig) return true;
      if (!hasSig) return false;
      if (!(canUseFingerprint && p.requireFingerprint)) return true;
      return kinds.includes('fingerprint');
    },
    [canUseFingerprint, fields]
  );

  const allPlaced =
    assignedParticipants.length > 0 &&
    assignedParticipants.every((p) => participantHasRequiredBoxes(p));

  const placedCount = assignedParticipants.filter((p) => participantHasRequiredBoxes(p)).length;

  useEffect(() => {
    if (!canUseFingerprint && activeFieldKind === 'fingerprint') {
      setActiveFieldKind('signature');
    }
  }, [activeFieldKind, canUseFingerprint]);

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
      const type = meta?.type || 'internal';
      setOrderedParticipants((prev) =>
        prev.map((p) =>
          p.order === order
            ? {
                ...p,
                email: normalizeEmail(email),
                name: name.trim() || email,
                role: 'Firmante',
                type,
                cardCode: meta?.cardCode ?? null,
                // Siempre notificar por correo al enviar a firma (sin checkbox en UI).
                notifyByEmail: true,
                requireFingerprint: Boolean(p.requireFingerprint),
                signatureMarkId: p.signatureMarkId ?? p.order,
              }
            : p
        )
      );
    },
    []
  );

  const handleToggleRequireFingerprint = useCallback((order: number, value: boolean) => {
    setOrderedParticipants((prev) =>
      prev.map((p) => (p.order === order ? { ...p, requireFingerprint: value } : p))
    );
    if (!value) {
      setFields((prev) =>
        prev.filter(
          (f) =>
            !(f.signerOrder === order && normalizeFieldKind(f.kind) === 'fingerprint')
        )
      );
    }
  }, []);

  const handleSignatureMarkIdChange = useCallback((order: number, markId: number) => {
    setOrderedParticipants((prev) => {
      const next = prev.map((p) =>
        p.order === order ? { ...p, signatureMarkId: markId } : p
      );
      const signer = next.find((p) => p.order === order);
      const name = signer?.name?.trim() || `Firma ${markId}`;
      setFields((fields) =>
        fields.map((f) => {
          if (f.signerOrder !== order) return f;
          const kind = normalizeFieldKind(f.kind);
          if (kind === 'validation') return f;
          if (kind === 'fingerprint') {
            return { ...f, label: `Huella · ${markId} · ${name}` };
          }
          return { ...f, label: `Firma ${markId} · ${name}` };
        })
      );
      return next;
    });
  }, []);

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
            type: 'internal' as const,
            cardCode: null,
            notifyByEmail: true,
            requireFingerprint: Boolean(slot1.requireFingerprint),
            signatureMarkId: slot1.signatureMarkId ?? 1,
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
    const marks = orderedParticipants.map((p) =>
      Number.isFinite(Number(p.signatureMarkId)) && Number(p.signatureMarkId) >= 1
        ? Math.trunc(Number(p.signatureMarkId))
        : p.order
    );
    const unique = new Set(marks);
    if (unique.size !== marks.length) {
      return 'Cada firmante debe tener un ID de firma distinto.';
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
            notifyByEmail: true,
            requireFingerprint: Boolean(p.requireFingerprint),
            signatureMarkId:
              Number.isFinite(Number(p.signatureMarkId)) && Number(p.signatureMarkId) >= 1
                ? Math.trunc(Number(p.signatureMarkId))
                : p.order,
          })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudieron asignar los firmantes');
    if (data.state) {
      const next = data.state as OrionSignatureState;
      // Preserva type/cardCode/flags locales (mismo email puede repetirse → clave por orden).
      const byOrder = new Map(
        orderedParticipants.map((p) => [Number(p.order), p] as const)
      );
      const byEmail = new Map(
        orderedParticipants.map((p) => [normalizeEmail(p.email), p] as const)
      );
      const signers = (next.signers ?? []).map((s) => {
        const local =
          byOrder.get(Number(s.order)) ?? byEmail.get(normalizeEmail(s.email));
        if (!local) return s;
        return {
          ...s,
          type: local.type || s.type || 'internal',
          cardCode: local.cardCode ?? s.cardCode ?? null,
          notifyByEmail: true,
          requireFingerprint: Boolean(local.requireFingerprint),
          signatureMarkId:
            local.signatureMarkId != null
              ? local.signatureMarkId
              : s.signatureMarkId ?? s.order,
        };
      });
      onStateUpdate({
        ...next,
        signers,
        requireFingerprint: effectiveRequireFingerprint,
        fingerprintPolicy: 'per-signer',
      });
    }
  }, [
    effectiveRequireFingerprint,
    fileId,
    onStateUpdate,
    orderedParticipants,
    requestId,
    sequential,
    validateAssignments,
  ]);

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
      const authCreated = Number(data.authorizationsCreated) || 0;
      const signerCount = Array.isArray(data.state?.signers)
        ? data.state.signers.length
        : undefined;
      showEmailSentNotification({
        title: '¡Documento enviado a firma!',
        fileName: fileName || null,
        message: [
          fileName ? `Documento: ${fileName}` : null,
          signerCount != null ? `${signerCount} firmante(s) notificado(s)` : null,
          authCreated > 0
            ? 'Se creó la autorización y se enviaron avisos (campana / correo).'
            : 'Se notificó a los firmantes (campana / correo).',
        ]
          .filter(Boolean)
          .join('. '),
      });
      onClose?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al enviar');
    } finally {
      setSaving(false);
    }
  }, [allPlaced, assignSigners, fileId, fileName, onClose, onStateUpdate, persistFields, requestId]);

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
    <Stack gap='sm' style={{ height: EDITOR_HEIGHT, minHeight: 0, flex: 1 }}>
      <Box px={4}>
        <Text
          size='xs'
          c='dimmed'
          mb={10}
          style={{ letterSpacing: '0.02em', textTransform: 'uppercase', fontWeight: 600 }}
        >
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
          <Box
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: isNarrowPrep
                ? '1fr'
                : 'minmax(0, 1.45fr) minmax(300px, 0.75fr)',
              gridTemplateRows: isNarrowPrep ? 'minmax(260px, 40vh) minmax(0, 1fr)' : undefined,
              gap: 16,
              alignItems: 'stretch',
            }}
          >
            <Box
              style={{
                minHeight: 0,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <Group gap={8} wrap='nowrap'>
                <ThemeIcon
                  size={32}
                  radius='md'
                  variant='light'
                  color='teal'
                  style={{ flexShrink: 0 }}
                >
                  <IconFileText size={18} />
                </ThemeIcon>
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size='sm' fw={700} lineClamp={1} style={{ letterSpacing: '-0.02em' }}>
                    {fileName || 'Documento PDF'}
                  </Text>
                  <Text size='xs' c='dimmed'>
                    Revise el archivo antes de continuar
                  </Text>
                </Box>
              </Group>

              <Box style={{ flex: 1, minHeight: 0 }}>
                {sharedPdfSrc ? (
                  <PdfInlineViewer
                    src={sharedPdfSrc}
                    fileName={fileName ?? undefined}
                    fill
                    minHeight={480}
                  />
                ) : (
                  <Paper
                    withBorder
                    radius='lg'
                    style={{
                      height: '100%',
                      minHeight: 280,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--app-surface-raised)',
                    }}
                  >
                    <Text size='sm' c='dimmed'>
                      No hay vista previa disponible
                    </Text>
                  </Paper>
                )}
              </Box>
            </Box>

            <ScrollArea
              style={{ minHeight: 0, height: '100%' }}
              offsetScrollbars
              type='scroll'
              styles={{
                viewport: { paddingRight: 4 },
              }}
            >
              <Stack gap='md' pr={4}>
                <Box>
                  <Text
                    size='xs'
                    fw={700}
                    c='dimmed'
                    tt='uppercase'
                    mb={6}
                    style={{ letterSpacing: '0.04em' }}
                  >
                    Título
                  </Text>
                  <Paper
                    withBorder
                    p='md'
                    radius='lg'
                    style={{
                      background: 'var(--app-surface)',
                      boxShadow: '0 1px 2px color-mix(in srgb, #000 3%, transparent)',
                    }}
                  >
                    <Text size='sm' fw={600} style={{ letterSpacing: '-0.01em', lineHeight: 1.4 }}>
                      {documentTitle || fileName || 'Sin título'}
                    </Text>
                  </Paper>
                </Box>

                <Box>
                  <Text
                    size='xs'
                    fw={700}
                    c='dimmed'
                    tt='uppercase'
                    mb={8}
                    style={{ letterSpacing: '0.04em' }}
                  >
                    Tipo de firma
                  </Text>
                  <Stack gap='sm'>
                    <UnstyledButton
                      onClick={() => selectSignatureKind('electronic')}
                      style={{ textAlign: 'left', width: '100%' }}
                      aria-pressed={signatureKind === 'electronic'}
                    >
                      <Paper
                        withBorder
                        p='md'
                        radius='lg'
                        style={{
                          background:
                            'color-mix(in srgb, var(--app-accent) 9%, var(--app-surface))',
                          borderColor:
                            'color-mix(in srgb, var(--app-accent) 50%, var(--app-border))',
                          borderWidth: 1.5,
                          boxShadow:
                            '0 0 0 3px color-mix(in srgb, var(--app-accent) 12%, transparent)',
                          transition: 'box-shadow 160ms ease, border-color 160ms ease',
                        }}
                      >
                        <Group
                          gap='sm'
                          mb={8}
                          justify='space-between'
                          wrap='nowrap'
                          align='flex-start'
                        >
                          <Group gap='sm' wrap='nowrap' align='flex-start'>
                            <ThemeIcon size={36} radius='md' variant='filled' color='teal'>
                              <IconWriting size={18} />
                            </ThemeIcon>
                            <Box>
                              <Text size='sm' fw={700} style={{ letterSpacing: '-0.01em' }}>
                                Firma electrónica
                              </Text>
                              <Text size='10px' fw={700} c='teal' tt='uppercase' mt={2}>
                                Disponible
                              </Text>
                            </Box>
                          </Group>
                          <ThemeIcon size={22} radius='xl' color='teal' variant='filled'>
                            <IconCheck size={14} stroke={2.5} />
                          </ThemeIcon>
                        </Group>
                        <Text size='xs' c='dimmed' style={{ lineHeight: 1.5 }}>
                          El firmante dibuja su firma en pantalla y confirma quién es (nombre y
                          documento). Ideal para equipos internos y socios externos. Plazo: 24 h por
                          turno.
                        </Text>
                      </Paper>
                    </UnstyledButton>

                    <Paper
                      withBorder
                      p='md'
                      radius='lg'
                      style={{
                        background: 'var(--app-surface-raised)',
                        opacity: 0.85,
                        cursor: 'not-allowed',
                      }}
                      aria-disabled
                      title='Firma digital con certificado: próximamente'
                    >
                      <Group gap='sm' mb={8} wrap='nowrap' align='flex-start'>
                        <ThemeIcon size={36} radius='md' variant='light' color='gray'>
                          <IconCertificate size={18} />
                        </ThemeIcon>
                        <Box>
                          <Text size='sm' fw={700} style={{ letterSpacing: '-0.01em' }}>
                            Firma digital
                          </Text>
                          <Text size='10px' fw={700} c='dimmed' tt='uppercase' mt={2}>
                            Próximamente
                          </Text>
                        </Box>
                      </Group>
                      <Text size='xs' c='dimmed' style={{ lineHeight: 1.5 }}>
                        Usa un certificado digital (token o archivo) para sellar el PDF con
                        integridad criptográfica. Se habilitará cuando Orion soporte certificado;
                        por ahora no se puede elegir.
                      </Text>
                    </Paper>
                  </Stack>
                </Box>

                <SimpleGrid cols={1} spacing='sm'>
                  <Box>
                    <Text
                      size='xs'
                      fw={700}
                      c='dimmed'
                      tt='uppercase'
                      mb={6}
                      style={{ letterSpacing: '0.04em' }}
                    >
                      Responsable
                    </Text>
                    <Paper
                      withBorder
                      px='md'
                      py='sm'
                      radius='lg'
                      style={{ background: 'var(--app-surface)' }}
                    >
                      <Text size='sm' fw={500}>
                        {currentUserName || currentUserEmail || '—'}
                      </Text>
                    </Paper>
                  </Box>
                  <Box>
                    <Text
                      size='xs'
                      fw={700}
                      c='dimmed'
                      tt='uppercase'
                      mb={6}
                      style={{ letterSpacing: '0.04em' }}
                    >
                      Departamento
                    </Text>
                    <Paper
                      withBorder
                      px='md'
                      py='sm'
                      radius='lg'
                      style={{ background: 'var(--app-surface)' }}
                    >
                      <Text size='sm' fw={500}>
                        {departmentLabel || 'Según su perfil SynerLink'}
                      </Text>
                    </Paper>
                  </Box>
                </SimpleGrid>

                <Paper
                  p='md'
                  radius='lg'
                  style={{
                    background:
                      'color-mix(in srgb, var(--app-accent) 8%, var(--app-surface-raised))',
                    border:
                      '1px solid color-mix(in srgb, var(--app-accent) 20%, var(--app-border))',
                  }}
                >
                  <Text size='xs' fw={600} mb={4}>
                    Siguiente paso
                  </Text>
                  <Text size='xs' c='dimmed' style={{ lineHeight: 1.5 }}>
                    Asigne firmantes (puede incluirse usted) y luego ubique las firmas sobre el PDF.
                    El documento queda trazado en Orion con origen SynerLink.
                  </Text>
                </Paper>
              </Stack>
            </ScrollArea>
          </Box>
        )}

        {editorStep === 1 && !assignmentsEditable && (
          <Alert color='gray' variant='light' mb='md'>
            Solo el creador puede editar firmantes y posiciones mientras la solicitud esté abierta y
            nadie haya firmado.
          </Alert>
        )}

        {editorStep === 1 && assignmentsEditable && (
          <Alert color='blue' variant='light' mb='md'>
            Cada firmante tendrá 24 horas para firmar cuando sea su turno. Al enviar a firma se
            crean las tareas y se notifica por correo con el enlace para firmar.
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
              canUseFingerprint={canUseFingerprint}
              readOnly={!assignmentsEditable}
              onSignerCountChange={handleSignerCountChange}
              onSequentialChange={setSequential}
              onIncludeSelfChange={handleIncludeSelfChange}
              onAssign={handleAssignSigner}
              onClear={handleClearSigner}
              onReorder={signerCount > 1 && assignmentsEditable ? reorderParticipant : undefined}
              onToggleRequireFingerprint={
                assignmentsEditable && canUseFingerprint
                  ? handleToggleRequireFingerprint
                  : undefined
              }
              onSignatureMarkIdChange={
                assignmentsEditable ? handleSignatureMarkIdChange : undefined
              }
            />
            {assignmentsEditable && !canUseFingerprint ? (
              <Alert mt='md' color='gray' variant='light'>
                Para exigir o colocar huella necesita el permiso “Registrar huella” (Administración →
                Usuarios).
              </Alert>
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
                  Seleccione la persona y el tipo de caja. Quien solo valide puede llevar únicamente
                  «Validación» (sin firma ni huella).
                </Text>
                <SegmentedControl
                  mt='sm'
                  size='xs'
                  fullWidth
                  value={activeFieldKind}
                  onChange={(v) => setActiveFieldKind(v as SignatureFieldKind)}
                  data={[
                    { label: 'Firma', value: 'signature' },
                    ...(canUseFingerprint &&
                    assignedParticipants.some(
                      (p) => p.order === activeOrder && p.requireFingerprint
                    )
                      ? [{ label: 'Huella', value: 'fingerprint' as const }]
                      : []),
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
        pt='sm'
        mt={4}
        style={{ borderTop: '1px solid var(--app-border-subtle)', flexShrink: 0 }}
      >
        {editorStep === 2 ? (
          <Text size='sm' c='dimmed' fw={500}>
            {placedCount} de {assignedParticipants.length} participante(s) con cajas listas
          </Text>
        ) : (
          <Button variant='subtle' color='gray' onClick={onClose} disabled={saving} radius='md'>
            Cancelar
          </Button>
        )}

        <Group>
          {editorStep > 0 && (
            <Button
              variant='default'
              radius='md'
              onClick={() => setEditorStep((s) => clampStep(s - 1))}
              disabled={saving}
            >
              Atrás
            </Button>
          )}
          {editorStep < 2 ? (
            <Button
              radius='md'
              size='md'
              onClick={() => void goNext()}
              loading={saving}
              disabled={!assignmentsEditable && editorStep === 1}
            >
              Continuar
            </Button>
          ) : (
            <>
              <Button
                variant='default'
                radius='md'
                leftSection={saving ? <Loader size={14} /> : <IconDeviceFloppy size={16} />}
                onClick={() => void handleSave()}
                disabled={saving || !assignmentsEditable}
              >
                Guardar ubicaciones
              </Button>
              <Button
                color='teal'
                radius='md'
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
