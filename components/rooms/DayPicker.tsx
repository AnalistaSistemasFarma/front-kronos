'use client';

import React, { useMemo, useState } from 'react';
import { ActionIcon, Group, SimpleGrid, Text, UnstyledButton } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

interface Props {
  /** Selected dates (YYYY-MM-DD). */
  value: string[];
  onChange: (dates: string[]) => void;
  /** First selectable date (the meeting's start date, always included). */
  min: string;
  /** Last selectable date (room window or 1-year cap). */
  max: string;
}

/** Monthly calendar to pick specific days (Mantine, no new dependencies). */
export default function DayPicker({ value, onChange, min, max }: Props) {
  const [month, setMonth] = useState(() => {
    const [y, m] = min.split('-').map(Number);
    return { y, m };
  });
  const selected = useMemo(() => new Set(value), [value]);

  const cells = useMemo(() => {
    const firstDow = new Date(Date.UTC(month.y, month.m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(month.y, month.m, 0)).getUTCDate();
    const list: Array<string | null> = Array.from({ length: firstDow }, () => null);
    for (let d = 1; d <= days; d++) list.push(`${month.y}-${pad(month.m)}-${pad(d)}`);
    return list;
  }, [month]);

  const move = (delta: number) =>
    setMonth(({ y, m }) => {
      const t = y * 12 + (m - 1) + delta;
      return { y: Math.floor(t / 12), m: (t % 12) + 1 };
    });

  const toggle = (d: string) => {
    const s = new Set(value);
    if (s.has(d)) s.delete(d);
    else s.add(d);
    onChange([...s].sort());
  };

  return (
    <div>
      <Group justify="space-between" mb="xs">
        <ActionIcon variant="subtle" onClick={() => move(-1)} aria-label="Mes anterior">
          <IconChevronLeft size={18} />
        </ActionIcon>
        <Text fw={600} size="sm" tt="capitalize">
          {MONTHS[month.m - 1]} {month.y}
        </Text>
        <ActionIcon variant="subtle" onClick={() => move(1)} aria-label="Mes siguiente">
          <IconChevronRight size={18} />
        </ActionIcon>
      </Group>
      <SimpleGrid cols={7} spacing={4} verticalSpacing={4}>
        {WEEKDAYS.map((d, i) => (
          <Text key={`h${i}`} size="xs" c="dimmed" ta="center">
            {d}
          </Text>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const outside = d < min || d > max;
          const active = selected.has(d) || d === min;
          return (
            <UnstyledButton
              key={d}
              disabled={outside || d === min}
              onClick={() => toggle(d)}
              aria-pressed={active}
              style={{
                height: 36,
                borderRadius: 'var(--mantine-radius-sm)',
                textAlign: 'center',
                fontSize: 'var(--mantine-font-size-sm)',
                opacity: outside ? 0.35 : 1,
                background: active ? 'var(--mantine-color-blue-filled)' : 'var(--mantine-color-default)',
                color: active ? 'var(--mantine-color-white)' : 'var(--mantine-color-text)',
                border: '1px solid var(--mantine-color-default-border)',
              }}
            >
              {Number(d.slice(8))}
            </UnstyledButton>
          );
        })}
      </SimpleGrid>
    </div>
  );
}
