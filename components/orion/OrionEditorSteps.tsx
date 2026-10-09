'use client';

import { Box, Text, ThemeIcon } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

const STEPS = [
  { label: 'Documento', desc: 'Archivo y tipo de firma' },
  { label: 'Firmantes', desc: 'Quién firma (incl. usted)' },
  { label: 'Ubicación', desc: 'Dónde firman en el PDF' },
] as const;

type Props = {
  active: number;
};

const CIRCLE = 30;
const GAP = 6;

/**
 * Stepper a ancho completo: 3 columnas iguales, círculos centrados,
 * línea de centro a centro. Segmento relleno solo si idx < active.
 */
export default function OrionEditorSteps({ active }: Props) {
  return (
    <Box
      role='list'
      aria-label='Pasos de preparación'
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))`,
        width: '100%',
        alignItems: 'start',
      }}
    >
      {STEPS.map((step, idx) => {
        const isActive = idx === active;
        const isDone = idx < active;
        const isLast = idx === STEPS.length - 1;
        const tone = isActive || isDone ? 'var(--app-accent)' : 'var(--app-border)';

        return (
          <Box
            key={step.label}
            role='listitem'
            aria-current={isActive ? 'step' : undefined}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
            }}
          >
            {!isLast ? (
              <Box
                aria-hidden
                style={{
                  position: 'absolute',
                  top: CIRCLE / 2 - 1,
                  left: `calc(50% + ${CIRCLE / 2 + GAP}px)`,
                  right: `calc(-50% + ${CIRCLE / 2 + GAP}px)`,
                  height: 2,
                  borderRadius: 1,
                  background:
                    idx < active
                      ? 'color-mix(in srgb, var(--app-accent) 70%, transparent)'
                      : 'var(--app-border)',
                  zIndex: 0,
                  transition: 'background 180ms ease',
                  pointerEvents: 'none',
                }}
              />
            ) : null}

            <ThemeIcon
              size={CIRCLE}
              radius='xl'
              variant={isActive || isDone ? 'filled' : 'outline'}
              color={isActive || isDone ? undefined : 'gray'}
              style={{
                position: 'relative',
                zIndex: 1,
                background: isActive || isDone ? 'var(--app-accent)' : 'var(--app-surface)',
                borderColor: tone,
                color: isActive || isDone ? '#fff' : 'var(--app-text-muted, #6b7280)',
                boxShadow: isActive
                  ? '0 0 0 4px color-mix(in srgb, var(--app-accent) 18%, transparent)'
                  : undefined,
                transition: 'box-shadow 180ms ease, background 180ms ease',
              }}
            >
              {isDone && !isActive ? (
                <IconCheck size={16} stroke={2.5} />
              ) : (
                <Text size='xs' fw={700} c='inherit'>
                  {idx + 1}
                </Text>
              )}
            </ThemeIcon>

            <Box ta='center' px={4} style={{ maxWidth: '100%' }}>
              <Text
                size='xs'
                fw={isActive ? 700 : 600}
                c={isActive ? undefined : 'dimmed'}
                style={{ letterSpacing: '-0.01em' }}
              >
                {step.label}
              </Text>
              <Text
                size='10px'
                c='dimmed'
                lineClamp={2}
                visibleFrom='sm'
                style={{ lineHeight: 1.3 }}
              >
                {step.desc}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function editorStepSubtitle(active: number): string {
  const step = STEPS[active];
  if (!step) return '';
  return `Paso ${active + 1} de ${STEPS.length} — ${step.desc}`;
}
