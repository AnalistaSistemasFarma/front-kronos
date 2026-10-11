'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, MultiSelect, SegmentedControl, Stack, Text, Textarea, Title } from '@mantine/core';
import { sgcTouchComboboxProps } from '../SgcSelect';
import { IconBulb, IconCheck, IconPencil, IconUsersGroup } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import type { SgcMatrixSuggestion } from '../../../lib/sgc/flows/matrix';

/**
 * Revisores y aprobadores del documento (2026-10-05, decisión de Nicolás).
 * El solicitante los elige con esta misma pantalla, pero quedan SUGERIDOS;
 * quien ejecuta la primera tarea (quien crea el documento, de Calidad) y/o
 * Calidad los confirma con un clic («Aprobar sugerencia») o los reasigna.
 * Solo lo confirmado entra a las tareas. El modo de firma (en orden o en
 * paralelo) se elige en cada documento. La matriz de responsables solo
 * SUGIERE. Cada cambio pide motivo y queda en el historial.
 */
type Step = SgcRequestDetail['steps'][number];

export interface SgcSignersPanelProps {
  steps: Step[];
  canEdit: boolean;
  users: { value: string; label: string }[];
  suggestion: SgcMatrixSuggestion[] | null;
  /** Lo que guarde esta persona queda SUGERIDO (solicitante). */
  suggestOnly?: boolean;
  /** Puede confirmar con un clic lo sugerido (quien ejecuta la primera tarea y/o Calidad). */
  canConfirm?: boolean;
  onConfirm?: () => Promise<void>;
  onSave: (stepKey: string, signers: string[], mode: 'orden' | 'paralelo', reason: string) => Promise<void>;
}

const ROLE_OF_STEP: Record<string, 'revisor' | 'aprobador'> = { revision: 'revisor', aprobacion: 'aprobador' };

function StepEditor({ step, canEdit, users, suggestion, suggestOnly, onSave }: { step: Step } & Omit<SgcSignersPanelProps, 'steps' | 'canConfirm' | 'onConfirm'>) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string[]>((step.signers.length ? step.signers : step.suggested).map((s) => s.email));
  const [mode, setMode] = useState<'orden' | 'paralelo'>((step.mode as 'orden' | 'paralelo') ?? 'paralelo');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  // Sugerir (o reemplazar una sugerencia) no pide motivo; cambiar lo confirmado, sí.
  const initial = step.signers.length === 0;
  const role = ROLE_OF_STEP[step.key];
  const hint = suggestion?.find((s) => s.role === role);

  return (
    <Card withBorder radius='md' p='md' data-testid={`sgc-firmantes-${step.key}`}>
      <Group justify='space-between' mb='xs'>
        <Group gap={8}>
          <Text fw={600}>{step.name}</Text>
          <Badge variant='light' color={step.mode === 'orden' ? 'grape' : 'gray'} size='sm'>
            {step.mode === 'orden' ? 'Firma en orden' : 'Firma en paralelo'}
          </Badge>
          {step.pool && (
            <Badge variant='light' color='teal' size='sm'>
              + verificación de Calidad
            </Badge>
          )}
        </Group>
        {canEdit && !editing && !(suggestOnly && step.signers.length > 0) && (
          <Button size='xs' variant='light' leftSection={<IconPencil size={14} />} onClick={() => setEditing(true)} data-testid={`sgc-editar-firmantes-${step.key}`}>
            {suggestOnly ? (step.suggested.length ? 'Cambiar sugerencia' : 'Sugerir') : initial ? (step.suggested.length ? 'Reasignar' : 'Asignar') : 'Cambiar'}
          </Button>
        )}
      </Group>
      {!editing ? (
        step.signers.length ? (
          <Stack gap={2}>
            {step.signers.map((s) => (
              <Text key={s.email} size='sm'>
                {step.mode === 'orden' ? `${s.order}. ` : '• '}
                {s.name || s.email}
              </Text>
            ))}
          </Stack>
        ) : step.suggested.length ? (
          <Stack gap={2} data-testid={`sgc-firmantes-sugeridos-${step.key}`}>
            {step.suggested.map((s) => (
              <Group key={s.email} gap={6}>
                <Text size='sm'>
                  {step.mode === 'orden' ? `${s.order}. ` : '• '}
                  {s.name || s.email}
                </Text>
                <Badge variant='light' color='orange' size='xs'>
                  Sugerido
                </Badge>
              </Group>
            ))}
            <Text size='xs' c='dimmed'>
              Sugerido por {step.suggested[0].addedBy}. Pendiente de confirmación: aún no firma nadie.
            </Text>
          </Stack>
        ) : (
          <Text size='sm' c='dimmed'>
            Sin asignar.
          </Text>
        )
      ) : (
        <Stack gap='sm'>
          {hint && (hint.people.length > 0 || hint.cargos.length > 0) && (
            <Alert color='blue' variant='light' icon={<IconBulb size={16} />} p='xs'>
              <Text size='xs'>
                Sugerencia de la matriz{hint.fromExample ? ' (datos de ejemplo)' : ''}: {[...hint.people, ...hint.cargos.map((c) => `cargo ${c}`)].join(', ')}. Usted decide.
              </Text>
            </Alert>
          )}
          <MultiSelect comboboxProps={sgcTouchComboboxProps()}
            label={`Personas (${mode === 'orden' ? 'firman en el orden en que las elija' : 'firman todas a la vez'})`}
            data={users}
            value={value}
            onChange={setValue}
            searchable
            clearable
            nothingFoundMessage='No hay personas con permiso de gestión en el SGC'
            data-testid={`sgc-firmantes-select-${step.key}`}
          />
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as 'orden' | 'paralelo')}
            data={[
              { value: 'paralelo', label: 'En paralelo' },
              { value: 'orden', label: 'En orden' },
            ]}
            data-testid={`sgc-firmantes-modo-${step.key}`}
          />
          {!initial && (
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo del cambio' required minRows={2} autosize value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid={`sgc-firmantes-motivo-${step.key}`} />
          )}
          <Group justify='flex-end'>
            <Button variant='default' size='xs' onClick={() => setEditing(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              size='xs'
              loading={saving}
              disabled={value.length === 0 || (!initial && reason.trim().length < 5)}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(step.key, value, mode, reason.trim());
                  setEditing(false);
                  setReason('');
                } finally {
                  setSaving(false);
                }
              }}
              data-testid={`sgc-firmantes-guardar-${step.key}`}
            >
              Guardar
            </Button>
          </Group>
        </Stack>
      )}
    </Card>
  );
}

