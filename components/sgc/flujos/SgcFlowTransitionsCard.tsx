'use client';

import { ActionIcon, Alert, Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import SgcSelect from '../SgcSelect';
import { IconAlertCircle, IconArrowRight, IconGitBranch, IconPlus, IconTrash } from '@tabler/icons-react';
import { SGC_ACTION_LABELS, type SgcFlowDefinition, type SgcTransitionDefinition } from '../../../lib/sgc/flows/definition';
import { SectionHeader } from './SgcFlowUi';
import { opts } from './SgcFlowTasksCard';

/**
 * «Transiciones» — qué pasa al aprobar, devolver o cancelar cada tarea. Usa
 * el mismo patrón visual de la tarjeta «Archivos requeridos» de
 * view-workflows (tarjeta celeste, filas en tarjetas con insignias). El
 * flujo general de SynerLink es lineal; el del SGC permite devolver a una
 * tarea anterior, por eso esta sección ocupa ese lugar.
 */

const ACTION_COLORS: Record<string, string> = { aprobar: 'green', devolver: 'orange', cancelar: 'red' };
const TERMINAL = [
  { value: 'completada', label: 'Completada' },
  { value: 'cancelada', label: 'Cancelada' },
];

interface Props {
  definition: SgcFlowDefinition;
  isEditing: boolean;
  onChange: (def: SgcFlowDefinition) => void;
}

export default function SgcFlowTransitionsCard({ definition, isEditing, onChange }: Props) {
  const transitions = definition.transitions;
  const taskOptions = definition.tasks.map((t) => ({ value: t.key, label: t.name }));
  const name = (key: string | null) => definition.tasks.find((t) => t.key === key)?.name ?? key ?? '—';
  const setTr = (i: number, patch: Partial<SgcTransitionDefinition>) => onChange({ ...definition, transitions: transitions.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const order = new Map(definition.tasks.map((t, i) => [t.key, i]));
  const ACTION_ORDER: Record<string, number> = { aprobar: 0, devolver: 1, cancelar: 2 };
  // En consulta se muestran por tarea de origen y acción; en edición, en el orden en que se agregaron.
  const rows = transitions.map((t, i) => ({ t, i }));
  if (!isEditing) rows.sort((a, b) => (order.get(a.t.from) ?? 99) - (order.get(b.t.from) ?? 99) || ACTION_ORDER[a.t.action] - ACTION_ORDER[b.t.action]);
  const add = () => onChange({ ...definition, transitions: [...transitions, { from: definition.tasks[0]?.key ?? '', action: 'aprobar', to: null, terminalStatus: 'completada' }] });

  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mt='6' style={{ backgroundColor: 'var(--mantine-color-cyan-light)' }} data-testid='sgc-flujo-transiciones'>
      <SectionHeader
        icon={<IconGitBranch size={24} color='white' />}
        box='bg-sky-500'
        title='Transiciones'
        titleClass='text-sky-700'
        subtitle='Qué pasa al aprobar, devolver o cancelar cada tarea: a qué tarea sigue o cómo se cierra la solicitud.'
        right={
          <>
            <Badge color='sky' size='lg' variant='light'>
              {transitions.length} {transitions.length === 1 ? 'transición' : 'transiciones'}
            </Badge>
            {isEditing && (
              <Button size='sm' leftSection={<IconPlus size={16} />} onClick={add} color='blue' variant='light' data-testid='sgc-flujo-agregar-transicion'>
                Agregar Transición
              </Button>
            )}
          </>
        }
      />

      {transitions.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} title='Sin transiciones' color='gray' variant='light'>
          Este flujo no tiene transiciones. Cada tarea necesita al menos «Aprobar / enviar».
          {isEditing && (
            <Button size='xs' mt='sm' leftSection={<IconPlus size={14} />} onClick={add} color='blue' variant='light'>
              Agregar primera transición
            </Button>
          )}
        </Alert>
      ) : (
        <Stack gap='sm'>
          {rows.map(({ t, i }) => (
            <Card key={i} withBorder radius='md' p='md' data-testid='sgc-flujo-transicion'>
              {isEditing ? (
                <Group align='flex-end' wrap='nowrap'>
                  <SgcSelect label='Desde' data={taskOptions} value={t.from} onChange={(v) => v && setTr(i, { from: v })} allowDeselect={false} style={{ flex: 1 }} />
                  <SgcSelect label='Acción' data={opts(SGC_ACTION_LABELS)} value={t.action} onChange={(v) => v && setTr(i, { action: v as SgcTransitionDefinition['action'] })} allowDeselect={false} w={190} />
                  <SgcSelect label='Hacia' data={taskOptions} value={t.to} onChange={(v) => setTr(i, { to: v, terminalStatus: v ? null : t.terminalStatus })} clearable placeholder='—' style={{ flex: 1 }} />
                  <SgcSelect
                    label='o cierra como'
                    data={TERMINAL}
                    value={t.terminalStatus}
                    onChange={(v) => setTr(i, { terminalStatus: (v as SgcTransitionDefinition['terminalStatus']) ?? null, to: v ? null : t.to })}
                    clearable
                    placeholder='—'
                    w={170}
                  />
                  <ActionIcon color='red' variant='subtle' size='lg' onClick={() => onChange({ ...definition, transitions: transitions.filter((_, j) => j !== i) })} title='Eliminar transición' mb={4}>
                    <IconTrash size={18} />
                  </ActionIcon>
                </Group>
              ) : (
                <Group justify='space-between'>
                  <Group gap='sm'>
                    <IconArrowRight size={18} className='text-sky-600' />
                    <Text size='md' fw={500}>
                      {name(t.from)}
                    </Text>
                  </Group>
                  <Group gap='xs'>
                    <Badge color={ACTION_COLORS[t.action]} variant='light' size='sm'>
                      {SGC_ACTION_LABELS[t.action]}
                    </Badge>
                    <Badge color={t.to ? 'blue' : t.terminalStatus === 'cancelada' ? 'red' : 'teal'} variant='light' size='sm' styles={{ root: { textTransform: 'none' } }}>
                      {t.to ? `→ ${name(t.to)}` : `Cierra: ${t.terminalStatus === 'cancelada' ? 'Cancelada' : 'Completada'}`}
                    </Badge>
                  </Group>
                </Group>
              )}
            </Card>
          ))}
        </Stack>
      )}
    </Card>
  );
}
