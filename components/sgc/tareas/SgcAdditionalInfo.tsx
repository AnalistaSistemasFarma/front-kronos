'use client';

import { useState } from 'react';
import { ActionIcon, Button, Card, Grid, Group, Select, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconCheck, IconPencil, IconTag } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';

/** «Información adicional»: COPIA del bloque de campos del formulario de SynerLink (edición campo por campo). */
type Field = SgcRequestDetail['formFields'][number];

export interface SgcAdditionalInfoProps {
  fields: Field[];
  canEdit: boolean;
  onSave: (key: string, value: string) => Promise<void>;
}

export default function SgcAdditionalInfo({ fields, canEdit, onSave }: SgcAdditionalInfoProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  if (fields.length === 0) return null;

  return (
    <Card shadow='sm' p='lg' radius='md' withBorder mt='6' data-testid='sgc-info-adicional'>
      <Title order={3} mb='md' className='flex items-center gap-2'>
        <IconTag size={20} />
        Información adicional
      </Title>
      <Grid>
        {fields.map((f) => {
          const isEditing = editing === f.key;
          const display = f.type === 'si_no' ? (f.value === 'si' ? 'Sí' : f.value === 'no' ? 'No' : '—') : f.value || '—';
          return (
            <Grid.Col key={f.id} span={f.type === 'texto_largo' ? 12 : { base: 12, md: 6 }}>
              <Card withBorder radius='md' p='md'>
                <Group justify='space-between'>
                  <Text size='xs' c='dimmed' fw={500} className='uppercase'>
                    {f.label}
                    {f.required ? ' *' : ''}
                  </Text>
                  {canEdit && !isEditing && (
                    <ActionIcon
                      variant='subtle'
                      color='blue'
                      title='Editar campo'
                      onClick={() => {
                        setEditing(f.key);
                        setValue(f.value ?? '');
                      }}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                  )}
                </Group>
                {isEditing ? (
                  <Stack gap='xs' mt={4}>
                    {f.type === 'seleccion' || f.type === 'si_no' ? (
                      <Select
                        data={f.type === 'si_no' ? [{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }] : f.options.map((o) => ({ value: o, label: o }))}
                        value={value || null}
                        onChange={(v) => setValue(v || '')}
                        searchable
                        clearable
                        placeholder='Seleccione una opción'
                      />
                    ) : f.type === 'texto_largo' ? (
                      <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' value={value} onChange={(e) => setValue(e.target.value)} autosize minRows={3} />
                    ) : (
                      <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' type={f.type === 'numero' ? 'number' : f.type === 'fecha' ? 'date' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} />
                    )}
                    <Group justify='flex-end' gap='xs'>
                      <Button variant='outline' size='xs' onClick={() => setEditing(null)} disabled={saving}>
                        Cancelar
                      </Button>
                      <Button
                        size='xs'
                        leftSection={<IconCheck size={14} />}
                        loading={saving}
                        onClick={async () => {
                          setSaving(true);
                          try {
                            await onSave(f.key, value);
                            setEditing(null);
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        Guardar
                      </Button>
                    </Group>
                  </Stack>
                ) : (
                  <Text size='md' fw={600} mt={4} className='whitespace-pre-line'>
                    {display}
                  </Text>
                )}
                {f.helpText && !isEditing && (
                  <Text size='xs' c='dimmed' mt={4}>
                    {f.helpText}
                  </Text>
                )}
              </Card>
            </Grid.Col>
          );
        })}
      </Grid>
    </Card>
  );
}
