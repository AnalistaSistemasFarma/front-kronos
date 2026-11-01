'use client';

import { Group, Stack, Text, Tooltip } from '@mantine/core';

const CURRENT_COLOR = {
  normal: 'var(--mantine-color-blue-6)',
  returned: 'var(--mantine-color-orange-6)',
  rejected: 'var(--mantine-color-red-6)',
} as const;

/**
 * Cuadritos de proceso de un documento en la tabla de adjuntos: cumplidas en verde, la actual en
 * azul (naranja si se devolvió, rojo si se rechazó) y las que faltan en gris.
 * `stage` >= etapas.length = todo listo.
 */
export default function DocStageTrack({
  stages,
  stage,
  doneLabel,
  tone = 'normal',
  note = null,
}: {
  stages: readonly string[];
  stage: number;
  doneLabel: string;
  tone?: keyof typeof CURRENT_COLOR;
  /** Reemplaza "Etapa X de N · nombre" (p. ej. "Devuelto para corrección"). */
  note?: string | null;
}) {
  const done = stage >= stages.length;
  return (
    <Stack gap={3}>
      <Group gap={3} wrap='nowrap' aria-hidden>
        {stages.map((label, i) => (
          <Tooltip key={label} label={`${i + 1}. ${label}`} withArrow>
            <div
              style={{
                width: 26,
                height: 5,
                borderRadius: 3,
                background:
                  i < stage
                    ? 'var(--mantine-color-teal-6)'
                    : i === stage
                      ? CURRENT_COLOR[tone]
                      : 'var(--mantine-color-default-border)',
              }}
            />
          </Tooltip>
        ))}
      </Group>
      <Text size='10px' c={tone === 'rejected' ? 'red.7' : tone === 'returned' ? 'orange.7' : 'dimmed'}>
        {done ? doneLabel : note || `Etapa ${stage + 1} de ${stages.length} · ${stages[stage]}`}
      </Text>
    </Stack>
  );
}
