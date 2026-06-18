'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Group, Paper, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconTicket, IconUser } from '@tabler/icons-react';

const subItems = [
  {
    href: '/process/help-desk/create-ticket',
    label: 'Panel de Casos',
    description: 'Lista general y creación',
    icon: IconTicket,
  },
  {
    href: '/process/help-desk/cases-by-email',
    label: 'Casos por solicitante',
    description: 'Filtrar por quien creó el caso',
    icon: IconUser,
  },
] as const;

export function HelpDeskSubNav() {
  const pathname = usePathname();

  return (
    <Paper p={{ base: 'xs', sm: 'sm' }} radius='md' withBorder mb='md' className='bg-white'>
      <Group gap='xs' wrap='wrap' grow>
        {subItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}?`);
          const Icon = item.icon;

          return (
            <UnstyledButton
              key={item.href}
              component={Link}
              href={item.href}
              style={{ flex: '1 1 100%', minWidth: 0 }}
            >
              <Paper
                p={{ base: 'xs', sm: 'sm' }}
                radius='md'
                withBorder
                className={
                  isActive
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-blue-200'
                }
              >
                <Group gap='sm' wrap='nowrap'>
                  <ThemeIcon
                    size={32}
                    radius='md'
                    variant={isActive ? 'gradient' : 'light'}
                    gradient={isActive ? { from: 'blue', to: 'cyan', deg: 135 } : undefined}
                    color='blue'
                  >
                    <Icon size={16} />
                  </ThemeIcon>
                  <div style={{ minWidth: 0 }}>
                    <Text size='sm' fw={600} lineClamp={1} className={isActive ? 'text-blue-700' : 'text-gray-800'}>
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
