'use client';

import { Group, Paper, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconCategory2, IconTicket } from '@tabler/icons-react';
import { useTicketsSub, type TicketsSubView } from '../../lib/dashboard/TicketsSubContext';
import { useDashboardChartPalette } from './useDashboardChartPalette';

const subItems: {
  view: TicketsSubView;
  label: string;
  description: string;
  icon: typeof IconTicket;
}[] = [
  {
    view: 'operativo',
    label: 'Operativo',
    description: 'Técnicos y tiempos',
    icon: IconTicket,
  },
  {
    view: 'categorias',
    label: 'Categorías y empresas',
    description: 'Demanda por origen',
    icon: IconCategory2,
  },
];

export default function TicketsSubNav() {
  const { subView, setSubView } = useTicketsSub();
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
