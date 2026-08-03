'use client';

import type { ReactNode } from 'react';
import { Card, Group, Text, ThemeIcon } from '@mantine/core';
import { useDashboardChartPalette } from '../dashboard/useDashboardChartPalette';

const ACCENT: Record<string, { light: string; dark: string; icon: string }> = {
  cyan: { light: '#0891b2', dark: '#22d3ee', icon: 'cyan' },
  blue: { light: '#1d4ed8', dark: '#60a5fa', icon: 'blue' },
  violet: { light: '#6d28d9', dark: '#c4b5fd', icon: 'violet' },
  teal: { light: '#0f766e', dark: '#2dd4bf', icon: 'teal' },
};

export function PersonalInsightCard({
  label,
  value,
  hint,
  icon,
  color = 'blue',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  color?: keyof typeof ACCENT | string;
}) {
  const { isDark, palette } = useDashboardChartPalette();
  const accent = ACCENT[color] ?? ACCENT.blue;
  const accentColor = isDark ? accent.dark : accent.light;

  return (
    <Card
      p='md'
      radius='lg'
      withBorder
      style={{
        background: isDark ? 'rgba(15, 23, 42, 0.92)' : palette.chartPanelBg,
        borderColor: isDark ? 'rgba(148, 163, 184, 0.28)' : palette.chartPanelBorder,
        borderLeftWidth: 4,
        borderLeftColor: accentColor,
        boxShadow: isDark ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.06)',
      }}
    >
      <Group gap='sm' wrap='nowrap' align='flex-start'>
        <ThemeIcon
          size={40}
          radius='md'
          variant='filled'
          color={accent.icon}
          style={{ flexShrink: 0 }}
        >
          {icon}
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text
            size='xs'
            tt='uppercase'
            fw={700}
            style={{
              letterSpacing: 0.45,
              color: accentColor,
            }}
          >
            {label}
          </Text>
          <Text
            size='lg'
            fw={800}
            lineClamp={2}
            style={{
              lineHeight: 1.25,
              color: isDark ? '#f8fafc' : '#0f172a',
            }}
          >
            {value}
          </Text>
          {hint ? (
            <Text
              size='xs'
              mt={4}
              lineClamp={2}
              style={{ color: isDark ? '#cbd5e1' : '#475569' }}
            >
              {hint}
            </Text>
          ) : null}
        </div>
      </Group>
    </Card>
  );
}
