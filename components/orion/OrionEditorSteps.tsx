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

/**
 * Stepper compacto estilo macOS/iOS: números en círculo + línea de progreso.
 */
export default function OrionEditorSteps({ active }: Props) {
  return (
    <Box
      role='list'
      aria-label='Pasos de preparación'
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 0,
        alignItems: 'start',
      }}
    >
      {STEPS.map((step, idx) => {
        const isActive = idx === active;
        const isDone = idx < active;
        const tone = isActive || isDone ? 'var(--app-accent)' : 'var(--app-border)';

        return (
          <Box
            key={step.label}
            role='listitem'
            aria-current={isActive ? 'step' : undefined}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: idx === 0 ? 'flex-start' : idx === STEPS.length - 1 ? 'flex-end' : 'center',
              position: 'relative',
              paddingTop: 2,
            }}
          >
            {/* Línea conectora */}
            {idx < STEPS.length - 1 ? (
              <Box
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 15,
                  left: idx === 0 ? 28 : '50%',
                  right: idx === STEPS.length - 2 ? 28 : undefined,
                  width: idx === STEPS.length - 2 ? undefined : '100%',
                  height: 2,
                  background: idx < active
                    ? 'color-mix(in srgb, var(--app-accent) 70%, transparent)'
                    : 'var(--app-border)',
                  zIndex: 0,
                  transition: 'background 180ms ease',
                }}
              />
            ) : null}

            <Box
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                zIndex: 1,
                maxWidth: '100%',
              }}
            >
              <ThemeIcon
                size={30}
                radius='xl'
                variant={isActive || isDone ? 'filled' : 'outline'}
                color={isActive || isDone ? undefined : 'gray'}
                style={{
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
              <Box ta='center' style={{ maxWidth: 140 }}>
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
                  lineClamp={1}
                  visibleFrom='sm'
                  style={{ lineHeight: 1.3 }}
                >
                  {step.desc}
                </Text>
              </Box>
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
