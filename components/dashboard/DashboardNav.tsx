'use client';

import { Group, Paper, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconClipboardList, IconChecklist, IconTicket } from '@tabler/icons-react';
import {
  useDashboardTab,
  type DashboardTab,
} from '../../lib/dashboard/DashboardTabContext';
import { useDashboardChartPalette } from './useDashboardChartPalette';

const navItems: {
  tab: DashboardTab;
  label: string;
  description: string;
  icon: typeof IconClipboardList;
}[] = [
  {
    tab: 'solicitudes',
    label: 'Solicitudes',
    description: 'Analítica de pedidos',
    icon: IconClipboardList,
  },
  {
    tab: 'actividades',
    label: 'Actividades',
    description: 'Tareas y rendimiento',
    icon: IconChecklist,
  },
  {
    tab: 'tickets',
    label: 'Tickets',
    description: 'Mesa de ayuda',
    icon: IconTicket,
  },
];

export default function DashboardNav() {
  const { activeTab, setActiveTab } = useDashboardTab();
  const { palette } = useDashboardChartPalette();

  return (
    <Paper
      p={{ base: 'xs', sm: 'xs' }}
      radius='lg'
      withBorder
      mb={0}
      style={{
        background: palette.chartSurface,
        borderColor: palette.blue100,
      }}
    >
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
              style={{ flex: '1 1 100%', minWidth: 0 }}
            >
              <Paper
                p={{ base: 'xs', sm: 'sm' }}
                radius='md'
                withBorder
                style={{
                  borderColor: isActive
                    ? palette.borderAccentStrong
                    : palette.blue100,
                  background: isActive ? palette.blue50 : palette.chartPanelBg,
                }}
                styles={{
                  root: {
                    '&:hover': {
                      borderColor: palette.blue200,
                    },
                  },
                }}
              >
                <Group gap='sm' wrap='nowrap'>
                  <ThemeIcon
                    size={36}
                    radius='md'
                    variant={isActive ? 'gradient' : 'light'}
                    gradient={isActive ? palette.gradient : undefined}
                    color='blue'
                  >
                    <Icon size={18} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text
                      size='sm'
                      fw={700}
                      lineClamp={1}
                      style={{
                        color: isActive
                          ? palette.primary
                          : palette.blue800,
                      }}
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
