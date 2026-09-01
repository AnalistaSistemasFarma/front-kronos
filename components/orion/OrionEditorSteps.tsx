'use client';

import { Box, Text } from '@mantine/core';

const STEPS = [
  { label: 'Documento', desc: 'Archivo y tipo de firma' },
  { label: 'Firmantes', desc: 'Quién firma (incl. usted)' },
  { label: 'Ubicación', desc: 'Dónde firman' },
] as const;

type Props = {
  active: number;
};

export default function OrionEditorSteps({ active }: Props) {
  return (
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
        marginBottom: 4,
      }}
    >
      {STEPS.map((step, idx) => {
        const isActive = idx === active;
        const isDone = idx < active;
        return (
          <Box
            key={step.label}
            px='sm'
            py='xs'
            style={{
              borderRadius: 10,
              border: `1px solid ${
                isActive
                  ? 'color-mix(in srgb, var(--app-accent) 55%, var(--app-border))'
                  : 'var(--app-border)'
              }`,
              background: isActive
                ? 'color-mix(in srgb, var(--app-accent) 12%, var(--app-surface))'
                : isDone
                  ? 'color-mix(in srgb, var(--app-accent) 6%, var(--app-surface-raised))'
                  : 'var(--app-surface-raised)',
            }}
          >
            <Text size='xs' fw={700} c={isActive ? undefined : 'dimmed'}>
              {idx + 1}. {step.label}
            </Text>
            <Text size='xs' c='dimmed' lineClamp={1}>
              {step.desc}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function editorStepSubtitle(active: number): string {
  const step = STEPS[active];
  if (!step) return '';
  return `${step.label} · Paso ${active + 1} de ${STEPS.length} · ${step.desc}`;
}
