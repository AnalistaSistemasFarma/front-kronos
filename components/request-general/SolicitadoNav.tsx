'use client';

import { Group, Paper, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import { IconClipboardList, IconChecklist } from '@tabler/icons-react';
import {
  useSolicitadoTab,
  type SolicitadoTab,
} from '../../lib/request-general/SolicitadoTabContext';
import { useDashboardChartPalette } from '../dashboard/useDashboardChartPalette';

const navItems: {
  tab: SolicitadoTab;
  label: string;
  description: string;
  icon: typeof IconClipboardList;
}[] = [
  {
    tab: 'procesos',
    label: 'Mis procesos',
    description: 'Solicitudes que gestionas',
    icon: IconClipboardList,
  },
  {
    tab: 'actividades',
    label: 'Mis actividades',
    description: 'Tareas asignadas a ti',
    icon: IconChecklist,
  },
];

/** Título + submenú. Pensado para ir en sticky. */
export default function SolicitadoNav() {
  const { activeTab, setActiveTab } = useSolicitadoTab();
  const { palette } = useDashboardChartPalette();

  return (
    <Paper
      p={{ base: 'xs', sm: 'sm' }}
      radius='lg'
      withBorder
      style={{
        background: palette.chartPanelBg,
        borderColor: palette.blue100,
      }}
    >
      <Title order={3} mb='xs' style={{ color: palette.primary, lineHeight: 1.2 }}>
        Dashboard personal
      </Title>
      <Group gap='xs' wrap='wrap' grow>
        {navItems.map((item) => {
          const isActive = activeTab === item.tab;
          const Icon = item.icon;

          return (
            <UnstyledButton
              key={item.tab}
              type='button'
              onClick={() => setActiveTab(item.tab)}
              className='dashboard-nav-item'
              style={{ flex: '1 1 140px', minWidth: 0 }}
            >
              <Paper
                p='xs'
                radius='md'
                withBorder
                style={{
                  borderColor: isActive ? palette.borderAccentStrong : palette.blue100,
                  background: isActive ? palette.blue50 : 'transparent',
                }}
              >
                <Group gap='sm' wrap='nowrap'>
                  <ThemeIcon
                    size={32}
                    radius='md'
                    variant={isActive ? 'gradient' : 'light'}
                    gradient={isActive ? palette.gradient : undefined}
                    color='blue'
                  >
                    <Icon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text
                      size='sm'
                      fw={700}
                      lineClamp={1}
                      style={{ color: isActive ? palette.primary : palette.blue800 }}
                    >
                      {item.label}
                    </Text>
                    <Text size='xs' c='dimmed' lineClamp={1} visibleFrom='sm'>
                      {item.description}
                    </Text>
                  </div>
                </Group>
              </Paper>
            </UnstyledButton>
          );
        })}
      </Group>
    </Paper>
  );
}
