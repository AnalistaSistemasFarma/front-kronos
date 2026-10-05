'use client';

import { Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconArrowBackUp, IconCheck, IconClock, IconPointFilled } from '@tabler/icons-react';

export type DocPersonState = 'done' | 'current' | 'pending' | 'returned';

export type DocPerson = {
  key: string;
  name: string;
  state: DocPersonState;
  hint?: string;
};

const STATE_STYLE: Record<DocPersonState, { color: string; label: string }> = {
  done: { color: 'var(--mantine-color-teal-7)', label: 'Aprobó' },
  current: { color: 'var(--mantine-color-blue-7)', label: 'Le toca' },
  pending: { color: 'var(--mantine-color-dimmed)', label: 'En espera' },
  returned: { color: 'var(--mantine-color-orange-7)', label: 'Pidió corrección' },
};

function StateIcon({ state }: { state: DocPersonState }) {
  const color = STATE_STYLE[state].color;
  if (state === 'done') return <IconCheck size={13} stroke={2.4} color={color} />;
  if (state === 'current') return <IconClock size={13} stroke={2} color={color} />;
  if (state === 'returned') return <IconArrowBackUp size={13} stroke={2} color={color} />;
  return <IconPointFilled size={11} color={color} />;
}

const MAX_VISIBLE = 4;

/** Grupo de personas (validadores, cliente o firmantes) con su avance, para las filas de adjuntos. */
export default function DocPeopleList({
  title,
  people,
}: {
  title: string;
  people: DocPerson[];
}) {
  if (people.length === 0) return null;
  const done = people.filter((p) => p.state === 'done').length;
  const visible = people.slice(0, MAX_VISIBLE);
  const hidden = people.length - visible.length;

  return (
    <Stack gap={2} style={{ minWidth: 0 }}>
      <Text size='10px' fw={700} tt='uppercase' c='dimmed' style={{ letterSpacing: 0.5 }}>
        {title} · {done}/{people.length}
      </Text>
      {visible.map((p) => (
        <Tooltip key={p.key} label={p.hint || STATE_STYLE[p.state].label} withArrow openDelay={300}>
          <Group gap={5} wrap='nowrap' style={{ minWidth: 0 }}>
            <span style={{ display: 'inline-flex', flexShrink: 0 }}>
              <StateIcon state={p.state} />
            </span>
            <Text
              size='xs'
              lineClamp={1}
              fw={p.state === 'current' ? 600 : 400}
              c={p.state === 'pending' ? 'dimmed' : undefined}
            >
              {p.name}
            </Text>
          </Group>
        </Tooltip>
      ))}
      {hidden > 0 ? (
        <Text size='10px' c='dimmed'>
          +{hidden} más
        </Text>
      ) : null}
    </Stack>
  );
}
