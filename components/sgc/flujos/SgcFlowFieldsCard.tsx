'use client';

import { useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, Stack, Text, TextInput } from '@mantine/core';
import SgcSelect from '../SgcSelect';
import { IconAlertCircle, IconPlus, IconTag, IconTrash, IconX } from '@tabler/icons-react';
import { SGC_FIELD_TYPE_LABELS, type SgcFlowDefinition, type SgcFormFieldDefinition } from '../../../lib/sgc/flows/definition';
import { SectionHeader } from './SgcFlowUi';
import { opts } from './SgcFlowTasksCard';

/**
 * «Campos del formulario» — COPIA CONGELADA de la tarjeta «Campos
 * condicionales» de view-workflows (misma tarjeta índigo, mismas insignias y
 * el mismo editor de opciones). En el SGC cada campo pertenece a la
 * solicitud o a una tarea, y los marcados «Chequeo Calidad» forman la lista
 * de chequeo de estructura documental que responde el grupo de verificación.
 */

interface Props {
  definition: SgcFlowDefinition;
  isEditing: boolean;
  originalFieldIds: Set<string>;
  onChange: (def: SgcFlowDefinition) => void;
}

const fieldId = (f: SgcFormFieldDefinition) => `${f.taskKey ?? ''}:${f.key}`;

