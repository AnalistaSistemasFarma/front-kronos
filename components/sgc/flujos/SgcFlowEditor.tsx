'use client';

import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, NumberInput, ScrollArea, Select, Stack, Table, Text, TextInput, Textarea, Title, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  SGC_ACTION_LABELS,
  SGC_ASSIGNMENT_LABELS,
  SGC_CONDITION_LABELS,
  SGC_FIELD_TYPE_LABELS,
  SGC_ROLE_LABELS,
  SGC_SIGNATURE_LABELS,
  type SgcFlowDefinition,
  type SgcFormFieldDefinition,
  type SgcTaskDefinition,
  type SgcTransitionDefinition,
} from '../../../lib/sgc/flows/definition';

/**
 * Editor SIN CÓDIGO de la definición de un flujo validado (tareas,
 * responsables, firmas, condiciones, transiciones y formularios). COPIA
 * CONGELADA del modelo del administrador de workflows de SynerLink,
 * reescrita para el SGC: solo edita BORRADORES; guardar pide motivo y queda
 * en el registro de cambios.
 */

const opts = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

function newTask(order: number): SgcTaskDefinition {
  return {
    key: `tarea_${order}`,
    name: 'Nueva tarea',
    stepOrder: order,
    role: 'revisor',
    assignment: 'elaborador',
    multiAssignee: false,
    signingModeDefault: null,
    signatureMeaning: null,
    targetDays: null,
    conditionKey: null,
    isAuthorization: false,
    authorizationTypeCode: null,
    poolAuthorizationTypeCode: null,
    isEnabled: true,
    description: null,
  };
}

export interface SgcFlowEditorProps {
  definition: SgcFlowDefinition;
  editable: boolean;
  authorizationTypes: { code: string; name: string }[];
  onSave: (def: SgcFlowDefinition, reason: string) => Promise<void>;
}

