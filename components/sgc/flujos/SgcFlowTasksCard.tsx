'use client';

import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Grid, Group, NumberInput, ScrollArea, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertCircle, IconCalendarTime, IconChevronDown, IconChevronUp, IconKey, IconListCheck, IconPlus, IconShieldCheck, IconSignature, IconTag, IconTrash, IconUserCheck, IconUsers } from '@tabler/icons-react';
import {
  SGC_ASSIGNMENT_LABELS,
  SGC_CONDITION_LABELS,
  SGC_ROLE_LABELS,
  SGC_SIGNATURE_LABELS,
  type SgcFlowDefinition,
  type SgcTaskDefinition,
} from '../../../lib/sgc/flows/definition';
import { InfoBox, SectionHeader } from './SgcFlowUi';

/**
 * «Flujo de Actividades» — COPIA CONGELADA de la tarjeta de tareas de
 * view-workflows de SynerLink (mismas tarjetas numeradas, conectores y cajas
 * de datos). Los conceptos del SGC (firma con significado, en orden o en
 * paralelo, grupo de verificación de Calidad, asignación «alcance»,
 * condición de catálogo cerrado, tarea habilitada) van como insignias y
 * campos dentro del mismo patrón.
 */

export const opts = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export interface SgcAuthTypeOption {
  value: string;
  label: string;
}

export function authTypeLabel(types: SgcAuthTypeOption[], code: string | null): string {
  if (!code) return '';
  return types.find((t) => t.value === code)?.label ?? code;
}

interface Props {
  definition: SgcFlowDefinition;
  isEditing: boolean;
  originalKeys: Set<string>;
  authorizationTypes: SgcAuthTypeOption[];
  onChange: (def: SgcFlowDefinition) => void;
  onAddTask: () => void;
}

