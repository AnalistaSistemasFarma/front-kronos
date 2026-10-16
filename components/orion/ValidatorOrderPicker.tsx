'use client';

import { ActionIcon, Badge, Group, Paper, Select, Stack, Text } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';

export type ValidatorOption = {
  userId: string;
  email: string;
  name?: string | null;
};

type Props = {
  options: ValidatorOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Todos validan al mismo tiempo: sin orden ni flechas para reordenar. */
  parallel?: boolean;
};

/** Elige, de las personas validadoras del flujo, quiénes validan este documento y en qué orden. */
export default function ValidatorOrderPicker({ options, value, onChange, disabled, parallel = false }: Props) {
  const byId = new Map(options.map((o) => [o.userId, o]));
  const labelOf = (id: string) => {
    const o = byId.get(id);
    return o ? o.name || o.email : id;
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Stack gap='xs'>
      <Select
        label='Agregar validador'
        description={
          parallel
            ? 'Todos los validadores revisan al mismo tiempo, sin orden.'
            : 'Al elegirlo se agrega al final. El orden es el orden de aprobación.'
        }
        placeholder={
          value.length === options.length ? 'Ya agregó a todos los validadores' : 'Selecciona un validador'
        }
        data={options
          .filter((o) => !value.includes(o.userId))
          .map((o) => ({ value: o.userId, label: o.name ? `${o.name} · ${o.email}` : o.email }))}
        value={null}
        onChange={(id) => {
          if (id && !value.includes(id)) onChange([...value, id]);
        }}
        leftSection={<IconPlus size={14} />}
        searchable
        disabled={disabled || value.length === options.length}
        nothingFoundMessage='No hay más validadores en el flujo'
      />

      {value.length === 0 ? (
        <Text size='xs' c='dimmed'>
          Aún no ha elegido validadores para este documento.
        </Text>
      ) : (
        <Stack gap={6}>
          {value.map((id, index) => (
            <Paper key={id} withBorder radius='md' p={6}>
              <Group justify='space-between' wrap='nowrap'>
                <Group gap='sm' wrap='nowrap'>
                  {parallel ? null : (
                    <Badge variant='filled' color='violet' circle>
                      {index + 1}
                    </Badge>
                  )}
                  <Text size='sm' fw={600} lineClamp={1}>
                    {labelOf(id)}
                  </Text>
                </Group>
                <Group gap={2} wrap='nowrap'>
                  {parallel ? null : (
                    <>
                      <ActionIcon
                        variant='subtle'
                        size='sm'
                        onClick={() => move(index, -1)}
                        disabled={disabled || index === 0}
                        aria-label='Subir'
                      >
                        <IconArrowUp size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant='subtle'
                        size='sm'
                        onClick={() => move(index, 1)}
                        disabled={disabled || index === value.length - 1}
                        aria-label='Bajar'
                      >
                        <IconArrowDown size={14} />
                      </ActionIcon>
                    </>
                  )}
                  <ActionIcon
                    variant='subtle'
                    size='sm'
                    color='red'
                    onClick={() => onChange(value.filter((v) => v !== id))}
                    disabled={disabled}
                    aria-label='Quitar'
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