export default function SgcFlowEditor({ definition, editable, authorizationTypes, onSave }: SgcFlowEditorProps) {
  const [def, setDef] = useState<SgcFlowDefinition>(definition);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setDef(definition), [definition]);
  const dirty = JSON.stringify(def) !== JSON.stringify(definition);
  const taskOptions = def.tasks.map((t) => ({ value: t.key, label: `${t.stepOrder}. ${t.name}` }));
  const typeOptions = authorizationTypes.map((t) => ({ value: t.code, label: `${t.code} · ${t.name}` }));

  const setTask = (i: number, patch: Partial<SgcTaskDefinition>) => setDef((d) => ({ ...d, tasks: d.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const setTr = (i: number, patch: Partial<SgcTransitionDefinition>) => setDef((d) => ({ ...d, transitions: d.transitions.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const setField = (i: number, patch: Partial<SgcFormFieldDefinition>) => setDef((d) => ({ ...d, formFields: d.formFields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const ro = !editable;

  return (
    <Stack gap='md' data-testid='sgc-editor-flujo'>
      <Card withBorder radius='md' p='md'>
        <Group justify='space-between' mb='sm'>
          <Title order={4}>Tareas</Title>
          {editable && (
            <Button size='xs' variant='light' leftSection={<IconPlus size={14} />} onClick={() => setDef((d) => ({ ...d, tasks: [...d.tasks, newTask(Math.max(0, ...d.tasks.map((t) => t.stepOrder)) + 1)] }))} data-testid='sgc-flujo-agregar-tarea'>
              Agregar tarea
            </Button>
          )}
        </Group>
        <ScrollArea type='auto'>
          <Table withTableBorder striped miw={1500} verticalSpacing='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Orden</Table.Th>
                <Table.Th>Clave</Table.Th>
                <Table.Th>Nombre</Table.Th>
                <Table.Th>Rol</Table.Th>
                <Table.Th>Responsable</Table.Th>
                <Table.Th>Varios / modo</Table.Th>
                <Table.Th>Firma</Table.Th>
                <Table.Th>Días</Table.Th>
                <Table.Th>Condición</Table.Th>
                <Table.Th>Autorización</Table.Th>
                <Table.Th>Grupo verificación</Table.Th>
                <Table.Th>Habilitada</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {def.tasks.map((t, i) => (
                <Table.Tr key={i} data-testid='sgc-flujo-tarea'>
                  <Table.Td w={80}>
                    <NumberInput size='xs' value={t.stepOrder} min={0} max={99} disabled={ro} onChange={(v) => setTask(i, { stepOrder: Number(v) || 0 })} />
                  </Table.Td>
                  <Table.Td w={140}>
                    <TextInput size='xs' value={t.key} disabled={ro} onChange={(e) => setTask(i, { key: e.currentTarget.value })} data-testid='sgc-flujo-tarea-clave' />
                  </Table.Td>
                  <Table.Td w={180}>
                    <TextInput size='xs' value={t.name} disabled={ro} onChange={(e) => setTask(i, { name: e.currentTarget.value })} data-testid='sgc-flujo-tarea-nombre' />
                  </Table.Td>
                  <Table.Td w={150}>
                    <Select size='xs' data={opts(SGC_ROLE_LABELS)} value={t.role} disabled={ro} allowDeselect={false} onChange={(v) => v && setTask(i, { role: v as SgcTaskDefinition['role'] })} />
                  </Table.Td>
                  <Table.Td w={200}>
                    <Select
                      size='xs'
                      data={opts(SGC_ASSIGNMENT_LABELS)}
                      value={t.assignment}
                      disabled={ro}
                      allowDeselect={false}
                      onChange={(v) => v && setTask(i, { assignment: v as SgcTaskDefinition['assignment'], multiAssignee: v === 'firmantes', signingModeDefault: v === 'firmantes' ? t.signingModeDefault ?? 'paralelo' : null })}
                    />
                  </Table.Td>
                  <Table.Td w={130}>
                    {t.multiAssignee ? (
                      <Select size='xs' data={[{ value: 'paralelo', label: 'En paralelo' }, { value: 'orden', label: 'En orden' }]} value={t.signingModeDefault} disabled={ro} allowDeselect={false} onChange={(v) => setTask(i, { signingModeDefault: v as 'orden' | 'paralelo' })} />
                    ) : (
                      <Text size='xs' c='dimmed'>
                        Uno
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td w={130}>
                    <Select size='xs' data={opts(SGC_SIGNATURE_LABELS)} value={t.signatureMeaning} clearable disabled={ro} placeholder='Sin firma' onChange={(v) => setTask(i, { signatureMeaning: (v as SgcTaskDefinition['signatureMeaning']) ?? null })} />
                  </Table.Td>
                  <Table.Td w={80}>
                    <NumberInput size='xs' value={t.targetDays ?? ''} min={1} max={365} disabled={ro} onChange={(v) => setTask(i, { targetDays: v === '' ? null : Number(v) })} />
                  </Table.Td>
                  <Table.Td w={200}>
                    <Select size='xs' data={opts(SGC_CONDITION_LABELS)} value={t.conditionKey} clearable disabled={ro} placeholder='Siempre' onChange={(v) => setTask(i, { conditionKey: (v as SgcTaskDefinition['conditionKey']) ?? null })} />
                  </Table.Td>
                  <Table.Td w={200}>
                    <Group gap={4} wrap='nowrap'>
                      <Checkbox checked={t.isAuthorization} disabled={ro} onChange={(e) => setTask(i, { isAuthorization: e.currentTarget.checked, authorizationTypeCode: e.currentTarget.checked ? t.authorizationTypeCode : null })} />
                      {t.isAuthorization && (
                        <Select size='xs' data={typeOptions} value={t.authorizationTypeCode} disabled={ro} onChange={(v) => setTask(i, { authorizationTypeCode: v })} placeholder='Tipo' />
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td w={200}>
                    <Select size='xs' data={typeOptions} value={t.poolAuthorizationTypeCode} clearable disabled={ro} placeholder='Ninguno' onChange={(v) => setTask(i, { poolAuthorizationTypeCode: v })} />
                  </Table.Td>
                  <Table.Td w={80}>
                    <Tooltip label='Deshabilitada: definida, pero el motor la deja en espera'>
                      <Checkbox checked={t.isEnabled} disabled={ro} onChange={(e) => setTask(i, { isEnabled: e.currentTarget.checked })} />
                    </Tooltip>
                  </Table.Td>
                  <Table.Td w={40}>
                    {editable && (
                      <ActionIcon variant='subtle' color='red' onClick={() => setDef((d) => ({ ...d, tasks: d.tasks.filter((_, j) => j !== i) }))} aria-label='Quitar tarea'>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>

      <Card withBorder radius='md' p='md'>
        <Group justify='space-between' mb='sm'>
          <Title order={4}>Transiciones</Title>
          {editable && (
            <Button size='xs' variant='light' leftSection={<IconPlus size={14} />} onClick={() => setDef((d) => ({ ...d, transitions: [...d.transitions, { from: d.tasks[0]?.key ?? '', action: 'aprobar', to: null, terminalStatus: 'completada' }] }))} data-testid='sgc-flujo-agregar-transicion'>
              Agregar transición
            </Button>
          )}
        </Group>
        <Table withTableBorder striped verticalSpacing='xs'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Desde</Table.Th>
              <Table.Th>Acción</Table.Th>
              <Table.Th>Hacia</Table.Th>
              <Table.Th>o cierra como</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {def.transitions.map((t, i) => (
              <Table.Tr key={i} data-testid='sgc-flujo-transicion'>
                <Table.Td>
                  <Select size='xs' data={taskOptions} value={t.from} disabled={ro} allowDeselect={false} onChange={(v) => v && setTr(i, { from: v })} />
                </Table.Td>
                <Table.Td>
                  <Select size='xs' data={opts(SGC_ACTION_LABELS)} value={t.action} disabled={ro} allowDeselect={false} onChange={(v) => v && setTr(i, { action: v as SgcTransitionDefinition['action'] })} />
                </Table.Td>
                <Table.Td>
                  <Select size='xs' data={taskOptions} value={t.to} clearable disabled={ro} placeholder='—' onChange={(v) => setTr(i, { to: v, terminalStatus: v ? null : t.terminalStatus })} />
                </Table.Td>
                <Table.Td>
                  <Select
                    size='xs'
                    data={[{ value: 'completada', label: 'Completada' }, { value: 'cancelada', label: 'Cancelada' }]}
                    value={t.terminalStatus}
                    clearable
                    disabled={ro}
                    placeholder='—'
                    onChange={(v) => setTr(i, { terminalStatus: (v as 'completada' | 'cancelada') ?? null, to: v ? null : t.to })}
                  />
                </Table.Td>
                <Table.Td w={40}>
                  {editable && (
                    <ActionIcon variant='subtle' color='red' onClick={() => setDef((d) => ({ ...d, transitions: d.transitions.filter((_, j) => j !== i) }))} aria-label='Quitar transición'>
                      <IconTrash size={14} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder radius='md' p='md'>
        <Group justify='space-between' mb='sm'>
          <Title order={4}>Formularios y campos</Title>
          {editable && (
            <Button
              size='xs'
              variant='light'
              leftSection={<IconPlus size={14} />}
              onClick={() => setDef((d) => ({ ...d, formFields: [...d.formFields, { taskKey: null, key: `campo_${d.formFields.length + 1}`, label: 'Nuevo campo', type: 'texto', required: false, options: [], helpText: null, sortOrder: d.formFields.length + 1 }] }))}
              data-testid='sgc-flujo-agregar-campo'
            >
              Agregar campo
            </Button>
          )}
        </Group>
        <ScrollArea type='auto'>
          <Table withTableBorder striped miw={1000} verticalSpacing='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Formulario</Table.Th>
                <Table.Th>Clave</Table.Th>
                <Table.Th>Etiqueta</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Opciones (separadas por ;)</Table.Th>
                <Table.Th>Obligatorio</Table.Th>
                <Table.Th>Chequeo Calidad</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {def.formFields.map((f, i) => (
                <Table.Tr key={i} data-testid='sgc-flujo-campo'>
                  <Table.Td w={180}>
                    <Select size='xs' data={[{ value: '__solicitud', label: 'Solicitud' }, ...taskOptions]} value={f.taskKey ?? '__solicitud'} disabled={ro} allowDeselect={false} onChange={(v) => setField(i, { taskKey: v === '__solicitud' ? null : v })} />
                  </Table.Td>
                  <Table.Td w={150}>
                    <TextInput size='xs' value={f.key} disabled={ro} onChange={(e) => setField(i, { key: e.currentTarget.value })} data-testid='sgc-flujo-campo-clave' />
                  </Table.Td>
                  <Table.Td>
                    <TextInput size='xs' value={f.label} disabled={ro} onChange={(e) => setField(i, { label: e.currentTarget.value })} data-testid='sgc-flujo-campo-etiqueta' />
                  </Table.Td>
                  <Table.Td w={150}>
                    <Select size='xs' data={opts(SGC_FIELD_TYPE_LABELS)} value={f.type} disabled={ro} allowDeselect={false} onChange={(v) => v && setField(i, { type: v as SgcFormFieldDefinition['type'] })} />
                  </Table.Td>
                  <Table.Td>
                    <TextInput size='xs' value={f.options.join('; ')} disabled={ro || f.type !== 'seleccion'} onChange={(e) => setField(i, { options: e.currentTarget.value.split(';').map((o) => o.trim()) })} />
                  </Table.Td>
                  <Table.Td w={90}>
                    <Checkbox checked={f.required} disabled={ro} onChange={(e) => setField(i, { required: e.currentTarget.checked })} />
                  </Table.Td>
                  <Table.Td w={110}>
                    <Checkbox
                      checked={Boolean(f.qualityCheck)}
                      disabled={ro || !f.taskKey}
                      title='Punto de la lista de chequeo de estructura documental que responde el grupo de Calidad al firmar (Cumple / No cumple / No aplica).'
                      onChange={(e) => setField(i, { qualityCheck: e.currentTarget.checked })}
                      data-testid='sgc-flujo-campo-chequeo'
                    />
                  </Table.Td>
                  <Table.Td w={40}>
                    {editable && (
                      <ActionIcon variant='subtle' color='red' onClick={() => setDef((d) => ({ ...d, formFields: d.formFields.filter((_, j) => j !== i) }))} aria-label='Quitar campo'>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>

      {editable ? (
        <Card withBorder radius='md' p='md'>
          <Stack gap='xs'>
            <Group gap='xs'>
              <Badge color={dirty ? 'orange' : 'gray'} variant='light'>
                {dirty ? 'Cambios sin guardar' : 'Sin cambios'}
              </Badge>
              <Text size='xs' c='dimmed'>
                Guardar valida la definición completa (claves, órdenes, transiciones y cierre) y deja el antes/después en el registro de cambios.
              </Text>
            </Group>
            <Textarea label='Motivo del cambio' required minRows={2} autosize value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-testid='sgc-flujo-motivo' />
            <Group justify='flex-end'>
              <Button variant='default' disabled={!dirty || saving} onClick={() => setDef(definition)}>
                Descartar cambios
              </Button>
              <Button
                disabled={!dirty || reason.trim().length < 5}
                loading={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave(def, reason.trim());
                    setReason('');
                  } finally {
                    setSaving(false);
                  }
                }}
                data-testid='sgc-flujo-guardar'
              >
                Guardar borrador
              </Button>
            </Group>
          </Stack>
        </Card>
      ) : (
        <Alert color='gray' icon={<IconAlertCircle size={16} />}>
          Esta versión no es un borrador: no se edita. Cree una nueva versión para cambiar el flujo (las solicitudes en curso conservan su versión).
        </Alert>
      )}
    </Stack>
  );
}
