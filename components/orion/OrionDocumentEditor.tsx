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
  Stack,
  Text,
} from '@mantine/core';
import { IconDeviceFloppy, IconFileText, IconSend } from '@tabler/icons-react';
import {
  emptySignerSlot,
  mergeParticipantSources,
  resizeParticipantSlots,
  type OrionParticipant,
  type OrionUserOption,
} from '../../lib/orion/participants';
import type { SignatureFieldPlacement } from '../../lib/orion/signatureFields';
import type { OrionSignatureState } from '../../lib/orion/types';
import OrionEditorSteps, { editorStepSubtitle } from './OrionEditorSteps';
import OrionSignerAssignment from './OrionSignerAssignment';
import OrionSignersList from './OrionSignersList';
import SignaturePlacementCanvas from './SignaturePlacementCanvas';

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
  initialFields?: SignatureFieldPlacement[];
  state: OrionSignatureState;
  onStateUpdate: (state: OrionSignatureState) => void;
  onClose?: () => void;
  assignmentsEditable?: boolean;
};

const EDITOR_HEIGHT = 'min(62vh, 680px)';

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
  initialFields = [],
  state,
  onStateUpdate,
  onClose,
  assignmentsEditable = true,
}: Props) {
  const [editorStep, setEditorStep] = useState(0);
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
  const [fields, setFields] = useState<SignatureFieldPlacement[]>(initialFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFields(initialFields);
  }, [initialFields]);

  useEffect(() => {
    if (orderedParticipants.length && !orderedParticipants.some((p) => p.order === activeOrder)) {
      setActiveOrder(orderedParticipants[0]!.order);
    }
  }, [activeOrder, orderedParticipants]);

  const signerStatuses = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of state.signers ?? []) {
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
    assignedParticipants.every((p) => fields.some((f) => f.signerOrder === p.order));

  const handleSignerCountChange = useCallback((count: number) => {
    setSignerCount(count);
    setOrderedParticipants((prev) => resizeParticipantSlots(prev, count));
    setFields((prev) => prev.filter((f) => f.signerOrder <= count));
  }, []);

  const handleAssignSigner = useCallback((order: number, email: string, name: string) => {
    setOrderedParticipants((prev) =>
      prev.map((p) =>
        p.order === order
          ? { ...p, email: normalizeEmail(email), name: name.trim() || email, role: 'Firmante' }
          : p
      )
    );
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
        setOrderedParticipants((prev) => {
          const withoutMe = prev.filter((p) => normalizeEmail(p.email) !== me);
          const self: OrionParticipant = {
            order: 1,
            email: me,
            name: currentUserName?.trim() || me,
            role: 'Firmante',
          };
          const filled = [self, ...withoutMe.filter((p) => p.email)];
          const padded = resizeParticipantSlots(
            [...filled, ...withoutMe.filter((p) => !p.email)],
            signerCount
          );
          return reindexParticipants(padded);
        });
        return;
      }

      setOrderedParticipants((prev) =>
        resizeParticipantSlots(
          prev.map((p) =>
            normalizeEmail(p.email) === me ? emptySignerSlot(p.order) : p
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
    const emails = orderedParticipants.map((p) => p.email.toLowerCase());
    if (new Set(emails).size !== emails.length) {
      return 'No puede repetir el mismo firmante.';
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
            type: 'internal',
          })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudieron asignar los firmantes');
    if (data.state) onStateUpdate(data.state as OrionSignatureState);
  }, [fileId, onStateUpdate, orderedParticipants, requestId, sequential, validateAssignments]);

  const persistFields = useCallback(async () => {
    const res = await fetch('/api/integrations/orion/signature-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, fileId, signatureFields: fields }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'No se guardaron las ubicaciones en Orion');
    }
    if (data.state) {
      onStateUpdate(data.state as OrionSignatureState);
    } else {
      onStateUpdate({ ...state, signatureFields: fields });
    }
  }, [fields, fileId, onStateUpdate, requestId, state]);

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
    setEditorStep((s) => Math.min(2, s + 1));
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
            <Stack gap='md' maw={560}>
              <Paper withBorder p='md' radius='md' style={{ background: 'var(--app-surface)' }}>
                <Group gap='sm' mb='sm'>
                  <IconFileText size={20} style={{ opacity: 0.7 }} />
                  <Text size='sm' fw={600}>
                    Archivo del documento
                  </Text>
                </Group>
                <Text size='sm'>{fileName || 'Documento adjunto'}</Text>
              </Paper>

              <Box>
                <Text size='sm' fw={600} mb={4}>
                  Título
                </Text>
                <Text size='sm' c='dimmed'>
                  {documentTitle || fileName || 'Sin título'}
                </Text>
              </Box>

              <Box>
                <Text size='sm' fw={600} mb={8}>
                  Tipo de firma del documento
                </Text>
                <Paper
                  withBorder
                  p='sm'
                  radius='md'
                  style={{
                    background: 'color-mix(in srgb, var(--app-accent) 10%, var(--app-surface))',
                    borderColor: 'color-mix(in srgb, var(--app-accent) 40%, var(--app-border))',
                  }}
                >
                  <Text size='sm' fw={600}>
                    Firma electrónica
                  </Text>
                  <Text size='xs' c='dimmed' mt={4}>
                    Rúbrica e identidad del firmante. Ideal para flujos internos.
                  </Text>
                </Paper>
              </Box>
            </Stack>
          </ScrollArea>
        )}

        {editorStep === 1 && !assignmentsEditable && (
          <Alert color='gray' variant='light' mb='md'>
            La tarea o solicitud está cerrada. La asignación de firmantes es solo lectura.
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
              signerStatuses={signerStatuses}
              readOnly={!assignmentsEditable}
              onSignerCountChange={handleSignerCountChange}
              onSequentialChange={setSequential}
              onIncludeSelfChange={handleIncludeSelfChange}
              onAssign={handleAssignSigner}
              onClear={handleClearSigner}
              onReorder={signerCount > 1 && assignmentsEditable ? reorderParticipant : undefined}
            />
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
                  Seleccione un firmante y ubique su firma en el documento.
                </Text>
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
                pdfSrc={pdfSrc}
                documentId={documentId}
                participants={assignedParticipants}
                activeOrder={activeOrder}
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
            <Button variant='default' onClick={() => setEditorStep((s) => s - 1)} disabled={saving}>
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