export default function SgcFlowTasksCard({ definition, isEditing, originalKeys, authorizationTypes, onChange, onAddTask }: Props) {
  const tasks = definition.tasks;
  const setTask = (i: number, patch: Partial<SgcTaskDefinition>) => onChange({ ...definition, tasks: tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= tasks.length) return;
    const next = [...tasks];
    const a = next[i];
    const b = next[j];
    next[i] = { ...b, stepOrder: a.stepOrder };
    next[j] = { ...a, stepOrder: b.stepOrder };
    onChange({ ...definition, tasks: next });
  };
  const remove = (key: string) =>
    onChange({
      tasks: tasks.filter((t) => t.key !== key),
      transitions: definition.transitions.filter((tr) => tr.from !== key && tr.to !== key),
      formFields: definition.formFields.filter((f) => f.taskKey !== key),
    });

  return (
    <Card shadow='sm' p='xl' radius='md' withBorder className='h-full' style={{ backgroundColor: 'var(--mantine-color-orange-light)' }} data-testid='sgc-flujo-actividades'>
      <SectionHeader
        icon={<IconListCheck size={24} color='white' />}
        box='bg-amber-500'
        title='Flujo de Actividades'
        titleClass='text-amber-700'
        right={
          <>
            <Badge color='amber' size='lg' variant='light'>
              {tasks.length} {tasks.length === 1 ? 'tarea' : 'tareas'}
            </Badge>
            {isEditing && (
              <Button size='sm' leftSection={<IconPlus size={16} />} onClick={onAddTask} color='blue' variant='light' data-testid='sgc-flujo-agregar-tarea'>
                Agregar Tarea
              </Button>
            )}
          </>
        }
      />

      {tasks.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} title='Sin tareas' color='gray' variant='light'>
          Este flujo de trabajo no tiene tareas asignadas.
          {isEditing && (
            <Button size='xs' mt='sm' leftSection={<IconPlus size={14} />} onClick={onAddTask} color='blue' variant='light'>
              Agregar primera tarea
            </Button>
          )}
        </Alert>
      ) : (
        <ScrollArea>
          <div className='space-y-0'>
            {tasks.map((task, index) => {
              const active = task.isEnabled;
              const isNew = !originalKeys.has(task.key);
              return (
                <div key={`${task.key}-${index}`} className='relative'>
                  <Card
                    shadow='sm'
                    p='md'
                    radius='lg'
                    withBorder
                    data-testid='sgc-flujo-tarea'
                    className={`
                      transition-all duration-200 ease-in-out
                      ${active ? 'bg-[var(--mantine-color-body)] border-amber-300 hover:border-amber-400 hover:shadow-md' : 'bg-[var(--mantine-color-default)] border-[var(--mantine-color-default-border)] opacity-75'}
                      ${isNew && isEditing ? 'border-blue-400 border-dashed' : ''}
                    `}
                  >
                    <Grid>
                      <Grid.Col span={{ base: 12, md: 1 }}>
                        <div
                          className={`
                            w-12 h-12 rounded-full flex items-center justify-center
                            transition-all duration-200
                            ${active ? 'bg-amber-500 text-white shadow-lg shadow-amber-200' : 'bg-gray-300 text-gray-600'}
                          `}
                          data-testid='sgc-flujo-tarea-numero'
                        >
                          <Text size='lg' fw={700}>
                            {index + 1}
                          </Text>
                        </div>
                      </Grid.Col>

                      <Grid.Col span={{ base: 12, md: 10 }}>
                        <Stack gap='xs'>
                          <Group justify='space-between' align='flex-start'>
                            <div style={{ flex: 1 }}>
                              {isEditing ? (
                                <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' value={task.name} onChange={(e) => setTask(index, { name: e.target.value })} placeholder='Nombre de la tarea' data-testid='sgc-flujo-tarea-nombre' />
                              ) : (
                                <Group gap='xs'>
                                  <Text size='md' fw={600} className='mb-1'>
                                    {task.name}
                                  </Text>
                                  {task.multiAssignee && task.signingModeDefault && (
                                    <Badge color='indigo' variant='light' size='sm'>
                                      {task.signingModeDefault === 'orden' ? 'En orden' : 'En paralelo'}
                                    </Badge>
                                  )}
                                  {task.isAuthorization && (
                                    <Badge color='teal' variant='light' size='sm'>
                                      {authTypeLabel(authorizationTypes, task.authorizationTypeCode) || 'Autorización'}
                                    </Badge>
                                  )}
                                  {task.signatureMeaning && (
                                    <Badge color='violet' variant='light' size='sm'>
                                      Firma: {SGC_SIGNATURE_LABELS[task.signatureMeaning]}
                                    </Badge>
                                  )}
                                  {task.poolAuthorizationTypeCode && (
                                    <Badge color='cyan' variant='light' size='sm' styles={{ root: { textTransform: 'none' } }}>
                                      {task.assignment === 'alcance' ? 'Administra' : 'Verificación'}: {authTypeLabel(authorizationTypes, task.poolAuthorizationTypeCode)}
                                    </Badge>
                                  )}
                                  {task.conditionKey && (
                                    <Badge color='grape' variant='light' size='sm' styles={{ root: { textTransform: 'none' } }}>
                                      Si: {SGC_CONDITION_LABELS[task.conditionKey]}
                                    </Badge>
                                  )}
                                  {!task.isEnabled && (
                                    <Badge color='gray' variant='light' size='sm'>
                                      Deshabilitada
                                    </Badge>
                                  )}
                                </Group>
                              )}
                            </div>
                            {isEditing && (
                              <Group gap={4} wrap='nowrap'>
                                <ActionIcon variant='subtle' color='gray' onClick={() => move(index, -1)} disabled={index === 0} title='Subir'>
                                  <IconChevronUp size={18} />
                                </ActionIcon>
                                <ActionIcon variant='subtle' color='gray' onClick={() => move(index, 1)} disabled={index === tasks.length - 1} title='Bajar'>
                                  <IconChevronDown size={18} />
                                </ActionIcon>
                                <ActionIcon color='red' variant='subtle' size='lg' onClick={() => remove(task.key)} title='Eliminar tarea'>
                                  <IconTrash size={18} />
                                </ActionIcon>
                              </Group>
                            )}
                          </Group>

                          {isEditing && task.multiAssignee && (
                            <Select
                              label='Firmantes: en orden o en paralelo (por defecto; el elaborador lo puede cambiar por documento)'
                              data={[
                                { value: 'paralelo', label: 'En paralelo' },
                                { value: 'orden', label: 'En orden' },
                              ]}
                              value={task.signingModeDefault}
                              onChange={(v) => setTask(index, { signingModeDefault: (v as 'orden' | 'paralelo') ?? 'paralelo' })}
                              allowDeselect={false}
                              maw={400}
                            />
                          )}

                          {isEditing && (
                            <Checkbox
                              label='Tarea de autorización'
                              checked={task.isAuthorization}
                              onChange={(e) => {
                                const checked = e.currentTarget.checked;
                                setTask(index, { isAuthorization: checked, authorizationTypeCode: checked ? task.authorizationTypeCode : null });
                              }}
                            />
                          )}

                          {isEditing && task.isAuthorization && (
                            <Select
                              label='Tipo de autorización'
                              placeholder='Seleccione el tipo'
                              data={authorizationTypes}
                              value={task.authorizationTypeCode}
                              onChange={(v) => setTask(index, { authorizationTypeCode: v })}
                              searchable
                              withAsterisk
                              error={!task.authorizationTypeCode ? 'Selecciona el tipo de autorización' : undefined}
                              maw={400}
                            />
                          )}

                          {isEditing && (
                            <Checkbox
                              label='Habilitada: si no, queda definida pero el motor deja la solicitud en espera'
                              checked={task.isEnabled}
                              onChange={(e) => setTask(index, { isEnabled: e.currentTarget.checked })}
                            />
                          )}

                          {isEditing && index > 0 && (
                            <Select
                              mt='sm'
                              label='Ejecutar esta tarea solo si'
                              placeholder='Siempre (sin condición)'
                              data={opts(SGC_CONDITION_LABELS)}
                              value={task.conditionKey}
                              onChange={(v) => setTask(index, { conditionKey: (v as SgcTaskDefinition['conditionKey']) ?? null })}
                              clearable
                              leftSection={<IconTag size={16} />}
                            />
                          )}

                          <Grid mt='sm'>
                            <Grid.Col span={{ base: 12, sm: 4 }}>
                              <InfoBox icon={<IconUserCheck size={16} style={{ color: 'var(--mantine-color-dimmed)' }} />} label='Asignado a'>
                                {isEditing ? (
                                  <Select
                                    value={task.assignment}
                                    onChange={(v) =>
                                      v &&
                                      setTask(index, {
                                        assignment: v as SgcTaskDefinition['assignment'],
                                        multiAssignee: v === 'firmantes',
                                        signingModeDefault: v === 'firmantes' ? task.signingModeDefault ?? 'paralelo' : null,
                                      })
                                    }
                                    data={opts(SGC_ASSIGNMENT_LABELS)}
                                    allowDeselect={false}
                                    size='sm'
                                  />
                                ) : (
                                  <Text size='sm' fw={500}>
                                    {SGC_ASSIGNMENT_LABELS[task.assignment]}
                                  </Text>
                                )}
                              </InfoBox>
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, sm: 4 }}>
                              <InfoBox icon={<IconUsers size={16} style={{ color: 'var(--mantine-color-dimmed)' }} />} label='Rol'>
                                {isEditing ? (
                                  <Select value={task.role} onChange={(v) => v && setTask(index, { role: v as SgcTaskDefinition['role'] })} data={opts(SGC_ROLE_LABELS)} allowDeselect={false} size='sm' />
                                ) : (
                                  <Text size='sm' fw={500}>
                                    {SGC_ROLE_LABELS[task.role]}
                                  </Text>
                                )}
                              </InfoBox>
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, sm: 4 }}>
                              <InfoBox icon={<IconCalendarTime size={16} className='text-green-600' />} label='Días objetivo'>
                                {isEditing ? (
                                  <NumberInput value={task.targetDays ?? ''} onChange={(v) => setTask(index, { targetDays: v === '' ? null : Number(v) })} placeholder='Sin plazo' min={1} max={365} size='sm' hideControls />
                                ) : (
                                  <Text size='sm' fw={600} c='green.7'>
                                    {task.targetDays ? `${task.targetDays} ${task.targetDays === 1 ? 'día' : 'días'}` : 'Sin plazo'}
                                  </Text>
                                )}
                              </InfoBox>
                            </Grid.Col>
                            {isEditing && (
                              <>
                                <Grid.Col span={{ base: 12, sm: 4 }}>
                                  <InfoBox icon={<IconSignature size={16} style={{ color: 'var(--mantine-color-dimmed)' }} />} label='Firma (significado)'>
                                    <Select
                                      value={task.signatureMeaning}
                                      onChange={(v) => setTask(index, { signatureMeaning: (v as SgcTaskDefinition['signatureMeaning']) ?? null })}
                                      data={opts(SGC_SIGNATURE_LABELS)}
                                      placeholder='Sin firma'
                                      clearable
                                      size='sm'
                                    />
                                  </InfoBox>
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, sm: 4 }}>
                                  <InfoBox icon={<IconShieldCheck size={16} style={{ color: 'var(--mantine-color-dimmed)' }} />} label='Grupo de verificación'>
                                    <Select
                                      value={task.poolAuthorizationTypeCode}
                                      onChange={(v) => setTask(index, { poolAuthorizationTypeCode: v })}
                                      data={authorizationTypes}
                                      placeholder='Ninguno'
                                      clearable
                                      size='sm'
                                    />
                                  </InfoBox>
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, sm: 4 }}>
                                  <InfoBox icon={<IconKey size={16} style={{ color: 'var(--mantine-color-dimmed)' }} />} label='Clave'>
                                    {isNew ? (
                                      <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' value={task.key} onChange={(e) => setTask(index, { key: e.target.value })} size='sm' data-testid='sgc-flujo-tarea-clave' />
                                    ) : (
                                      <Text size='sm' fw={500} ff='monospace'>
                                        {task.key}
                                      </Text>
                                    )}
                                  </InfoBox>
                                </Grid.Col>
                              </>
                            )}
                          </Grid>
                        </Stack>
                      </Grid.Col>
                    </Grid>
                  </Card>

                  {index < tasks.length - 1 && (
                    <div className='flex justify-center py-3'>
                      <div className={`w-1 h-12 rounded-full transition-all duration-300 ${active ? 'bg-gradient-to-b from-amber-400 to-amber-200' : 'bg-gray-300'}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </Card>
  );
}
