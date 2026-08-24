'use client';

import React, { useState } from 'react';
import { Button, Group, Modal, Textarea, Alert, Stack, Text } from '@mantine/core';
import {
  getAvailableActions,
  RESUME_FROM_REASSIGNMENT_ACTION,
  type WorkflowActionDef,
} from '../../../../../lib/document-management/workflowStates';

interface Props {
  idDocument: number;
  idDocumentVersion: number;
  state: string;
  canWrite: boolean;
  onDone: () => void;
}

// Color de botón por tipo de acción, solo para escaneabilidad visual (no cambia el permiso real).
function buttonColor(def: WorkflowActionDef): string {
  if (def.action === 'rechazar' || def.action === 'anular' || def.action === 'eliminar') return 'red';
  if (def.action === 'solicitar_ajustes' || def.action === 'reasignar') return 'yellow';
  return 'blue';
}

/**
 * Botones de acción para la tarea PENDIENTE de la versión actual, calculados
 * desde el mismo grafo puro de lib/document-management/workflowStates.ts que
 * usa el backend (workflowEngine.ts) para validar la transición. Mostrarlos
 * aquí es solo UX: la autorización real (permiso de escritura sobre la
 * empresa) se vuelve a validar en el servidor en cada POST.
 */
export default function TransitionActions({ idDocument, idDocumentVersion, state, canWrite, onDone }: Props) {
  const [pending, setPending] = useState<WorkflowActionDef | { action: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = getAvailableActions(state);
  const canResume = state === 'Reasignación';

  const run = async (action: string, reasonText: string | null) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/document-management/documents/${idDocument}/versions/${idDocumentVersion}/transition`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, reason: reasonText }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No se pudo ejecutar la acción');
        return;
      }
      setPending(null);
      setReason('');
      onDone();
    } catch {
      setError('Error de red al ejecutar la acción');
    } finally {
      setSaving(false);
    }
  };

  const handleClick = (def: WorkflowActionDef | { action: string; label: string }) => {
    const requiresReason = 'requiresReason' in def && def.requiresReason;
    if (requiresReason) {
      setPending(def);
      setError(null);
      return;
    }
    run(def.action, null);
  };

  if (!canWrite) {
    return (
      <Text size="sm" c="dimmed">
        No tiene permiso de gestión sobre esta empresa para accionar esta tarea.
      </Text>
    );
  }

  if (actions.length === 0 && !canResume) {
    return (
      <Text size="sm" c="dimmed">
        Este estado no tiene acciones pendientes.
      </Text>
    );
  }

  return (
    <>
      {error && (
        <Alert color="red" mb="sm">
          {error}
        </Alert>
      )}
      <Group gap="xs" wrap="wrap">
        {canResume && (
          <Button
            size="sm"
            loading={saving}
            onClick={() => run(RESUME_FROM_REASSIGNMENT_ACTION, null)}
          >
            Reanudar
          </Button>
        )}
        {actions.map((def) => (
          <Button
            key={def.action}
            size="sm"
            color={buttonColor(def)}
            loading={saving}
            onClick={() => handleClick(def)}
          >
            {def.label}
          </Button>
        ))}
      </Group>

      <Modal opened={!!pending} onClose={() => setPending(null)} title={pending?.label ?? ''} size="md">
        <Stack gap="sm">
          {error && <Alert color="red">{error}</Alert>}
          <Textarea
            label="Motivo (obligatorio)"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            minRows={3}
            autoFocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPending(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              loading={saving}
              disabled={!reason.trim()}
              onClick={() => pending && run(pending.action, reason)}
            >
              Confirmar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
