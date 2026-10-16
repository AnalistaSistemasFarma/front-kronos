'use client';

import { Group, Stack, Text, Tooltip } from '@mantine/core';

/**
 * Cuadritos de proceso de un documento en la tabla de adjuntos: cumplidas en verde, la actual en
 * azul y las que faltan en gris. `stage` >= etapas.length = todo listo.
 */
export default function DocStageTrack({
  stages,
  stage,
  doneLabel,
}: {
  stages: readonly string[];
  stage: number;
  doneLabel: string;
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
                      ? 'var(--mantine-color-blue-6)'
                      : 'var(--mantine-color-default-border)',
              }}
            />
          </Tooltip>
        ))}
      </Group>
      <Text size='10px' c='dimmed'>
        {done ? doneLabel : `Etapa ${stage + 1} de ${stages.length} · ${stages[stage]}`}
      </Text>
    </Stack>
  );
}
