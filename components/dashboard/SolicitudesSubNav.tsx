'use client';

import { Group, Paper, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconClipboardList, IconGitBranch } from '@tabler/icons-react';
import {
  useSolicitudesSub,
  type SolicitudesSubView,
} from '../../lib/dashboard/SolicitudesSubContext';
import { useDashboardChartPalette } from './useDashboardChartPalette';

const subItems: {
  view: SolicitudesSubView;
  label: string;
  description: string;
  icon: typeof IconClipboardList;
}[] = [
  {
    view: 'solicitudes',
    label: 'Solicitudes',
    description: 'Pedidos y estados',
    icon: IconClipboardList,
  },
  {
    view: 'procesos',
    label: 'Procesos',
    description: 'Áreas y carga',
    icon: IconGitBranch,
  },
];

export default function SolicitudesSubNav() {
  const { subView, setSubView } = useSolicitudesSub();
  const { palette } = useDashboardChartPalette();

  return (
    <Paper
      p={{ base: 'xs', sm: 'xs' }}
      radius='md'
      withBorder
      mb='sm'
      style={{
        background: palette.chartSurface,
        borderColor: palette.blue100,
      }}
    >
      <Group gap='xs' wrap='wrap' grow>
        {subItems.map((item) => {
          const isActive = subView === item.view;
          const Icon = item.icon;

          return (
            <UnstyledButton
              key={item.view}
              type='button'
              onClick={() => setSubView(item.view)}
              className='dashboard-subnav-item'
              style={{ flex: '1 1 100%', minWidth: 0 }}
            >
              <Paper
                p={{ base: 'xs', sm: 'sm' }}
                radius='md'
                withBorder
                style={{
                  borderColor: isActive ? palette.borderAccentStrong : palette.blue100,
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
                      fw={600}
                      lineClamp={1}
                      style={{
                        color: isActive ? palette.primary : palette.blue800,
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