export default function SgcFlowFieldsCard({ definition, isEditing, originalFieldIds, onChange }: Props) {
  const fields = definition.formFields;
  const [optionInputs, setOptionInputs] = useState<Record<number, string>>({});
  const taskOptions = definition.tasks.map((t) => ({ value: t.key, label: t.name }));
  const formLabel = (taskKey: string | null) => (taskKey ? definition.tasks.find((t) => t.key === taskKey)?.name ?? taskKey : 'Solicitud');
  const setField = (i: number, patch: Partial<SgcFormFieldDefinition>) => onChange({ ...definition, formFields: fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const add = () => {
    let n = fields.length + 1;
    while (fields.some((f) => f.key === `campo_${n}` && f.taskKey === null)) n++;
    const key = `campo_${n}`;
    onChange({ ...definition, formFields: [...fields, { taskKey: null, key, label: '', type: 'texto', required: false, options: [], helpText: null, sortOrder: Math.max(0, ...fields.map((f) => f.sortOrder)) + 1, qualityCheck: false }] });
  };
  const addOption = (i: number) => {
    const label = (optionInputs[i] || '').trim();
    if (!label) return;
    setField(i, { options: [...fields[i].options, label] });
    setOptionInputs((p) => ({ ...p, [i]: '' }));
  };

  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mt='6' style={{ backgroundColor: 'var(--mantine-color-indigo-light)' }} data-testid='sgc-flujo-campos'>
      <SectionHeader
        icon={<IconTag size={24} color='white' />}
        box='bg-indigo-500'
        title='Campos del formulario'
        titleClass='text-indigo-700'
        subtitle='Campos de la solicitud y de cada tarea; los marcados «Chequeo Calidad» forman la lista de chequeo de estructura documental.'
        right={
          <>
            <Badge color='indigo' size='lg' variant='light'>
              {fields.length} {fields.length === 1 ? 'campo' : 'campos'}
            </Badge>
            {isEditing && (
              <Button size='sm' leftSection={<IconPlus size={16} />} onClick={add} color='blue' variant='light' data-testid='sgc-flujo-agregar-campo'>
                Agregar Campo
              </Button>
            )}
          </>
        }
      />

      {fields.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} title='Sin campos' color='gray' variant='light'>
          Este proceso no tiene campos de formulario.
          {isEditing && (
            <Button size='xs' mt='sm' leftSection={<IconPlus size={14} />} onClick={add} color='blue' variant='light'>
              Agregar primer campo
            </Button>
          )}
        </Alert>
      ) : (
        <Stack gap='sm'>
          {fields.map((field, i) => {
            const isNew = !originalFieldIds.has(fieldId(field));
            const ownerHasPool = !!definition.tasks.find((t) => t.key === field.taskKey)?.poolAuthorizationTypeCode;
            return (
              <Card key={i} withBorder radius='md' p='md' data-testid='sgc-flujo-campo'>
                {isEditing ? (
                  <Stack gap='sm'>
                    <Group align='flex-end' wrap='nowrap'>
                      <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Nombre del campo' placeholder='Ej. Tipo de cambio' value={field.label} onChange={(e) => setField(i, { label: e.target.value })} style={{ flex: 1 }} data-testid='sgc-flujo-campo-etiqueta' />
                      <SgcSelect label='Tipo' data={opts(SGC_FIELD_TYPE_LABELS)} value={field.type} onChange={(v) => v && setField(i, { type: v as SgcFormFieldDefinition['type'] })} allowDeselect={false} disabled={!!field.qualityCheck} w={170} />
                      <Checkbox label='Obligatorio' checked={field.required} onChange={(e) => setField(i, { required: e.currentTarget.checked })} mb={8} />
                      <Checkbox
                        label='Chequeo Calidad'
                        checked={!!field.qualityCheck}
                        disabled={!ownerHasPool}
                        title='Punto de la lista de chequeo que responde el grupo de verificación de Calidad al firmar (Cumple / No cumple / No aplica). Solo en tareas con grupo de verificación.'
                        onChange={(e) => setField(i, { qualityCheck: e.currentTarget.checked, ...(e.currentTarget.checked ? { type: 'si_no' as const, options: [] } : {}) })}
                        mb={8}
                        data-testid='sgc-flujo-campo-chequeo'
                      />
                      <ActionIcon color='red' variant='subtle' size='lg' onClick={() => onChange({ ...definition, formFields: fields.filter((_, j) => j !== i) })} title='Eliminar campo' mb={4}>
                        <IconTrash size={18} />
                      </ActionIcon>
                    </Group>

                    <Group grow align='flex-start'>
                      <SgcSelect
                        label='Formulario'
                        data={[{ value: '__solicitud', label: 'Solicitud' }, ...taskOptions]}
                        value={field.taskKey ?? '__solicitud'}
                        onChange={(v) => setField(i, { taskKey: v === '__solicitud' || !v ? null : v, qualityCheck: v && v !== '__solicitud' ? field.qualityCheck : false })}
                        allowDeselect={false}
                      />
                      {isNew ? (
                        <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Clave' description='Minúsculas, números y guion bajo' value={field.key} onChange={(e) => setField(i, { key: e.target.value })} data-testid='sgc-flujo-campo-clave' />
                      ) : (
                        <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Clave' value={field.key} disabled />
                      )}
                      <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Ayuda' placeholder='Texto de ayuda (opcional)' value={field.helpText ?? ''} onChange={(e) => setField(i, { helpText: e.target.value || null })} />
                    </Group>

                    {field.type === 'seleccion' ? (
                      <>
                        <Group gap='xs'>
                          {field.options.length === 0 ? (
                            <Text size='sm' c='dimmed'>
                              Sin opciones aún.
                            </Text>
                          ) : (
                            field.options.map((o, k) => (
                              <Badge
                                key={`${o}-${k}`}
                                variant='light'
                                color='blue'
                                size='lg'
                                styles={{ root: { textTransform: 'none' } }}
                                rightSection={
                                  <ActionIcon size='xs' variant='transparent' color='red' onClick={() => setField(i, { options: field.options.filter((_, m) => m !== k) })} title='Quitar opción'>
                                    <IconX size={12} />
                                  </ActionIcon>
                                }
                              >
                                {o}
                              </Badge>
                            ))
                          )}
                        </Group>
                        <Group gap='xs'>
                          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
                            placeholder='Nueva opción (ej. Menor)'
                            value={optionInputs[i] || ''}
                            onChange={(e) => setOptionInputs((p) => ({ ...p, [i]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addOption(i);
                              }
                            }}
                            style={{ flex: 1 }}
                          />
                          <Button variant='light' onClick={() => addOption(i)} leftSection={<IconPlus size={16} />} disabled={!(optionInputs[i] || '').trim()}>
                            Opción
                          </Button>
                        </Group>
                      </>
                    ) : (
                      <Text size='sm' c='dimmed'>
                        {field.qualityCheck
                          ? 'Punto de la lista de chequeo: el grupo de verificación responde Cumple / No cumple / No aplica al firmar.'
                          : `Campo de ${(SGC_FIELD_TYPE_LABELS[field.type] || 'texto').toLowerCase()}: el usuario ingresará el valor (sin opciones predefinidas).`}
                      </Text>
                    )}
                  </Stack>
                ) : (
                  <Stack gap='xs'>
                    <Group justify='space-between'>
                      <Group gap='sm'>
                        <IconTag size={18} className='text-indigo-600' />
                        <Text size='md' fw={500}>
                          {field.label}
                        </Text>
                      </Group>
                      <Group gap='xs'>
                        <Badge color='grape' variant='light' size='sm'>
                          {SGC_FIELD_TYPE_LABELS[field.type] || 'Texto corto'}
                        </Badge>
                        <Badge color='blue' variant='light' size='sm' styles={{ root: { textTransform: 'none' } }}>
                          {formLabel(field.taskKey)}
                        </Badge>
                        {field.qualityCheck && (
                          <Badge color='teal' variant='light' size='sm'>
                            Chequeo Calidad
                          </Badge>
                        )}
                        <Badge color={field.required ? 'red' : 'gray'} variant='light' size='sm'>
                          {field.required ? 'Obligatorio' : 'Opcional'}
                        </Badge>
                      </Group>
                    </Group>
                    {field.options.length > 0 && (
                      <Group gap='xs'>
                        {field.options.map((o) => (
                          <Badge key={o} variant='light' color='blue' size='sm' styles={{ root: { textTransform: 'none' } }}>
                            {o}
                          </Badge>
                        ))}
                      </Group>
                    )}
                    {field.helpText && (
                      <Text size='xs' c='dimmed'>
                        {field.helpText}
                      </Text>
                    )}
                  </Stack>
                )}
              </Card>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}
