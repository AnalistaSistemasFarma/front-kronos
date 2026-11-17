'use client';

import React, { useMemo, useState } from 'react';
import { ActionIcon, Group, SimpleGrid, Text, UnstyledButton } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

interface Props {
  /** Fechas elegidas (YYYY-MM-DD). */
  value: string[];
  onChange: (fechas: string[]) => void;
  /** Primera fecha seleccionable (la fecha de inicio de la reunión). */
  min: string;
  /** Última fecha seleccionable (ventana de la sala o tope de 1 año). */
  max: string;
}

/** Calendario mensual para marcar días específicos (Mantine, sin dependencias nuevas). */
export default function CalendarioDias({ value, onChange, min, max }: Props) {
  const [mes, setMes] = useState(() => {
    const [a, m] = min.split('-').map(Number);
    return { a, m };
  });
  const elegidas = useMemo(() => new Set(value), [value]);

  const celdas = useMemo(() => {
    const primero = new Date(Date.UTC(mes.a, mes.m - 1, 1)).getUTCDay();
    const dias = new Date(Date.UTC(mes.a, mes.m, 0)).getUTCDate();
    const lista: Array<string | null> = Array.from({ length: primero }, () => null);
    for (let d = 1; d <= dias; d++) lista.push(`${mes.a}-${pad(mes.m)}-${pad(d)}`);
    return lista;
  }, [mes]);

  const mover = (delta: number) =>
    setMes(({ a, m }) => {
      const t = a * 12 + (m - 1) + delta;
      return { a: Math.floor(t / 12), m: (t % 12) + 1 };
    });

  const alternar = (f: string) => {
    const s = new Set(value);
    if (s.has(f)) s.delete(f);
    else s.add(f);
    onChange([...s].sort());
  };

  return (
    <div>
      <Group justify="space-between" mb="xs">
        <ActionIcon variant="subtle" onClick={() => mover(-1)} aria-label="Mes anterior">
          <IconChevronLeft size={18} />
        </ActionIcon>
        <Text fw={600} size="sm" tt="capitalize">
          {MESES[mes.m - 1]} {mes.a}
        </Text>
        <ActionIcon variant="subtle" onClick={() => mover(1)} aria-label="Mes siguiente">
          <IconChevronRight size={18} />
        </ActionIcon>
      </Group>
      <SimpleGrid cols={7} spacing={4} verticalSpacing={4}>
        {DIAS.map((d, i) => (
          <Text key={`h${i}`} size="xs" c="dimmed" ta="center">
            {d}
          </Text>
        ))}
        {celdas.map((f, i) => {
          if (!f) return <span key={`v${i}`} />;
          const fuera = f < min || f > max;
          const activo = elegidas.has(f) || f === min;
          return (
            <UnstyledButton
              key={f}
              disabled={fuera || f === min}
              onClick={() => alternar(f)}
              aria-pressed={activo}
              style={{
                height: 36,
                borderRadius: 'var(--mantine-radius-sm)',
                textAlign: 'center',
                fontSize: 'var(--mantine-font-size-sm)',
                opacity: fuera ? 0.35 : 1,
                background: activo ? 'var(--mantine-color-blue-filled)' : 'var(--mantine-color-default)',
                color: activo ? 'var(--mantine-color-white)' : 'var(--mantine-color-text)',
                border: '1px solid var(--mantine-color-default-border)',
              }}
            >
              {Number(f.slice(8))}
            </UnstyledButton>
          );
        })}
      </SimpleGrid>
    </div>
  );
}