function ConfirmButton({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  return (
    <Button
      size='xs'
      color='teal'
      loading={saving}
      leftSection={<IconCheck size={14} />}
      onClick={async () => {
        setSaving(true);
        try {
          await onConfirm();
        } finally {
          setSaving(false);
        }
      }}
      data-testid='sgc-aprobar-sugerencia'
    >
      Aprobar sugerencia
    </Button>
  );
}

export default function SgcSignersPanel(props: SgcSignersPanelProps) {
  if (props.steps.length === 0) return null;
  return (
    <Card shadow='sm' p='lg' radius='md' withBorder mt='6' data-testid='sgc-firmantes'>
      <Title order={3} mb='xs' className='flex items-center gap-2'>
        <IconUsersGroup size={20} />
        Revisores y aprobadores
      </Title>
      <Text size='sm' c='dimmed' mb='md'>
        {props.suggestOnly
          ? 'Usted sugiere quién revisa y quién aprueba, y si firman en orden o en paralelo. Lo que elija queda «Sugerido» hasta que lo confirme o lo reasigne quien crea el documento (Aseguramiento de Calidad).'
          : props.canEdit
            ? 'Usted confirma o asigna quién revisa y quién aprueba, y elige si firman en orden o en paralelo. Puede cambiarlos durante el proceso; cada cambio queda en el historial con su motivo.'
            : 'Los confirma y cambia quien crea el documento (Aseguramiento de Calidad); el solicitante solo los sugiere.'}
      </Text>
      {props.canConfirm && props.onConfirm && (
        <Alert color='orange' variant='light' icon={<IconBulb size={16} />} mb='md' title='Hay firmantes o alcance sugeridos por el solicitante' data-testid='sgc-sugerencia-pendiente'>
          <Group justify='space-between' gap='xs'>
            <Text size='sm'>Revise lo marcado como «Sugerido». Puede aprobar la sugerencia completa (firmantes y alcance) o reasignar cada paso.</Text>
            <ConfirmButton onConfirm={props.onConfirm} />
          </Group>
        </Alert>
      )}
      <Stack gap='sm'>
        {props.steps.map((s) => (
          <StepEditor key={`${s.key}-${s.signers.map((x) => x.email).join(',')}-${s.suggested.map((x) => x.email).join(',')}-${s.mode}`} step={s} canEdit={props.canEdit} users={props.users} suggestion={props.suggestion} suggestOnly={props.suggestOnly} onSave={props.onSave} />
        ))}
      </Stack>
    </Card>
  );
}
