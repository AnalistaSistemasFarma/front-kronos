'use client';

import type { ReactNode } from 'react';
import { Box, Container, Group, Stack, Text, Title, type StackProps } from '@mantine/core';

interface DashboardPageShellProps {
  title: string;
  description?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  gap?: StackProps['gap'];
}

export default function DashboardPageShell({
  title,
  description,
  toolbar,
  children,
  gap = 'lg',
}: DashboardPageShellProps) {
  return (
    <Container
      size='xl'
      py={{ base: 'md', sm: 'lg', md: 'xl' }}
      px={{ base: 'xs', sm: 'md' }}
      className='dashboard-analytics-root'
    >
      <Stack gap={gap}>
        <Group
          justify='space-between'
          align='flex-start'
          wrap='wrap'
          gap='md'
          className='dashboard-page-header'
        >
          <Stack gap={4} style={{ flex: '1 1 16rem', minWidth: 0, maxWidth: '100%' }}>
            <Title order={2} style={{ fontSize: 'clamp(1.25rem, 4vw, 1.75rem)', lineHeight: 1.2 }}>
              {title}
            </Title>
            {description ? (
              <Box component='div' style={{ maxWidth: '36rem' }} className='dashboard-page-description'>
                {typeof description === 'string' ? (
                  <Text size='sm' c='dimmed'>
                    {description}
                  </Text>
                ) : (
                  description
                )}
              </Box>
            ) : null}
          </Stack>
          {toolbar ? (
            <Box
              w={{ base: '100%', sm: 'auto' }}
              className='dashboard-toolbar-slot'
              style={{ minWidth: 0, maxWidth: '100%' }}
            >
              {toolbar}
            </Box>
          ) : null}
        </Group>
        {children}
      </Stack>
    </Container>
  );
}
