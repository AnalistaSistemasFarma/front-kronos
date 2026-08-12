'use client';

import { useState } from 'react';
import {
  Card,
  Grid,
  Stack,
  Group,
  Text,
  Badge,
  Button,
  TextInput,
  Select,
  Checkbox,
  ActionIcon,
} from '@mantine/core';
import { IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import {
  TABLE_COLUMN_TYPES,
  newColumnKey,
  type TableColumn,
} from '../../../../../lib/requests-general/tableField';

interface TableColumnsEditorProps {
  columns: TableColumn[];
  onChange: (columns: TableColumn[]) => void;
}

/**
 * Editor de columnas para un campo de tipo "Tabla". Compartido entre la pantalla
 * de CREAR flujo (workflows) y la de EDITAR flujo (view-workflows). Es
 * autocontenido: gestiona internamente los inputs de "nueva opción" de las
 * columnas tipo select. Reutiliza los helpers puros de lib/requests-general/tableField.
 */
export default function TableColumnsEditor({ columns, onChange }: TableColumnsEditorProps) {
  // Inputs de nueva opción por columna, indexados por la key de la columna.
  const [optionInputs, setOptionInputs] = useState<Record<string, string>>({});

  const addColumn = () => {
    onChange([
      ...columns,
      { key: newColumnKey(columns), label: '', type: 'text', required: false },
    ]);
  };

  const updateColumn = (colKey: string, patch: Partial<TableColumn>) => {
    onChange(columns.map((c) => (c.key === colKey ? { ...c, ...patch } : c)));
  };

  const removeColumn = (colKey: string) => {
    onChange(columns.filter((c) => c.key !== colKey));
  };

  const addOption = (colKey: string) => {
    const opt = (optionInputs[colKey] || '').trim();
    if (!opt) return;
    onChange(
      columns.map((c) =>
        c.key === colKey ? { ...c, options: [...(c.options || []), opt] } : c
      )
    );
    setOptionInputs((prev) => ({ ...prev, [colKey]: '' }));
  };

  const removeOption = (colKey: string, index: number) => {
    onChange(
      columns.map((c) =>
        c.key === colKey
          ? { ...c, options: (c.options || []).filter((_, i) => i !== index) }
          : c
      )
    );
  };

  return (
    <Stack gap='sm'>
      <Text size='sm' c='dimmed'>
        Defina las columnas de la tabla. Al crear la solicitud, el usuario agregará
        filas respetando el tipo de cada columna.
      </Text>

      {columns.length === 0 ? (
        <Text size='sm' c='dimmed'>
          Aún sin columnas. Agregue al menos una.
        </Text>
      ) : (
        columns.map((col) => (
          <Card key={col.key} withBorder radius='sm' p='sm'>
            <Grid align='flex-end' gutter='xs'>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <TextInput
                  label='Columna'
                  placeholder='Ej. Cantidad'
                  value={col.label}
                  onChange={(e) => updateColumn(col.key, { label: e.target.value })}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 8, md: 4 }}>
                <Select
                  label='Tipo'
                  data={TABLE_COLUMN_TYPES}
                  value={col.type}
                  onChange={(value) =>
                    updateColumn(col.key, {
                      type: (value || 'text') as TableColumn['type'],
                      ...(value === 'select'
                        ? { options: col.options || [] }
                        : { options: undefined }),
                    })
                  }
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: true }}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 3, md: 3 }}>
                <Checkbox
                  label='Obligatoria'
                  checked={col.required}
                  onChange={(e) =>
                    updateColumn(col.key, { required: e.currentTarget.checked })
                  }
                  mb={8}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 1, md: 1 }}>
                <ActionIcon
                  color='red'
                  variant='subtle'
                  onClick={() => removeColumn(col.key)}
                  title='Quitar columna'
                  mb={8}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Grid.Col>
            </Grid>

            {col.type === 'select' && (
              <div style={{ marginTop: 8 }}>
                <Group gap='xs' mb='xs'>
                  {(col.options || []).length === 0 ? (
                    <Text size='xs' c='dimmed'>
                      Sin opciones aún.
                    </Text>
                  ) : (
                    (col.options || []).map((opt, idx) => (
                      <Badge
                        key={`${col.key}-${idx}`}
                        variant='light'
                        color='blue'
                        rightSection={
                          <ActionIcon
                            size='xs'
                            variant='transparent'
                            color='red'
                            onClick={() => removeOption(col.key, idx)}
                            title='Quitar opción'
                          >
                            <IconX size={12} />
                          </ActionIcon>
                        }
                        styles={{ root: { textTransform: 'none' } }}
                      >
                        {opt}
                      </Badge>
                    ))
                  )}
                </Group>
                <Group gap='xs'>
                  <TextInput
                    size='xs'
                    placeholder='Nueva opción'
                    value={optionInputs[col.key] || ''}
                    onChange={(e) =>
                      setOptionInputs((prev) => ({ ...prev, [col.key]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addOption(col.key);
                      }
                    }}
                    style={{ flex: 1 }}
                  />
                  <Button
                    size='xs'
                    variant='light'
                    onClick={() => addOption(col.key)}
                    disabled={!(optionInputs[col.key] || '').trim()}
                  >
                    Opción
                  </Button>
                </Group>
              </div>
            )}
          </Card>
        ))
      )}

      <Button
        variant='light'
        size='xs'
        leftSection={<IconPlus size={16} />}
        onClick={addColumn}
        style={{ alignSelf: 'flex-start' }}
      >
        Agregar columna
      </Button>
    </Stack>
  );
}
